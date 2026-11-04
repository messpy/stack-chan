#!/usr/bin/env python3
"""Read-only UART log analyzer. Exit 1 for errors or missing required events."""
import argparse
import re
import sys
from pathlib import Path

def analyze(text):
    cases = {
        "head_command": (r"\[head-motion\] commanded direction=", "Command accepted; physical motion is NOT verified"),
        "volume_change": (r"\[volume\] changed from=\d+ to=\d+", "Volume setter changed value"),
        "camera_rejection": (r"\[vision\] rejected unrequested camera", "Unrequested camera call rejected"),
        "camera_authorization": (r"\[vision\] authorized camera", "Explicit camera request authorized"),
        "camera_result": (r"\[vision\] capture result status=", "Camera handler returned"),
    }
    failed = bool(re.search(r"\[head-motion\] failed|\[chat-tool\] failed|\[FATAL\]", text))
    for key, (pattern, description) in cases.items():
        status = "PASS" if re.search(pattern, text) else "UNKNOWN"
        print(f"[{status}] {key}: {description}")
    print("[UNKNOWN] physical_servo_motion: no servo position feedback available")
    print("[UNKNOWN] no_unrequested_camera: rejection observed does not prove absence of other captures")
    print("[FAIL]" if failed else "[INFO]", "error markers present" if failed else "no explicit failure marker found")
    return 1 if failed or any(not re.search(pattern, text) for pattern, _ in cases.values()) else 0

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("log", type=Path)
    args = parser.parse_args()
    if not args.log.is_file():
        print("[FATAL] STEP=LOG file missing", file=sys.stderr)
        return 1
    return analyze(args.log.read_text(encoding="utf-8", errors="replace"))

if __name__ == "__main__":
    sys.exit(main())
