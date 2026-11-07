#!/usr/bin/env python3
"""Offline SDK patch regression: preserve unknown versions and apply idempotently."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "patch-core-s3-camera.py"
spec = importlib.util.spec_from_file_location("stackchan_camera_sdk_patch", FILE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

ORIGINAL = (
    "#define kCameraFrameCount (3)\n"
    "static camera_config_t camera_config = {\n"
    "    .fb_count = 3,\n"
    "    .fb_location = CAMERA_FB_IN_PSRAM,\n"
    "    .grab_mode = CAMERA_GRAB_LATEST, // vs. CAMERA_GRAB_WHEN_EMPTY\n"
    "};\n"
)


class CameraPatchTests(unittest.TestCase):
    def test_patch_exact_and_idempotent(self):
        changed = module.patch_source(ORIGINAL)
        self.assertIn("#define kCameraFrameCount (2)", changed)
        self.assertIn(".fb_count = 2,", changed)
        self.assertIn(".grab_mode = CAMERA_GRAB_WHEN_EMPTY,", changed)
        self.assertIn(".fb_location = CAMERA_FB_IN_PSRAM,", changed)
        self.assertEqual(module.patch_source(changed), changed)

    def test_active_camera_manifest_path(self):
        manifest = (ROOT.parent / "host" / "modules" / "camera" / "manifest_device.json").read_text()
        self.assertIn("$(MODDABLE)/modules/io/imagein/camera/esp32/camera", manifest)
        self.assertEqual(str(module.SRC), "modules/io/imagein/camera/esp32/camera.c")

    def test_unknown_sdk_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "Unexpected SDK"):
            module.patch_source(ORIGINAL.replace(".fb_count = 3,", ".fb_count = 4,"))

    def test_backup_and_repeat_apply(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / module.SRC
            path.parent.mkdir(parents=True)
            path.write_text(ORIGINAL)
            module.apply(temp)
            self.assertEqual(path.with_name(path.name + module.BACKUP_SUFFIX).read_text(), ORIGINAL)
            first = path.read_text()
            module.apply(temp)
            self.assertEqual(path.read_text(), first)


if __name__ == "__main__":
    unittest.main()
