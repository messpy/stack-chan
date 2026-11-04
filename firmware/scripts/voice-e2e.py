#!/usr/bin/env python3
"""Capture a real PC-speaker -> CoreS3 -> PC-mic trial; never infer physical PASS."""
import argparse
import datetime as dt
import json
import pathlib
import shlex
import subprocess
import sys
import time


def load_cases(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != 1:
        raise ValueError("Unsupported test-case schema")
    cases = data.get("cases", [])
    if not isinstance(cases, list) or len({c["id"] for c in cases}) != len(cases):
        raise ValueError("Duplicate or invalid case identifiers")
    return cases


def verdict(case, run, review):
    """A missing observation is UNVERIFIED, never PASS."""
    errors = []
    if run.get("capture_error"):
        errors.append("PC audio capture/playback failed")
    checks = review.get("checks", {})
    missing = []
    for name in case["required"]:
        item = checks.get(name, {})
        if item.get("verified") is False:
            errors.append(name + ": explicit failure")
        elif item.get("verified") is not True or not str(item.get("evidence", "")).strip():
            missing.append(name)
    if errors:
        return "FAIL", errors
    if missing:
        return "UNVERIFIED", ["missing external evidence: " + ", ".join(missing)]
    return "PASS", ["all required checks have human-reviewed evidence"]


def command(template, *, text=None, wav=None):
    argv = shlex.split(template)
    if not argv or not any("{text}" in part or "{wav}" in part for part in argv):
        raise ValueError("A command must contain a {text} or {wav} placeholder")
    return [part.replace("{text}", text or "").replace("{wav}", str(wav or "")) for part in argv]


def capture(args, case):
    out = args.output_dir / (dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + "-" + case["id"])
    out.mkdir(parents=True, exist_ok=False)
    wav = out / "pc-mic.wav"
    run = {
        "schema": 1,
        "case": case["id"],
        "stimulus": case["text"],
        "utc_started": dt.datetime.now(dt.timezone.utc).isoformat(),
        "firmware_sha": args.firmware_sha,
        "provider": args.provider,
        "capture_error": None,
        "pc_mic_wav": None,
        "device_response_verified": False,
    }
    recorder = None
    try:
        if args.record_command:
            record_argv = command(args.record_command, wav=wav)
            recorder = subprocess.Popen(record_argv, stdin=subprocess.DEVNULL)
            time.sleep(0.4)
            if recorder.poll() is not None:
                raise RuntimeError("PC recorder exited before stimulus")
        speak_argv = command(args.speak_command, text=case["text"])
        subprocess.run(speak_argv, check=True, timeout=args.timeout, stdin=subprocess.DEVNULL)
        if recorder:
            recorder.wait(timeout=args.timeout + 10)
            if recorder.returncode != 0 or not wav.is_file() or wav.stat().st_size < 44:
                raise RuntimeError("No valid PC mic WAV was recorded")
            run["pc_mic_wav"] = wav.name
    except (OSError, ValueError, subprocess.SubprocessError, RuntimeError) as error:
        run["capture_error"] = type(error).__name__ + ": " + str(error)[:200]
    finally:
        if recorder and recorder.poll() is None:
            recorder.terminate()
            try:
                recorder.wait(timeout=3)
            except subprocess.TimeoutExpired:
                recorder.kill()
                recorder.wait()
        (out / "run.json").write_text(json.dumps(run, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        review = {
            "checks": {
                key: {"verified": None, "evidence": ""}
                for key in case["required"]
            },
            "notes": "Review UART/Hub event ID, actual image, audio and physical behavior. Do not mark PASS from a transcript alone.",
        }
        (out / "review.json").write_text(json.dumps(review, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out, run


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=pathlib.Path, default=pathlib.Path(__file__).with_name("voice-e2e-cases.json"))
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("list", help="Print all stimuli without changing the device")
    run = sub.add_parser("capture", help="Run one PC audio trial; no device flash/write")
    run.add_argument("--case", required=True)
    run.add_argument("--speak-command", required=True, help="argv template containing {text}; never uses shell=True")
    run.add_argument("--record-command", help="optional argv template containing {wav}, e.g. arecord ... {wav}")
    run.add_argument("--output-dir", type=pathlib.Path, required=True)
    run.add_argument("--timeout", type=int, default=30)
    run.add_argument("--firmware-sha", default="UNKNOWN")
    run.add_argument("--provider", default="UNKNOWN")
    verify = sub.add_parser("evaluate", help="Strictly check human-reviewed evidence")
    verify.add_argument("--run-dir", type=pathlib.Path, required=True)
    args = parser.parse_args(argv)
    cases = load_cases(args.cases)
    lookup = {c["id"]: c for c in cases}
    if args.action == "list":
        for c in cases:
            print(c["id"] + ": " + c["text"] + " [" + ",".join(c["required"]) + "]")
        return 0
    if args.action == "capture":
        if args.case not in lookup:
            parser.error("Unknown case")
        if args.timeout < 1 or args.timeout > 600:
            parser.error("--timeout must be between 1 and 600 seconds")
        out, result = capture(args, lookup[args.case])
        print("[INFO] run=" + str(out))
        print("[WARN] PC audio only; inspect device logs and complete review.json before evaluation")
        if result["capture_error"]:
            print("[ERROR] " + result["capture_error"])
            return 1
        return 0
    run_data = json.loads((args.run_dir / "run.json").read_text(encoding="utf-8"))
    review = json.loads((args.run_dir / "review.json").read_text(encoding="utf-8"))
    if run_data.get("case") not in lookup:
        raise ValueError("Unknown run case")
    status, reasons = verdict(lookup[run_data["case"]], run_data, review)
    print("[" + status + "] " + run_data["case"] + " — " + "; ".join(reasons))
    return 0 if status == "PASS" else 1 if status == "FAIL" else 2


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
        print("[FATAL] STEP=E2E " + str(error), file=sys.stderr)
        sys.exit(3)
