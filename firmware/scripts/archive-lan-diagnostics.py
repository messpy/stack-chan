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


def timestamps(obj, keys):
    data = obj if isinstance(obj, dict) else {}
    return {k: v if type(v) is int and 0 <= v < 10**14 else None
            for k in keys for v in [data.get(k)]}


def clean_turn(value):
    if not isinstance(value, dict):
        return None
    result = counters(value, ("epoch", "asrTurns", "replyTurns"))
    result.update(timestamps(value, ("startedAt", "lastAsrAt", "lastReplyAt",
        "postReplyAsrAt", "nativeStateAt", "disconnectedAt", "closedAt")))
    native = ("unknown", "connected", "speaking", "listening", "waiting", "failed", "disconnected")
    reason = ("none", "network", "memory-pressure", "authentication", "audio-upload-stalled", "audio-input-stalled", "other")
    result["lastNativeState"] = value.get("lastNativeState") if value.get("lastNativeState") in native else "unknown"
    result["failureClass"] = value.get("failureClass") if value.get("failureClass") in reason else "other"
    return result


def clean_snapshot(value: object) -> dict:
    if not isinstance(value, dict) or value.get("schema") != 1:
        raise ValueError("unsupported diagnostics response")
    boot = value.get("boot") if isinstance(value.get("boot"), dict) else {}
    heap = counters(value.get("heap"), ("internalFree", "internalLargest",
        "internalMinimum", "nativeStackMinimumFree", "psramFree",
        "psramLargest", "psramMinimum"))
    debug = counters(value.get("debug"), ("queued", "dropped", "truncated", "usbRetries"))
    servo = value.get("servo") if isinstance(value.get("servo"), dict) else {}
    chat = value.get("chat") if isinstance(value.get("chat"), dict) else {}
    raw_recovery = chat.get("memoryRecovery")
    recovery = counters(raw_recovery, ("failures", "limit"))
    recovery["stopped"] = isinstance(raw_recovery, dict) and raw_recovery.get("stopped") is True
    raw_admission = chat.get("lastMemoryAdmission")
    admission = None
    if isinstance(raw_admission, dict):
        at = raw_admission.get("at")
        admission = counters(raw_admission, (
            "internalFree", "internalLargest", "requiredFree", "requiredLargest",
            "shortfallFree", "shortfallLargest"))
        admission["at"] = at if type(at) is int and 0 <= at < 10**14 else None
        admission["status"] = (raw_admission.get("status")
            if raw_admission.get("status") in ("pass", "blocked", "unmeasured")
            else "unknown")
        admission["mode"] = (raw_admission.get("mode")
            if raw_admission.get("mode") in ("conversation", "transcription", "recognition-transport")
            else "unknown")
    raw_idle = value.get("idle") if isinstance(value.get("idle"), dict) else {}
    idle = counters(raw_idle, ("idleMs", "resetCount"))
    for key in ("stage", "displayed"):
        idle[key] = raw_idle.get(key) if raw_idle.get(key) in ("awake", "drowsy", "deep") else "unknown"
    raw_ui = value.get("ui") if isinstance(value.get("ui"), dict) else {}
    ui = {key: raw_ui.get(key) is True for key in (
        "available", "visible", "actionsVisible", "clockVisible", "batteryVisible", "wifiVisible")}
    ui["mode"] = raw_ui.get("mode") if raw_ui.get("mode") in ("face", "app") else "unknown"
    raw_network = value.get("network") if isinstance(value.get("network"), dict) else {}
    photo = value.get("photo") if isinstance(value.get("photo"), dict) else {}
    reason = boot.get("resetReasonCode")
    safe_reason = reason if type(reason) is int and 0 <= reason <= 100 else None
    uptime = boot.get("uptimeMs")
    safe_uptime = uptime if type(uptime) in (int, float) and 0 <= uptime < 1e14 else None
    raw_audio = value.get("audio") if isinstance(value.get("audio"), dict) else {}
    audio = counters(raw_audio, ("overrunBytes",
                                "sampleRate", "underruns", "overruns", "bufferedMs", "queuedMs", "reconnectCount"))
    audio.update(timestamps(raw_audio, ("lastInputAt", "lastSentAt", "lastASRAt", "postReplySentAt", "playbackDrainedAt")))
    for key in ("provider", "input", "output", "worker", "lastError", "phase"):
        audio[key] = safe_tag(raw_audio.get(key))
    for key in ("uploadEnabled", "playbackActive", "playbackDrained"):
        audio[key] = raw_audio.get(key) is True
    raw_turn = chat.get("turn") if isinstance(chat.get("turn"), dict) else {}
    turn = {key: clean_turn(raw_turn.get(key)) for key in ("current", "previous")}
    return {"idle": idle, "ui": ui, "network": {"connected": raw_network.get("connected") is True}, "audio": audio, "boot": {"resetReasonCode": safe_reason, "uptimeMs": safe_uptime}, "heap": heap, "debug": debug,
        "servo": {"lastReadFailure": safe_tag(servo.get("lastReadFailure"))},
        "chat": {"state": safe_tag(chat.get("state")),
                 "provider": safe_tag(chat.get("provider")),
                 "enabled": chat.get("enabled") is True,
                 "recognitionMode": chat.get("recognitionMode") is True,
                 "failureClass": safe_tag(chat.get("failureClass")),
                 "turn": turn,
                 "memoryRecovery": recovery,
                 "lastMemoryAdmission": admission},
        "photo": {"phase": safe_tag(photo.get("phase")),
                  "errorStage": None if photo.get("errorStage") is None
                                else safe_tag(photo.get("errorStage")),
                  "saved": photo.get("saved") is True,
                  "active": photo.get("active") is True}}


def clean_motor(value: object) -> dict:
    data = value if isinstance(value, dict) else {}
    power = data.get("power") if isinstance(data.get("power"), dict) else {}
    bus = data.get("bus") if isinstance(data.get("bus"), dict) else {}
    raw_output = power.get("output")
    output_enabled = (raw_output if type(raw_output) is bool
                      else bool(raw_output) if type(raw_output) is int and raw_output in (0, 1)
                      else None)
    result = {"power": {"available": power.get("available") if type(power.get("available")) is bool else None,
                        "output": output_enabled}}
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
