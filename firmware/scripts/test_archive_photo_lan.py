import importlib.util
from pathlib import Path
import unittest

source = Path(__file__).with_name("archive-photo-lan.py")
spec = importlib.util.spec_from_file_location("archive_photo_lan", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LanPhotoTests(unittest.TestCase):
    def test_private_ip_only(self):
        self.assertEqual(module.safe_device_ip("192.168.210.123"), "192.168.210.123")
        self.assertEqual(module.safe_device_ip("10.42.0.1"), "10.42.0.1")
        for forbidden in ("127.0.0.1", "8.8.8.8", "169.254.1.2",
                          "example.com", "http://192.168.3.30:8082", "192.168.3.30:8082"):
            with self.subTest(ip=forbidden), self.assertRaises(ValueError):
                module.safe_device_ip(forbidden)

    def test_photo_field_allowlist(self):
        data = {"photo": {"phase": "error", "errorStage": "frame-wait",
                          "saved": False, "startedAt": 55,
                          "token": "secret", "rawImage": "private"}}
        filtered = module.filtered_photo(data)
        self.assertEqual(filtered["errorStage"], "frame-wait")
        self.assertNotIn("token", filtered)
        self.assertNotIn("rawImage", filtered)

    def test_missing_photo_is_not_success(self):
        with self.assertRaises(ValueError):
            module.filtered_photo({"camera": True})


if __name__ == "__main__":
    unittest.main()
