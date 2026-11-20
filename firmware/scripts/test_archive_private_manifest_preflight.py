"""Ensure the production kmac preflight checks the *actual* copied private manifest."""

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


FIRMWARE = pathlib.Path(__file__).resolve().parents[1]
PAGE = FIRMWARE / "host/app/archive-web-page.js"
EXAMPLE = FIRMWARE / "host/app/manifest_archive.example.json"
SCRIPT = FIRMWARE / "scripts/kmac-pr39.sh"
ANCHOR = '  if ! python3 - "$PRIVATE_TARGET" "$FW/host/app/archive-web-page.js" <<\'PY\''


def embedded_preflight():
    script = SCRIPT.read_text(encoding="utf-8")
    start = script.index(ANCHOR) + len(ANCHOR)
    end = script.index("\nPY\n", start)
    return script[start:end].strip("\n") + "\n"


def run_preflight(data):
    with tempfile.TemporaryDirectory(prefix="stackchan-manifest-preflight-") as directory:
        private = pathlib.Path(directory) / "manifest_archive_private.json"
        private.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return subprocess.run(
            [sys.executable, "-", str(private), str(PAGE)],
            input=embedded_preflight(),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )


class ArchivePrivateManifestPreflightTests(unittest.TestCase):
    def test_existing_web_imports_are_registered(self):
        cfg = json.loads(EXAMPLE.read_text(encoding="utf-8"))
        self.assertNotIn("archive-alarm-upload-page", cfg["modules"])
        ok = run_preflight(cfg)
        self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
        self.assertIn("[CHECK] STEP=MANIFEST", ok.stdout)

    def test_missing_speaker_module_fails_before_build(self):
        cfg = json.loads(EXAMPLE.read_text(encoding="utf-8"))
        cfg["modules"].pop("archive-speaker-page")
        failed = run_preflight(cfg)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("archive-speaker-page", failed.stdout)

    def test_missing_image_module_fails_before_build(self):
        cfg = json.loads(EXAMPLE.read_text(encoding="utf-8"))
        cfg["modules"].pop("archive-image-page")
        failed = run_preflight(cfg)
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn("archive-image-page", failed.stdout)


if __name__ == "__main__":
    unittest.main()
