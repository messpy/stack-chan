import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

source = Path(__file__).with_name("archive-lan-diagnostics.py")
spec = importlib.util.spec_from_file_location("archive_lan_diagnostics", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LanDiagnosticsTests(unittest.TestCase):
    def test_audio_snapshot(self):
        audio = module.clean_snapshot({"schema": 1, "audio": {"provider": "xiaozhi", "input": "running",
            "output": "closed", "worker": "running", "uploadEnabled": False,
            "lastInputAt": 1200, "lastSentAt": 1000, "lastASRAt": 900,
            "sampleRate": 24000, "underruns": 2, "overrunBytes": 1920,
            "reconnectCount": 1, "lastError": "audio", "transcript": "SECRET"}})["audio"]
        self.assertEqual(audio["lastSentAt"], 1000)
        self.assertEqual(audio["underruns"], 2)
        self.assertFalse(audio["uploadEnabled"])
        self.assertEqual(audio["overrunBytes"], 1920)
        self.assertNotIn("SECRET", json.dumps(audio))

    def test_memory_recovery_snapshot(self):
        cleaned = module.clean_snapshot({"schema": 1, "chat": {"memoryRecovery": {
            "failures": 3, "limit": 3, "stopped": True, "token": "SECRET"}}})
        self.assertEqual(cleaned["chat"]["memoryRecovery"],
                         {"failures": 3, "limit": 3, "stopped": True})
        self.assertNotIn("SECRET", json.dumps(cleaned))

    def test_ui_network_allowlist(self):
        cleaned = module.clean_snapshot({"schema": 1, "ui": {"available": True,
            "visible": True, "batteryVisible": True, "mode": "face", "title": "SECRET"},
            "network": {"connected": True, "ssid": "SECRET"}})
        self.assertTrue(cleaned["ui"]["batteryVisible"])
        self.assertTrue(cleaned["network"]["connected"])
        self.assertNotIn("SECRET", json.dumps(cleaned))

    def test_lan_only(self):
        self.assertEqual(module.private_ip("192.168.2.102"), "192.168.2.102")
        for value in ("8.8.8.8", "127.0.0.1", "169.254.1.2",
                      "http://192.168.2.102", "localhost", "100.100.100.100"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.private_ip(value)

    def test_snapshot_drops_secrets_and_raw_logs(self):
        value = {"schema": 1, "boot": {"resetReasonCode": 9, "uptimeMs": 155000},
                 "heap": {"internalFree": 76659, "internalLargest": 31744,
                          "token": "SECRET"},
                 "servo": {"lastReadFailure": "timeout", "reason": "PRIVATE"},
                 "chat": {"state": "retrying", "provider": "xiaozhi",
                          "lastMemoryAdmission": {"status": "blocked", "mode": "transcription", "at": 1793859000000, "internalFree": 76659, "internalLargest": 31744, "requiredFree": 114688, "requiredLargest": 24576, "shortfallFree": 38029, "shortfallLargest": 0, "secret": "SECRET"},
                          "failureClass": "memory-pressure",
                          "detail": "PRIVATE CHAT"},
                 "photo": {"phase": "error", "errorStage": "frame-wait",
                           "pixels": "PRIVATE IMAGE"},
                 "debug": {"queued": 5, "dropped": 1, "lines": ["PRIVATE LOG"]}}
        cleaned = module.clean_snapshot(value)
        self.assertEqual(cleaned["heap"]["internalFree"], 76659)
        self.assertEqual(cleaned["boot"]["resetReasonCode"], 9)
        self.assertEqual(cleaned["boot"]["uptimeMs"], 155000)
        self.assertEqual(cleaned["chat"]["failureClass"], "memory-pressure")
        self.assertEqual(cleaned["chat"]["lastMemoryAdmission"]["shortfallFree"], 38029)
        self.assertEqual(cleaned["chat"]["lastMemoryAdmission"]["at"], 1793859000000)
        self.assertEqual(cleaned["chat"]["lastMemoryAdmission"]["mode"], "transcription")
        self.assertEqual(cleaned["debug"]["dropped"], 1)
        self.assertEqual(cleaned["servo"]["lastReadFailure"], "timeout")
        rendered = json.dumps(cleaned)
        for secret in ("SECRET", "PRIVATE", "token", "lines"):
            self.assertNotIn(secret, rendered)

    def test_admission_labels_must_match_known_values(self):
        snap = module.clean_snapshot({"schema": 1, "chat": {
            "lastMemoryAdmission": {"status": "secret", "mode": "secret",
                "at": -5, "internalFree": -1,
                "requiredFree": 114688, "shortfallFree": 38029,
                "accessToken": "PRIVATE_SECRET"}
        }})
        admission = snap["chat"]["lastMemoryAdmission"]
        self.assertEqual(admission["status"], "unknown")
        self.assertEqual(admission["mode"], "unknown")
        self.assertIsNone(admission["at"])
        self.assertIsNone(admission["internalFree"])
        self.assertEqual(admission["shortfallFree"], 38029)
        self.assertNotIn("PRIVATE_SECRET", json.dumps(snap))

    def test_motor_drops_native_text_and_exposes_reason_class(self):
        raw = {"pan": {"success": False, "reason": "UART timeout secret=ABC"},
               "tilt": {"success": False, "reason": "CRC invalid"},
               "power": {"available": True, "output": False, "secret": "ABC"},
               "bus": {"timeouts": 2, "credential": "ABC", "errorCount": 4}}
        motor = module.clean_motor(raw)
        self.assertEqual(motor["pan"]["reasonClass"], "timeout")
        self.assertEqual(motor["tilt"]["reasonClass"], "invalid-reply")
        self.assertFalse(motor["power"]["output"])
        self.assertEqual(motor["bus"], {"timeouts": 2, "errorCount": 4})
        self.assertNotIn("ABC", json.dumps(motor))

    def test_motor_numeric_gpio_power_values(self):
        off = module.clean_motor({"power": {"available": True, "output": 0}})
        on = module.clean_motor({"power": {"available": True, "output": 1}})
        unknown = module.clean_motor({"power": {"available": True, "output": 17}})
        self.assertIs(off["power"]["output"], False)
        self.assertIs(on["power"]["output"], True)
        self.assertIsNone(unknown["power"]["output"])

    def test_sample_stores_mode_0600_and_no_raw_private_data(self):
        reply = {"schema": 1, "heap": {"internalFree": 120000},
                 "chat": {"state": "waiting", "provider": "xiaozhi",
                          "detail": "SECRET"}, "photo": {}, "debug": {}}
        class FakeResponse:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size): return json.dumps(reply).encode()
        class FakeOpener:
            def open(self, req, timeout): return FakeResponse()
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "device.jsonl"
            with patch.object(module, "build_opener", return_value=FakeOpener()):
                ok, errors = module.sample("192.168.2.102", "TOKEN_PRIVATE",
                                           1, 0.5, output)
            self.assertEqual((ok, errors), (1, 0))
            self.assertEqual(os.stat(output).st_mode & 0o777, 0o600)
            saved = output.read_text()
            self.assertEqual(json.loads(saved)["data"]["heap"]["internalFree"], 120000)
            self.assertNotIn("SECRET", saved)
            self.assertNotIn("TOKEN_PRIVATE", saved)
            self.assertNotIn("192.168.2.102", saved)


if __name__ == "__main__":
    unittest.main()
