#!/usr/bin/env python3
"""Read-only CoreS3 UART boot investigation. Raw serial bytes remain local (0600).
Only fixed-category, redacted boot diagnostics are printed. Never transmits to device.
"""
import datetime
import os
from pathlib import Path
import re
import subprocess
import sys
import time

PORT = "/dev/ttyACM0"
RUNS = Path.home() / "Stackchan_Projects" / "runs"
DURATION = 65
MAX_BYTES = 2_000_000

PATTERNS = [
    ("rom", re.compile(r"^(?:ESP-ROM:|rst:|boot:|SPIWP:|mode:|load:|entry )", re.I)),
    ("bootloader", re.compile(r"^(?:I \([0-9]+\) boot:|I \([0-9]+\) esp_image:|E \([0-9]+\) boot:)", re.I)),
    ("panic", re.compile(r"(?:Guru Meditation Error|Core [01] panic|Backtrace:|abort\(\)|assert failed|stack smashing|Brownout detector|invalid header|flash read err|checksum failed)", re.I)),
    ("app", re.compile(r"^(?:\[startup-checkpoint\]|\[main\]|\[m5stackchan\]|No Wi-Fi SSID|\[boot\])", re.I)),
    ("reboot", re.compile(r"^(?:Rebooting|ets |rst:)", re.I)),
]

def emit(level, step, detail):
    print(f"[{level}] STEP={step} {detail}", flush=True)

def fatal(step, detail):
    emit("FATAL", step, detail)
    return 1

def main():
    emit("CHECK", "PRECHECK", "MODE=read_only RAW_LOCAL_ONLY=true DURATION=65s")
    try:
        from serial import Serial
        from serial.tools import list_ports
    except ImportError:
        return fatal("DEPENDENCY", "REASON=pyserial_missing")
    matches = [p for p in list_ports.comports() if p.device == PORT and p.vid == 0x303a and p.pid == 0x1001]
    if len(matches) != 1 or not matches[0].serial_number:
        return fatal("IDENTITY", "REASON=expected_Espressif_device_not_uniquely_identified")
    try:
        occupied = subprocess.run(["fuser", PORT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        return fatal("PORT", "REASON=cannot_check_occupancy")
    if occupied.returncode != 1:
        return fatal("PORT", "REASON=busy_or_occupancy_unknown")
    # The script is intentionally executed as `git show ... | python -`.
    # stdin is a pipe in that workflow; the user presses physical RST,
    # so no terminal input is needed. Keep diagnostics read-only.
    try:
        RUNS.mkdir(parents=True, exist_ok=True, mode=0o700)
        filename = RUNS / ("boot-raw-local-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S") + ".log")
        fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError as error:
        return fatal("LOG", "REASON=" + type(error).__name__)
    categories = {}
    bytes_read = 0
    lines_read = 0
    buf = b""
    started = time.monotonic()
    try:
        with os.fdopen(fd, "wb") as out:
            try:
                ser = Serial(port=None, baudrate=115200, timeout=0.3, exclusive=True)
                ser.dtr = False
                ser.rts = False
                ser.port = PORT
                ser.open()
            except Exception as error:
                return fatal("SERIAL", "REASON=" + type(error).__name__)
            with ser:
                emit("ACTION", "MANUAL_RST", "Press CoreS3 RST briefly ONCE now; no automatic reset")
                while time.monotonic() - started < DURATION:
                    try:
                        chunk = ser.read(2048)
                    except Exception as error:
                        return fatal("SERIAL", "REASON=" + type(error).__name__)
                    if not chunk:
                        continue
                    if bytes_read + len(chunk) > MAX_BYTES:
                        emit("WARN", "LIMIT", "REASON=raw_byte_limit")
                        break
                    out.write(chunk)
                    bytes_read += len(chunk)
                    buf += chunk
                    if len(buf) > 16384:
                        buf = buf[-8192:]
                    while b"\n" in buf:
                        raw, buf = buf.split(b"\n", 1)
                        lines_read += 1
                        line = raw.decode("utf-8", "replace").strip()
                        for name, pattern in PATTERNS:
                            if pattern.search(line):
                                categories[name] = categories.get(name, 0) + 1
                                # Never echo raw lines: they can contain secrets.
                                if categories[name] <= 15:
                                    if name == "rom":
                                        if line.startswith("ESP-ROM:"):
                                            emit("INFO", "BOOT", "ROM_HEADER_SEEN=true")
                                        elif line.startswith("rst:"):
                                            m = re.search(r"rst:(0x[0-9a-fA-F]+)", line)
                                            emit("INFO", "BOOT", "RESET_CODE=" + (m.group(1) if m else "unknown"))
                                        else:
                                            emit("INFO", "BOOT", "ROM_STAGE_EVENT=true")
                                    elif name == "panic":
                                        emit("WARN", "BOOT", "PANIC_PATTERN_DETECTED=true")
                                    elif name == "app":
                                        if line.startswith("[startup-checkpoint]"):
                                            m = re.search(r"step=([a-zA-Z0-9_-]+)", line)
                                            emit("INFO", "BOOT", "STARTUP_STEP=" + (m.group(1) if m else "unknown"))
                                        elif line.startswith("No Wi-Fi SSID"):
                                            emit("WARN", "BOOT", "WIFI_SSID_MISSING=true")
                                        else:
                                            emit("INFO", "BOOT", "APP_MARKER=" + line.split("]", 1)[0].lstrip("[")[:30] if line.startswith("[") else "APP_MARKER=other")
                                    else:
                                        emit("INFO", "BOOT", "CATEGORY=" + name)
                                break
            out.flush()
            os.fsync(out.fileno())
    finally:
        pass
    emit("INFO", "RESULT", f"BYTES={bytes_read} LINES={lines_read}")
    for name in ("rom", "bootloader", "panic", "app", "reboot"):
        emit("INFO", "RESULT", f"CATEGORY_{name.upper()}={categories.get(name, 0)}")
    emit("INFO", "LOG", f"RAW_PRIVATE_FILE={filename} DO_NOT_PUBLISH=true")
    if bytes_read == 0:
        emit("WARN", "RESULT", "NO_UART_BYTES_SEEN; inspect cable/reset/USB serial separately")
    else:
        emit("INFO", "RESULT", "RAW_UART_CAPTURED; classification does not establish successful boot")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
