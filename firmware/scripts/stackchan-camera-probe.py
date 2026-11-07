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
    while time.monotonic() < deadline:
        raw = port.readline()
        if not raw.startswith(b"@SC "):
            continue
        try:
            response = json.loads(raw[4:])
        except (ValueError, UnicodeError):
            continue
        if not isinstance(response, dict) or response.get("id") != ident:
            continue
        return response
    fatal("USB", f"{op} の応答がありません。ポート・ファームウェアの状態を確認してください")

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
    print(
        f"[CHECK] STEP={stage} state={chat.get('state', '?')} "
        f"inputEvents={audio.get('inputEvents', '?')} "
        f"recognizedEvents={audio.get('recognizedEvents', '?')} "
        f"internalFree={heap.get('internalFree', '?')} "
        f"internalLargest={heap.get('internalLargest', '?')} "
        f"psramFree={heap.get('psramFree', '?')}"
    )

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", default="/dev/ttyACM0")
    args = p.parse_args()
    try:
        data = json.loads(CONFIG.read_text(encoding="utf-8"))
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
