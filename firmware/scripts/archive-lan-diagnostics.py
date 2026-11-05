#!/usr/bin/env python3
"""Capture bounded, authenticated CoreS3 diagnostic snapshots to a private PC-side JSONL.
Read-only: GET /diagnostics. An optional one-time /motor-status poll touches the servo bus.
No raw logs, utterances, URLs, IPs, credentials or request tokens are saved.
"""
from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.request import Request, ProxyHandler, HTTPRedirectHandler, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError("redirect prohibited")


def private_ip(raw: str) -> str:
    ip = ipaddress.IPv4Address(raw)
    if not any(ip in ipaddress.IPv4Network(net) for net in
               ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("only RFC1918 private IPv4 is supported")
    return str(ip)


def counters(obj: object, keys: tuple[str, ...]) -> dict:
    data = obj if isinstance(obj, dict) else {}
    return {k: v if type(v) is int and 0 <= v < 10**12 else None
            for k in keys for v in [data.get(k)]}


def failure_class(text: object) -> str:
    value = str(text or "")[:160].lower()
    if re.search(r"timeout|timed out|タイムアウト", value):
        return "timeout"
    if re.search(r"crc|checksum|invalid|packet|framing|reply|response", value):
        return "invalid-reply"
    if re.search(r"uart|serial|bus|parity", value):
        return "bus-error"
    if re.search(r"power|voltage|電源", value):
        return "power-error"
    if re.search(r"unavailable|missing|not found", value):
        return "unavailable"
    return "unknown"


def safe_tag(value: object) -> str:
    if isinstance(value, str) and re.fullmatch(r"[a-z0-9-]{1,40}", value):
        return value
    return "unknown"


def clean_snapshot(value: object) -> dict:
    if not isinstance(value, dict) or value.get("schema") != 1:
        raise ValueError("unsupported diagnostics response")
    heap = counters(value.get("heap"), ("internalFree", "internalLargest",
        "internalMinimum", "nativeStackMinimumFree", "psramFree",
        "psramLargest", "psramMinimum"))
    debug = counters(value.get("debug"), ("queued", "dropped", "truncated", "usbRetries"))
    chat = value.get("chat") if isinstance(value.get("chat"), dict) else {}
    photo = value.get("photo") if isinstance(value.get("photo"), dict) else {}
    return {"heap": heap, "debug": debug,
        "chat": {"state": safe_tag(chat.get("state")),
                 "provider": safe_tag(chat.get("provider")),
                 "enabled": chat.get("enabled") is True,
                 "recognitionMode": chat.get("recognitionMode") is True,
                 "failureClass": safe_tag(chat.get("failureClass"))},
        "photo": {"phase": safe_tag(photo.get("phase")),
                  "errorStage": None if photo.get("errorStage") is None
                                else safe_tag(photo.get("errorStage")),
                  "saved": photo.get("saved") is True,
                  "active": photo.get("active") is True}}


def clean_motor(value: object) -> dict:
    data = value if isinstance(value, dict) else {}
    power = data.get("power") if isinstance(data.get("power"), dict) else {}
    bus = data.get("bus") if isinstance(data.get("bus"), dict) else {}
    result = {"power": {k: power.get(k) if type(power.get(k)) is bool else None
                        for k in ("available", "output")}}
    for axis in ("pan", "tilt"):
        item = data.get(axis) if isinstance(data.get(axis), dict) else {}
        result[axis] = {"success": item.get("success") is True,
                        "reasonClass": "none" if item.get("success") is True
                                       else failure_class(item.get("reason"))}
    result["bus"] = {k: v for k, v in list(bus.items())[:16]
                     if re.fullmatch(r"[a-zA-Z][a-zA-Z0-9]{0,28}", str(k))
                     and type(v) in (int, bool) and (type(v) is bool or 0 <= v < 10**12)}
    return result


def read_json(opener, url: str, token: str, payload=None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers,
                  method="GET" if data is None else "POST")
    with opener.open(req, timeout=8) as reply:
        if reply.status != 200:
            raise ValueError("HTTP request failed")
        raw = reply.read(16385)
    if len(raw) > 16384:
        raise ValueError("response size exceeded")
    result = json.loads(raw)
    if not isinstance(result, dict) or "error" in result:
        raise ValueError("device reported an error")
    return result


def sample(ip: str, token: str, samples: int, interval: float,
           output: Path, motor_once: bool = False) -> tuple[int, int]:
    opener = build_opener(ProxyHandler({}), NoRedirect())
    base = "http://" + private_ip(ip) + ":8082"
    output.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(output), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    ok = 0
    errors = 0
    with os.fdopen(fd, "w", encoding="utf-8") as logfile:
        if motor_once:
            # Never probe the servo repeatedly: a read shares its half-duplex UART.
            try:
                motor = read_json(opener, base + "/rpc", token,
                                  {"op": "/motor-status", "args": {}})
                logfile.write(json.dumps({"type": "motor-once", "motor": clean_motor(motor)}) + "\n")
            except (OSError, ValueError, TimeoutError, json.JSONDecodeError):
                logfile.write('{"type":"motor-once","errorClass":"unavailable"}\n')
                errors += 1
        for index in range(samples):
            record = {"type": "snapshot",
                      "at": dt.datetime.now(dt.timezone.utc).isoformat()}
            try:
                data = read_json(opener, base + "/diagnostics", token)
                record["status"] = "ok"
                record["data"] = clean_snapshot(data)
                ok += 1
            except (OSError, ValueError, TimeoutError, json.JSONDecodeError):
                record["status"] = "unavailable"
                errors += 1
            logfile.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
            logfile.flush()
            if index < samples - 1:
                time.sleep(interval)
    return ok, errors


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ip", required=True)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--samples", type=int, default=1)
    parser.add_argument("--interval", type=float, default=2)
    parser.add_argument("--motor-once", action="store_true",
                        help="read servo bus once before sampling; only while motion is stopped")
    args = parser.parse_args(argv)
    if not (1 <= args.samples <= 1800 and 0.5 <= args.interval <= 60):
        parser.error("samples must be 1..1800 and interval 0.5..60 seconds")
    try:
        private_ip(args.ip)
        config = json.loads(args.config.read_text(encoding="utf-8"))
        token = config.get("config", {}).get("archiveToken")
        if not isinstance(token, str) or len(token) < 16:
            raise ValueError("local private token not available")
        ok, errors = sample(args.ip, token, args.samples, args.interval,
                            args.output, args.motor_once)
        print(f"[CHECK] STEP=LAN_DIAG samples_ok={ok}/{args.samples} errors={errors}")
        print(f"[INFO] STEP=LAN_DIAG private_output={args.output} (0600; no raw device logs)")
        return 0 if ok == args.samples and errors == 0 else 2
    except (OSError, ValueError, json.JSONDecodeError) as err:
        print("[FATAL] STEP=LAN_DIAG " + type(err).__name__ + " (inspect IP, port, config and permissions)",
              file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
