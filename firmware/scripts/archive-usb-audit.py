#!/usr/bin/env python3
"""Read-only Archive CoreS3 USB diagnostics. Never prints the private token.

Works with the release Archive's authenticated '@SC ' JSON protocol.
Only non-mutating operations are allowed. Opening a USB CDC port can affect
its host control lines; this tool requests DTR/RTS low and never reboots/flashes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys
import time

SAFE_OPERATIONS = ("/debug/status", "/chat/status", "/settings/status", "/status")
DIAGNOSTIC_MARKER = re.compile(
    r"\[(?:boot|boot-mode|mode-session|mode-voice|asr|llm|direct-chat|"
    r"recognition|speaker|settings|heap|volume|archive-camera|chat-tool|"
    r"debug|vision|audio|head-motion|fatal)\]|"
    r"\b(?:panic|brownout|watchdog|reboot|Guru Meditation)\b",
    re.IGNORECASE,
)
BAD_MARKER = re.compile(r"\b(?:panic|brownout|watchdog|Guru Meditation)\b|\[fatal\]", re.IGNORECASE)


def manifest_path(value: str | None) -> Path:
    if value:
        return Path(value).expanduser().resolve()
    named = os.environ.get("STACKCHAN_ARCHIVE_CONFIG")
    if named:
        return Path(named).expanduser().resolve()
    for root in (Path.cwd(), Path(__file__).resolve().parent.parent.parent):
        for path in (
            root / "firmware/host/app/manifest_archive_private.json",
            root / "host/app/manifest_archive_private.json",
        ):
            if path.is_file():
                return path.resolve()
    raise ValueError("private manifestがありません。StackChan repoで実行するか --config を指定")


def load_token(path: Path) -> str:
    source = json.loads(path.read_text(encoding="utf-8"))
    token = source.get("config", {}).get("archiveToken")
    if not isinstance(token, str) or len(token) < 16:
        raise ValueError("private manifestの config.archiveToken がありません")
    return token


def redacted_detail(value: object, token: str) -> str:
    # Display only typed, short status, never echo credential-bearing free text.
    return str(value or "").replace(token, "[redacted]")[:130]


def filtered_status(op: str, result: object, token: str) -> dict:
    result = result if isinstance(result, dict) else {}
    if op == "/chat/status":
        audio = result.get("audio", {})
        return {
            "enabled": result.get("enabled"),
            "recognitionMode": result.get("recognitionMode"),
            "provider": result.get("provider"),
            "state": result.get("state"),
            "busy": result.get("busy"),
            "errorPresent": bool(result.get("error")),
            "audio": {k: v for k, v in (audio if isinstance(audio, dict) else {}).items()
                      if k in ("recognizedEvents", "lastTranscriptAt", "inputFrames",
                               "outputFrames", "underruns", "inputBytes", "outputBytes")
                      and isinstance(v, (str, int, float, bool, type(None)))},
        }
    if op == "/settings/status":
        return {k: result.get(k) for k in
                ("loadError", "unreadableSlots", "generation", "chatMode",
                 "transcriptionMode", "connected", "connection", "clockReady")}
    if op == "/debug/status":
        return {k: result.get(k) for k in ("queued", "dropped", "truncated", "usbRetries")}
    if op == "/status":
        return {"sd": result.get("sd"), "busy": result.get("busy"),
                "camera": result.get("camera"),
                "lastErrorPresent": bool(result.get("lastError")),
                "wifiConnected": (result.get("wifi") or {}).get("connected")
                if isinstance(result.get("wifi"), dict) else None}
    return {}


def select_port(value: str | None) -> str:
    if value:
        if not re.fullmatch(r"/dev/tty(?:ACM|USB)\d+", value):
            raise ValueError("--port は /dev/ttyACM* または /dev/ttyUSB* を指定")
        return value
    import glob
    ports = sorted(glob.glob("/dev/ttyACM*") + glob.glob("/dev/ttyUSB*"))
    if len(ports) != 1:
        raise ValueError("USBシリアルを1台にするか --port /dev/ttyACM0 を指定")
    return ports[0]


def parse_usb_line(raw: bytes) -> dict | None:
    # Native firmware prefixes JSON on its own line; ignore unrelated boot
    # output and do not print arbitrary serial bytes.
    try:
        text = raw.decode("utf-8", errors="replace").strip()
        if not text.startswith("@SC "):
            return None
        value = json.loads(text[4:])
        return value if isinstance(value, dict) else None
    except (ValueError, UnicodeError):
        return None


def summarize_debug_line(line: str, token: str) -> str | None:
    if not DIAGNOSTIC_MARKER.search(line):
        return None
    clean = line.replace(token, "[redacted]").strip()
    # A diagnostic line might still contain arbitrary remote text. Only emit
    # recognized event name + bounded numeric/enum summary to stdout.
    marker = re.search(r"\[([a-z][a-z-]*)\]", clean, re.IGNORECASE)
    if not marker:
        return "system critical marker (inspect local private log)"
    name = marker.group(1).lower()
    fields = []
    for field in ("reset_reason", "generation", "loadError", "chat", "transcription",
                  "mode", "state", "direction", "chars", "internalFree", "psramFree",
                  "connected", "unreadableSlots", "percent", "elapsedMs"):
        match = re.search(r"\b" + re.escape(field) +
                          r"=([A-Za-z0-9_.-]+)", clean)
        if match:
            fields.append(f"{field}={match.group(1)[:32]}")
    # Fixed short whitelisted phrases are safe; not contents of ASR/LLM.
    phrase = ""
    for candidate in ("restored conversation ON", "restored transcription ON",
                      "restored explicit OFF", "restore blocked", "restore failed",
                      "final", "output_final", "connected", "closing native session",
                      "capture begin", "saved", "reconnect scheduled",
                      "release logging enabled"):
        if candidate in clean:
            phrase = candidate
            break
    return f"[{name}] {phrase} {' '.join(fields)}".strip()


def passive_probe(serial_port: str, seconds: float, output: Path) -> int:
    """Read-only USB probe. No writes, commands, reset, or need for Archive token."""
    import serial

    output.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite the old log; contents may include private debug output.
    handle = os.open(str(output), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    bytes_read = 0
    lines_read = 0
    try:
        with os.fdopen(handle, "wb") as logfile:
            port = serial.Serial(port=None, baudrate=115200, timeout=0.25)
            port.dtr = False
            port.rts = False
            port.port = serial_port
            try:
                port.open()
                print(f"[CHECK] PASSIVE USB={serial_port}; DTR/RTS=off; writes=0")
                print(f"[INFO] local_log={output} (mode=0600; do not paste raw log)")
                end = time.monotonic() + seconds
                while time.monotonic() < end:
                    chunk = port.read(512)
                    if chunk:
                        bytes_read += len(chunk)
                        lines_read += chunk.count(b"\n")
                        logfile.write(chunk)
            finally:
                port.close()
    except serial.SerialException:
        print("[WARN] USBを読み取れません。抜き差し・占有プロセス・デバイス権限を確認")
        return 2
    print(f"[CHECK] passive_bytes={bytes_read} newlines={lines_read} sent_requests=0")
    if bytes_read == 0:
        print("[WARN] USBから受信なし（リリース版は通常ログを蓄積するため、無応答のみではハングと断定不可）")
    else:
        print("[INFO] USB受信あり。起動/デバッグ内容はローカルの非公開ログに保存")
    return 0


def run(serial_port, token: str, seconds: float, output: Path) -> int:
    import serial

    # Open without enabling DTR/RTS; do not deliberately pulse device reset.
    port = serial.Serial(port=None, baudrate=115200, timeout=0.18, write_timeout=2)
    port.dtr = False
    port.rts = False
    port.port = serial_port
    output.parent.mkdir(parents=True, exist_ok=True)
    # Private raw debug log is local only (contains device-internal messages).
    handle = os.open(str(output), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    count = 0
    match_count = 0
    response_count = 0
    request_id = 0
    responses: dict[str, dict] = {}
    pending: dict[int, str] = {}
    errors = []
    raw_overflow = False
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as logfile:
            port.open()
            print(f"[CHECK] USB={serial_port}; baud=115200; DTR/RTS=off")
            print(f"[INFO] local_log={output} (mode=0600; paste summaries only)")
            start = time.monotonic()
            last_send = start - 0.5
            # Send read-only commands one at a time to minimize native serial backlog.
            queries = list(SAFE_OPERATIONS)
            while time.monotonic() - start < seconds:
                now = time.monotonic()
                if queries and not pending and now - last_send >= 0.35:
                    op = queries.pop(0)
                    request_id += 1
                    req = {"id": request_id, "token": token, "op": op, "args": {}}
                    wire = ("@SC " + json.dumps(req, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
                    try:
                        written = port.write(wire)
                        if written != len(wire):
                            errors.append(f"{op}: USB short write")
                            print("[WARN] USB送信が途中で停止。実機の受信ループ/ポート状態を確認")
                            break
                    except serial.SerialTimeoutException:
                        errors.append(f"{op}: USB write timeout")
                        print("[WARN] USB送信タイムアウト。本体が読み取っていない可能性があります。追加の要求を中止")
                        break
                    except serial.SerialException:
                        errors.append(f"{op}: USB transport failure")
                        print("[WARN] USB通信が切断または停止しました。追加の要求を中止")
                        break
                    pending[request_id] = op
                    last_send = now
                raw = port.read_until(b"\n", 16384)
                if not raw:
                    # The USB reader must not stall on a missing answer indefinitely.
                    if pending and time.monotonic() - last_send > 2.5:
                        for n, op in list(pending.items()):
                            errors.append(f"{op}: response timeout")
                            pending.pop(n)
                    continue
                value = parse_usb_line(raw)
                if not value:
                    continue
                if value.get("event") == "debug":
                    for item in value.get("lines", []) if isinstance(value.get("lines"), list) else []:
                        if not isinstance(item, str):
                            continue
                        clean = item.replace(token, "[redacted]")
                        logfile.write(clean + ("" if clean.endswith("\n") else "\n"))
                        count += 1
                        summary = summarize_debug_line(clean, token)
                        if summary:
                            match_count += 1
                            if match_count <= 85:
                                print("[DEBUG] " + summary)
                    continue
                n = value.get("id")
                if not isinstance(n, int) or n not in pending:
                    continue
                response_count += 1
                op = pending.pop(n)
                if "error" in value:
                    errors.append(f"{op}: device returned error (details kept private)")
                    continue
                filtered = filtered_status(op, value.get("result"), token)
                responses[op] = filtered
                print("[STATUS] " + op + " " + json.dumps(filtered, ensure_ascii=False))
            if match_count > 85:
                print(f"[INFO] more debug event summaries suppressed: {match_count - 85}")
            logfile.flush()
    finally:
        try:
            port.close()
        except Exception:
            pass
    print(f"[CHECK] requests_answered={response_count}/4 buffered_messages={count} tagged={match_count}")
    if errors:
        for message in errors:
            print("[WARN] " + message)
    if not response_count:
        print("[WARN] 認証済みの応答なし。USBポート/本体受信ループ/アプリ起動/manifest tokenを調査")
        return 2
    chat = responses.get("/chat/status", {})
    store = responses.get("/settings/status", {})
    if store.get("loadError"):
        print("[WARN] #34: 暗号化設定を読み取れない状態")
    elif store and chat and (
        bool(store.get("chatMode")) != bool(chat.get("enabled")) or
        bool(store.get("transcriptionMode")) != bool(chat.get("recognitionMode"))
    ):
        print("[WARN] #34: SD保存値とランタイムON/OFFが一致しません")
    elif store and chat:
        print("[INFO] #34: 保存値とランタイムモード表示は一致（再起動保持と音声応答は別途要検証）")
    if not count:
        print("[WARN] デバッグイベントを受信していません。これだけで動作不良とは判断しません")
    print("[INFO] #37: 過去の録音との時刻対応が未検証ならASR/LLM動作をPASSにはできません")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", help="USB Serial/JTAG port; otherwise auto-select unique port")
    parser.add_argument("--passive", action="store_true",
                        help="read USB only; never send token/commands, useful after write timeout")
    parser.add_argument("--config", help="Local private Archive manifest (read-only)")
    parser.add_argument("--seconds", type=float, default=13,
                        help="USB debug read duration (3..120 s, default 13)")
    parser.add_argument("--output", type=Path, help="Private debug log filename (no overwrite)")
    args = parser.parse_args(argv)
    if not 3 <= args.seconds <= 120:
        parser.error("--seconds must be between 3 and 120")
    try:
        serial_port = select_port(args.port)
        output = args.output or (Path.home() / "stackchan-diagnostics" /
                 ("usb-" + ("passive-" if args.passive else "debug-") +
                  dt.datetime.now().strftime("%Y%m%d-%H%M%S-%f") + ".log"))
        if args.passive:
            return passive_probe(serial_port, args.seconds, output)
        config = manifest_path(args.config)
        token = load_token(config)
        return run(serial_port, token, args.seconds, output)
    except ModuleNotFoundError as exc:
        print("[FATAL] pyserialがありません: " + str(exc), file=sys.stderr)
        return 3
    except (OSError, ValueError) as exc:
        print("[FATAL] " + str(exc), file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
