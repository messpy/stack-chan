#!/usr/bin/env python3
"""Make saved VOICEVOX WAV actually audible on kmac during real acoustic E2E.

speak.py is allowed to synthesize and save only. This wrapper finds the newly
created WAV, then invokes a real PC playback command and checks its exit code.
A completed player process does not prove physical acoustic output.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import shutil
import subprocess
import sys


def wav_inventory(folder: Path) -> dict[Path, tuple[int, int]]:
    if not folder.is_dir():
        return {}
    return {p.resolve(): (p.stat().st_mtime_ns, p.stat().st_size)
            for p in folder.glob("*.wav") if p.is_file()}


def pick_new_wav(before: dict, after: dict) -> Path:
    changed = [p for p, stamp in after.items()
               if before.get(p) != stamp and stamp[1] >= 44]
    if len(changed) != 1:
        raise ValueError(f"VOICEVOX saved {len(changed)} new WAV files; expected exactly one")
    return changed[0]


def playback_command(path: Path, player: str, device: str | None) -> list[str]:
    if player == "auto":
        player = next((candidate for candidate in ("paplay", "pw-play", "aplay")
                       if shutil.which(candidate)), "")
    if player not in ("paplay", "pw-play", "aplay"):
        raise ValueError("No supported audio player found (paplay, pw-play, aplay)")
    if not shutil.which(player):
        raise ValueError(f"{player} executable not found")
    if device and player != "aplay":
        raise ValueError("--alsa-device requires --player aplay")
    return ([player, "-q", "-D", device, str(path)] if device else
            [player, "-q", str(path)] if player == "aplay" else
            [player, str(path)])


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--speak-script", type=Path,
                        default=Path("/home/kmac/work/camera-voicevox/speak.py"))
    parser.add_argument("--audio-dir", type=Path,
                        default=Path("/home/kmac/work/camera-voicevox/audio"))
    parser.add_argument("--player", default="auto", choices=("auto", "paplay", "pw-play", "aplay"))
    parser.add_argument("--alsa-device", help="ALSA card/device name; requires --player aplay")
    parser.add_argument("text", help="Japanese sentence to speak from PC speakers")
    args = parser.parse_args(argv)
    if not args.speak_script.is_file():
        print("[FATAL] STEP=PC_TTS speak.py not found", file=sys.stderr)
        return 3
    try:
        # Fail before spending time on synthesis if there is no player at all.
        audio = playback_command(Path("/dev/null"), args.player, args.alsa_device)
        before = wav_inventory(args.audio_dir)
        print("[ACTION] STEP=PC_TTS VOICEVOX synthesis", flush=True)
        synth = subprocess.run([sys.executable, str(args.speak_script), args.text],
                               stdin=subprocess.DEVNULL, timeout=90,
                               capture_output=True, text=True, errors="replace")
        if synth.returncode:
            print("[ERROR] STEP=PC_TTS speak.py exited nonzero: " + str(synth.returncode),
                  file=sys.stderr)
            return 1
        path = pick_new_wav(before, wav_inventory(args.audio_dir))
        if path.stat().st_size < 44:
            raise ValueError("VOICEVOX WAV is empty")
        audio[-1] = str(path)
        print("[INFO] STEP=PC_TTS 新規WAV=" + str(path), flush=True)
        print("[ACTION] STEP=PC_TTS PCスピーカーから再生 (player=" + audio[0] + ")", flush=True)
        subprocess.run(audio, stdin=subprocess.DEVNULL, timeout=90, check=True)
        print("[CHECK] STEP=PC_TTS 再生プロセス正常終了（実際に聞こえたかは目視・聴覚で確認）", flush=True)
        return 0
    except (ValueError, OSError, subprocess.TimeoutExpired, subprocess.CalledProcessError) as exc:
        print("[FATAL] STEP=PC_TTS " + type(exc).__name__ + ": " + str(exc)[:180],
              file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
