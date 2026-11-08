#!/usr/bin/env python3
"""Probe CoreS3 camera via authenticated USB RPC without a cloud image request."""
import argparse
import json
import pathlib
import sys
import time
import importlib.util
import signal
import subprocess
import atexit
import fcntl
import secrets

try:
    import serial
except ImportError:
    print("[FATAL] STEP=DEPENDENCY pyserial is required")
    raise SystemExit(2)

spec = importlib.util.spec_from_file_location("probe_session", pathlib.Path(__file__).with_name("camera-probe-session.py"))
session = importlib.util.module_from_spec(spec)
spec.loader.exec_module(session)

FW = pathlib.Path(__file__).resolve().parents[1]
CONFIG = FW / "host/app/manifest_archive_private.json"

def fatal(step, reason):
    print(f"[FATAL] STEP={step} {reason}", file=sys.stderr)
    raise SystemExit(1)

def request(port, token, ident, op, args, timeout=20):
    payload = {"id": ident, "token": token, "op": op, "args": args}
    port.write(("@SC " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    # write_timeout bounds transmission; tcdrain()/flush can block after USB loss.
    deadline = time.monotonic() + timeout
    debug_count = 0
    last_stage = "-"
    while time.monotonic() < deadline:
        raw = port.readline(16384)
        if not raw:
            continue
        if not raw.startswith(b"@SC "):
            # Only print recognized boot/reset indicators; never echo arbitrary serial data.
            line = raw.decode("utf-8", errors="replace").strip()
            if line.startswith(("rst:", "Guru Meditation", "Brownout detector")):
                print("[WARN] STEP=BOOT " + line[:160], flush=True)
            continue
        try:
            response = json.loads(raw[4:])
        except (ValueError, UnicodeError):
            continue
        if not isinstance(response, dict):
            continue
        if response.get("event") == "debug":
            debug_count += 1
            lines = response.get("lines")
            if not isinstance(lines, list):
                continue
            for line in lines[:8]:
                if not isinstance(line, str):
                    continue
                # Never expose ASR transcripts or chat text from USB.
                if line.startswith("[dialog] "):
                    parts = line.split(" ", 4)
                    kind = parts[2] if len(parts) >= 3 else "?"
                    if kind in {
                        "CAMERA_START", "CAMERA_CAPTURE", "JPEG_START",
                        "JPEG_DONE", "SD_SAVE_START", "CAMERA_SAVE",
                        "CAMERA_ERROR", "LOCAL_PHOTO_DONE", "LOCAL_PHOTO_ERROR",
                    }:
                        last_stage = kind
                        print("[CHECK] STEP=CAMERA_EVENT " + kind, flush=True)
                    continue
                if line.startswith(("[camera]", "[runtime-camera]", "[photo]", "[TouchPanel]")):
                    import re
                    match = re.fullmatch(r"\[photo\] stage=([A-Z_]{1,40})", line.strip())
                    if match:
                        last_stage = match.group(1)
                        print("[CHECK] STEP=CAMERA_EVENT " + last_stage, flush=True)
            continue
        if response.get("event") == "fatal":
            print("[ERROR] STEP=FATAL device fatal event (details suppressed)", flush=True)
            last_stage = "FATAL"
            continue
        if response.get("id") != ident:
            continue
        print(f"[CHECK] STEP=RPC op={op} response=yes debugEvents={debug_count}", flush=True)
        return response
    raise TimeoutError(f"{op} の応答がありません。debugEvents={debug_count} lastStage={last_stage}。"
                 "本体が処理中または停止している可能性があります")

def print_status(response, stage):
    if "error" in response:
        print(f"[WARN] STEP={stage} status unavailable ({type(response['error']).__name__})")
        return
    result = response.get("result", {})
    if not isinstance(result, dict):
        return
    chat = result.get("chat") or {}
    audio = chat.get("audio") or {}
    heap = chat.get("memory") or {}
    op = result.get("usbOperation") or {}
    print(
        f"[CHECK] STEP={stage} state={chat.get('state', '?')} "
        f"inputEvents={audio.get('inputEvents', '?')} "
        f"recognizedEvents={audio.get('recognizedEvents', '?')} "
        f"internalFree={heap.get('internalFree', '?')} "
        f"internalLargest={heap.get('internalLargest', '?')} "
        f"psramFree={heap.get('psramFree', '?')} "
        f"photoPhase={op.get('phase', '?')} "
        f"usbBusy={op.get('active', '?')} operation={op.get('operation', 'none')} "
        f"timedOut={op.get('timedOut', '?')} elapsedMs={op.get('elapsedMs', '?')} "
        f"watchdogReset={op.get('watchdogReset', '?')} "
        f"watchdogStage={op.get('watchdogStage', '?')}"
    )

def recover(device, token, ident, duration=75):
    # Full native watchdog window; authenticated reads only, no /files or /status.
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        try:
            candidate = session.discover(expected=device)
            with serial.Serial(candidate['device'], baudrate=115200, timeout=.5,
                               write_timeout=3, exclusive=True) as port:
                response = request(port, token, ident, "/debug/status", {},
                                   min(4, max(.1, deadline-time.monotonic())))
                print_status(response, "RECOVERED")
                operation = (response.get('result') or {}).get('usbOperation') or {}
                if operation.get('active') is False:
                    print('[WARN] RTC compared with BEFORE; attribution to this attempt requires new evidence', flush=True)
                    return
                # A timeout reply is not cancellation. Observe until idle/reset,
                # keeping the original hub suspended within the bounded window.
                time.sleep(min(1, max(0, deadline-time.monotonic())))
        except (RuntimeError, serial.SerialException, OSError, TimeoutError):
            time.sleep(min(1, max(0, deadline-time.monotonic())))
    print('[ERROR] STEP=RECOVERY deadline expired; last stage in preceding events; photo outcome unknown', flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", default=None)
    p.add_argument("--allow-ai-on", action="store_true",
                   help="Explicitly test photo while voice/ASR is enabled; default is OFF-only")
    p.add_argument("--config", type=pathlib.Path, default=CONFIG,
                   help="Existing private firmware manifest (never printed)")
    p.add_argument("--managed-service", choices=["stackchan-hub.service"])
    p.add_argument("--initial-service", choices=["active", "inactive", "failed"])
    p.add_argument("--expected-device")
    args = p.parse_args()
    if not args.managed_service:
        # Direct invocation uses the same durable supervisor and confirmation.
        return session.launch(argparse.Namespace(port=args.port, service="stackchan-hub.service",
                              approved_once=False, allow_ai_on=args.allow_ai_on, config=args.config))
    lock = open(FW / 'dist/camera-logs/probe.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    expected = json.loads(args.expected_device) if args.expected_device else None
    if expected is None:
        fatal("PREFLIGHT", "USB identity must be supplied by supervisor")
    device = session.discover(expected=expected)
    args.port = device['device']
    if args.initial_service == 'active':
        subprocess.run(['systemctl', '--user', 'stop', args.managed_service], check=True, timeout=10)
    # systemd ExecStopPost restores the prior active state even on SIGKILL.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    atexit.register(lambda: print('[CHECK] STEP=END worker finished; see service journal for recovery', flush=True))
    nonce = secrets.randbelow(1000000000)
    photo_sent = False
    try:
        data = json.loads(args.config.read_text(encoding="utf-8"))
        token = data["config"]["archiveToken"]
        if not isinstance(token, str) or not token:
            raise ValueError("empty token")
    except (OSError, ValueError, KeyError, TypeError):
        fatal("CONFIG", "認証設定を読み込めません")

    print(f"[CHECK] STEP=USB camera probe port={args.port}")
    print("[WARN] カメラ撮影時はAI会話が一時中断されます")
    print("[WARN] 成功時は写真をSDカードに保存します。クラウド画像解析は呼び出しません")
    try:
        with serial.Serial(args.port, baudrate=115200, timeout=0.5, write_timeout=3, exclusive=True) as port:
            before = request(port, token, nonce, "/debug/status", {}, 8)
            print_status(before, "BEFORE")
            if "error" in before:
                fatal("PREFLIGHT", "撮影前の本体状態を確認できません")
            snapshot = before.get("result") or {}
            chat = snapshot.get("chat") or {}
            if not isinstance(chat, dict):
                fatal("PREFLIGHT", "AI状態を確認できません")
            operation = snapshot.get('usbOperation') or {}
            if operation.get('active') is not False:
                fatal('PREFLIGHT', '本体が処理中、または診断スナップショットが不明です')
            enabled, recognition = chat.get("enabled"), chat.get("recognitionMode")
            if not args.allow_ai_on and (enabled is not False or recognition is not False):
                print("[WARN] 現在はAI会話OFFの撮影テストを行います")
                fatal("PREFLIGHT", "本体のAI会話と文字起こしをOFFにしてから再実行してください "
                      f"(enabled={enabled}, recognitionMode={recognition}, state={chat.get('state', '?')})")
            photo_sent = True
            print("[ACTION] STEP=CAMERA 撮影だけを試行（analyze=false）")
            result = request(port, token, nonce+1, "/photo", {"analyze": False}, 30)
            if "error" in result:
                print("[ERROR] STEP=CAMERA " + "camera RPC failed (details suppressed)")
            else:
                data = result.get("result", {})
                if isinstance(data, dict):
                    print(f"[CHECK] STEP=CAMERA saved={data.get('image', data.get('name', '?'))} "
                          f"size={data.get('width', '?')}x{data.get('height', '?')}")
                else:
                    print("[CHECK] STEP=CAMERA capture returned")
            after = request(port, token, nonce+2, "/debug/status", {}, 8)
            print_status(after, "AFTER")
        if ((after.get('result') or {}).get('usbOperation') or {}).get('active') is True:
            recover(device, token, nonce+3)
            return 1
    except (serial.SerialException, OSError, TimeoutError) as error:
        print('[ERROR] STEP=USB transport lost; photoSent=' + str(photo_sent), flush=True)
        if isinstance(error, TimeoutError):
            print('[ERROR] STEP=TIMEOUT ' + str(error), flush=True)
        recover(device, token, nonce+3)
        fatal("USB", "撮影要求は再送しません。結果は不明です")
    print("[INFO] 成功・失敗を上のSTEP=CAMERAで判断してください")
    return 1 if "error" in result else 0

if __name__ == "__main__":
    raise SystemExit(main())
