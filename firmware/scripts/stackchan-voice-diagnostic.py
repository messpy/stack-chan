#!/usr/bin/env python3
"""StackChan CoreS3 USB voice diagnostics; transient transcript logging only."""
import argparse
import datetime
import json
import pathlib
import re
import sys
import time

try:
    import serial
except ImportError:
    print("[FATAL] STEP=DEPENDENCIES pyserialが必要です（python3 -m pip install pyserial）")
    sys.exit(2)

ROOT = pathlib.Path(__file__).resolve().parents[1]
CONFIG = ROOT / "host/app/manifest_archive_private.json"
OUTPUT = ROOT / "dist/diagnostics"
PORT_DEFAULT = "/dev/ttyACM0"
INTERESTING = re.compile(
    r"\[(?:dialog|asr|llm|chat-tool|direct-chat|microphone|recognition|"
    r"xiaozhi|playback|vision|archive|heap|camera)\]",
    re.IGNORECASE,
)

def fail(step, why):
    print(f"[FATAL] STEP={step} {why}", file=sys.stderr)
    raise SystemExit(1)

def get_auth():
    try:
        auth = json.loads(CONFIG.read_text(encoding="utf8"))["config"]["archiveToken"]
    except (OSError, KeyError, TypeError, ValueError):
        fail("CONFIG", "manifest_archive_private.jsonの認証情報を読み取れません")
    if not isinstance(auth, str) or not auth:
        fail("CONFIG", "archiveTokenが未設定です")
    return auth

def summarize(data):
    if not isinstance(data, dict):
        return
    chat = data.get("chat") if isinstance(data.get("chat"), dict) else data
    audio = chat.get("audio", {}) if isinstance(chat.get("audio"), dict) else {}
    memory = chat.get("memory", {}) if isinstance(chat.get("memory"), dict) else {}
    print(
        "[CHECK] state={state} provider={provider} asr={asr} "
        "input={input} output={output} peak={peak} heap={heap}".format(
            state=chat.get("state", "?"), provider=chat.get("provider", "?"),
            asr=audio.get("recognizedEvents", "?"),
            input=audio.get("inputEvents", "?"),
            output=audio.get("outputEvents", "?"),
            peak=audio.get("inputPeak", "?"),
            heap=memory.get("internalFree", "?"),
        ), flush=True
    )
    if chat.get("state") not in ("listening", "speaking"):
        for key in ("error", "detail"):
            value = chat.get(key)
            if value:
                normalized = str(value).replace("\r", " ").replace("\n", " ")[:160]
                print(f"[WARN] connection_{key}={normalized}", flush=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", default=PORT_DEFAULT)
    ap.add_argument("--seconds", type=int, default=45)
    args = ap.parse_args()
    if not 10 <= args.seconds <= 180:
        fail("CONFIG", "--secondsは10〜180を指定")
    token = get_auth()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    out = OUTPUT / ("voice-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + ".log")
    port = None
    pending = {}
    counter = 100
    collecting = False
    started = time.monotonic()
    last_status_at = 0
    print(f"[CHECK] USB={args.port} 診断時間={args.seconds}秒")
    print("[WARN] 認識された音声・AI応答の本文をPCに記録します。秘密情報を話さないでください。")
    print(f"[INFO] 出力ファイル: {out}")
    def send(op, args_dict=None):
        nonlocal counter
        counter += 1
        request = {"id": counter, "token": token, "op": op, "args": args_dict or {}}
        packet = "@SC " + json.dumps(request, ensure_ascii=False, separators=(",", ":")) + "\n"
        port.write(packet.encode("utf-8"))
        port.flush()
        pending[counter] = op
        return counter
    try:
        try:
            port = serial.Serial(args.port, baudrate=115200, timeout=0.35,
                                 write_timeout=2, exclusive=True)
        except (serial.SerialException, OSError) as e:
            fail("USB", "ポートが使えません（miniterm等の使用を終了してください）: " + str(e))
        with out.open("w", encoding="utf8") as log:
            send("/status")
            send("/debug/conversation", {"enabled": True})
            collecting = True
            print("[ACTION] 今から「写真を撮って」と話してください。緑色の変化も観察してください。")
            while time.monotonic() - started < args.seconds:
                if time.monotonic() - last_status_at >= 10:
                    send("/status")
                    last_status_at = time.monotonic()
                raw = port.readline()
                if not raw or not raw.startswith(b"@SC "):
                    continue
                try:
                    message = json.loads(raw[4:])
                except (ValueError, UnicodeDecodeError):
                    continue
                if not isinstance(message, dict):
                    continue
                if message.get("event") == "debug":
                    lines = message.get("lines", [])
                    for line in lines if isinstance(lines, list) else []:
                        if not isinstance(line, str) or not INTERESTING.search(line):
                            continue
                        line = line.replace("\r", " ").strip()[:1000]
                        if not line:
                            continue
                        stamp = datetime.datetime.now().strftime("%H:%M:%S")
                        entry = f"[{stamp}] {line}"
                        print(entry, flush=True)
                        log.write(entry + "\n")
                        log.flush()
                elif isinstance(message.get("id"), int) and message["id"] in pending:
                    operation = pending.pop(message["id"])
                    if "error" in message:
                        print(f"[ERROR] {operation}: {str(message['error'])[:220]}")
                    elif operation == "/status":
                        summarize(message.get("result", {}))
                    elif operation == "/debug/conversation":
                        setting = message.get("result", {})
                        print(f"[CHECK] 文字ログ有効化={setting.get('enabled') if isinstance(setting, dict) else setting}")
            print("[CHECK] 診断採取終了")
    except KeyboardInterrupt:
        print("\n[INFO] Ctrl+Cを検知。診断を停止します")
    except (serial.SerialException, OSError) as e:
        print(f"[ERROR] USB通信エラー: {e}")
    finally:
        if port and port.is_open:
            if collecting:
                try:
                    send("/debug/conversation", {"enabled": False})
                    time.sleep(0.35)
                    print("[INFO] 会話本文ログの無効化を要求しました")
                except (OSError, serial.SerialException):
                    print("[WARN] ログ無効化を送信できませんでした。本体を再起動してください")
            port.close()
    print(f"[INFO] 保存先={out}")
    print("[INFO] 出力ログには会話本文が含まれます。公開する場合は本文を伏せてください。")

if __name__ == "__main__":
    main()
