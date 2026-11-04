import importlib.util
import io
import pathlib
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

source = pathlib.Path(__file__).with_name("archive-usb-audit.py")
spec = importlib.util.spec_from_file_location("archive_usb_audit", source)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_safe_operations_are_read_only(self):
        self.assertEqual(audit.SAFE_OPERATIONS,
                         ("/debug/status", "/chat/status", "/settings/status", "/status"))

    def test_protocol_parses_only_prefixed_json(self):
        self.assertIsNone(audit.parse_usb_line(b"boot log\n"))
        self.assertIsNone(audit.parse_usb_line(b"@SC not-json\n"))
        self.assertEqual(audit.parse_usb_line(b'@SC {"id":3,"result":{"queued":0}}\n')["id"], 3)

    def test_status_restricts_fields(self):
        source = {"enabled": True, "recognitionMode": False, "provider": "xiaozhi",
                  "account": "private-account", "state": "listening"}
        result = audit.filtered_status("/chat/status", source, "token-placeholder")
        self.assertTrue(result["enabled"])
        self.assertNotIn("account", result)

    def test_passive_probe_never_transmits(self):
        class Port:
            dtr = False
            rts = False
            def open(self):
                pass
            def read(self, size):
                return b"boot\n"
            def close(self):
                pass
            def write(self, data):
                raise AssertionError("passive probe must not write")

        fake = types.SimpleNamespace(Serial=lambda **kwargs: Port(), SerialException=Exception)
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / "log.bin"
            with patch.dict(sys.modules, {"serial": fake}), redirect_stdout(io.StringIO()):
                result = audit.passive_probe("/dev/ttyACM0", 0.01, output)
            self.assertEqual(result, 0)
            self.assertGreater(output.stat().st_size, 0)


    def test_write_timeout_returns_transport_diagnostic_not_crash(self):
        class Timeout(Exception):
            pass
        class Port:
            dtr = False
            rts = False
            def open(self):
                pass
            def write(self, data):
                raise Timeout("Write timeout")
            def read_until(self, separator, limit):
                return b""
            def close(self):
                pass

        fake = types.SimpleNamespace(Serial=lambda **kwargs: Port(),
                                     SerialTimeoutException=Timeout,
                                     SerialException=Timeout)
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / "log.bin"
            printed = io.StringIO()
            with patch.dict(sys.modules, {"serial": fake}), redirect_stdout(printed):
                result = audit.run("/dev/ttyACM0", "test-token-placeholder",
                                   0.01, output)
            self.assertEqual(result, 2)
            self.assertIn("USB送信タイムアウト", printed.getvalue())
            self.assertNotIn("test-token-placeholder", printed.getvalue())


if __name__ == "__main__":
    unittest.main()
