#!/usr/bin/env python3
"""Probe CoreS3 camera via authenticated USB RPC without a cloud image request."""
import argparse
import json
import pathlib
import sys
import time

try:
    import serial
except ImportError:
    print("[FATAL] STEP=DEPENDENCY pyserial is required")
    raise SystemExit(2)

FW = pathlib.Path(__file__).resolve().parents[1]
CONFIG = FW / "host/app/manifest_archive_private.json"

def fatal(step, reason):
    print(f"[FATAL] STEP={step} {reason}", file=sys.stderr)
    raise SystemExit(1)

def request(port, token, ident, op, args, timeout=20):
    payload = {"id": ident, "token": token, "op": op, "args": args}
    port.write(("@SC " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8"))
    port.flush()
    deadline = time.monotonic() + timeout
    debug_count = 0
    last_stage = "-"
    while time.monotonic() < deadline:
        raw = port.readline()
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
                    last_stage = line.split("]", 1)[0][1:] + ": " + line.split("]", 1)[1].strip()[:110]
                    print("[INFO] " + line.replace("\r", " ").replace("\n", " ").strip()[:175], flush=True)
            continue
        if response.get("event") == "fatal":
            reason = str(response.get("reason", "?")).replace("\n", " ")[:90]
            detail = str(response.get("detail", "?")).replace("\n", " ")[:120]
            print("[ERROR] STEP=FATAL reason=" + reason + " detail=" + detail, flush=True)
            last_stage = "FATAL"
            continue
        if response.get("id") != ident:
            continue
        print(f"[CHECK] STEP=RPC op={op} response=yes debugEvents={debug_count}", flush=True)
        return response
    fatal("USB", f"{op} の応答がありません。debugEvents={debug_count} lastStage={last_stage}。"
                 "本体が処理中または停止している可能性があります")

def print_status(response, stage):
    if "error" in response:
        print(f"[WARN] STEP={stage} status unavailable ({str(response['error'])[:150]})")
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
        f"usbBusy={op.get('active', '?')} "
        f"watchdogReset={op.get('watchdogReset', '?')}"
    )

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", default="/dev/ttyACM0")
    p.add_argument("--config", type=pathlib.Path, default=CONFIG,
                   help="Existing private firmware manifest (never printed)")
    args = p.parse_args()
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
            print_status(request(port, token, 976001, "/status", {}, 8), "BEFORE")
            print("[ACTION] STEP=CAMERA 撮影だけを試行（analyze=false）")
            result = request(port, token, 976002, "/photo", {"analyze": False}, 30)
            if "error" in result:
                print("[ERROR] STEP=CAMERA " + str(result["error"]).replace("\n", " ")[:400])
            else:
                data = result.get("result", {})
                if isinstance(data, dict):
                    print(f"[CHECK] STEP=CAMERA saved={data.get('image', data.get('name', '?'))} "
                          f"size={data.get('width', '?')}x{data.get('height', '?')}")
                else:
                    print("[CHECK] STEP=CAMERA capture returned")
            print_status(request(port, token, 976003, "/status", {}, 8), "AFTER")
    except (serial.SerialException, OSError) as error:
        fatal("USB", "シリアルポートを開けません。miniterm等の占有を確認: " + str(error))
    print("[INFO] 成功・失敗を上のSTEP=CAMERAで判断してください")

if __name__ == "__main__":
    main()
