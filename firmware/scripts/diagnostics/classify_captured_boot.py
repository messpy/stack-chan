#!/usr/bin/env python3
"""Read-only review of a specific, already captured CoreS3 boot log.
Never prints arbitrary serial lines or uploads data.
"""
from pathlib import Path
import re
import sys

LOG = Path.home() / "Stackchan_Projects/runs/boot-raw-local-20261111-130326.log"
def emit(level, step, msg):
    print(f"[{level}] STEP={step} {msg}")

def main():
    emit("CHECK", "LOG", "MODE=read_only")
    if not LOG.is_file():
        emit("FATAL", "LOG", "REASON=known_log_missing")
        return 1
    data = LOG.read_bytes()
    if len(data) > 2_000_000:
        emit("FATAL", "LOG", "REASON=unexpected_size")
        return 1
    lines = data.decode("utf-8", "replace").splitlines()
    emit("INFO", "LOG", f"BYTES={len(data)} LINES={len(lines)}")
    for i, raw in enumerate(lines, 1):
        line = raw.strip()
        category = "other_suppressed"
        detail = ""
        if line.startswith("ESP-ROM:"):
            category = "rom_header"
        elif line.startswith("rst:"):
            category = "reset"
            match = re.search(r"rst:(0x[0-9a-fA-F]+)", line)
            detail = "CODE=" + (match.group(1) if match else "unknown")
        elif re.match(r"^(SPIWP:|mode:|load:|entry )", line):
            category = "flash_loader"
        elif line.startswith("[m5stackchan]"):
            category = "board_init"
        elif line.startswith("No Wi-Fi SSID"):
            category = "wifi_missing"
        elif line.startswith("[startup-checkpoint]"):
            category = "startup_checkpoint"
            for key in ("step", "state"):
                m = re.search(r"\b" + key + r"=([A-Za-z0-9_-]{1,48})", line)
                if m:
                    detail += (" " if detail else "") + key.upper() + "=" + m.group(1)
        elif re.search(r"Guru Meditation|Backtrace:|Brownout detector|abort\(\)|assert failed", line, re.I):
            category = "panic"
        emit("INFO", "LINE", f"N={i} CATEGORY={category}" + (" " + detail if detail else ""))
    emit("INFO", "RESULT", "RAW_LOG_REMAINS_LOCAL=true")
    return 0

if __name__ == "__main__":
    sys.exit(main())
