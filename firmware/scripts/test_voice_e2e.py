#!/usr/bin/env python3
"""Evidence gate unit tests; no microphone, network or CoreS3 needed."""
import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("voice_e2e", ROOT / "voice-e2e.py")
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class EvidenceGateTests(unittest.TestCase):
    def setUp(self):
        self.case = {"id": "photo", "required": ["asr", "photo"]}
        self.run = {"case": "photo", "capture_error": None}

    def test_no_evidence_is_never_pass(self):
        self.assertEqual(tool.verdict(self.case, self.run, {"checks": {}})[0], "UNVERIFIED")

    def test_one_check_is_not_enough(self):
        review = {"checks": {"asr": {"verified": True, "evidence": "UART event=22"}}}
        self.assertEqual(tool.verdict(self.case, self.run, review)[0], "UNVERIFIED")

    def test_explicit_false_fails(self):
        review = {"checks": {"asr": {"verified": False, "evidence": "ASR mismatch"}}}
        self.assertEqual(tool.verdict(self.case, self.run, review)[0], "FAIL")

    def test_capture_error_fails(self):
        self.run["capture_error"] = "recorder unavailable"
        self.assertEqual(tool.verdict(self.case, self.run, {"checks": {}})[0], "FAIL")

    def test_external_evidence_must_be_nonempty(self):
        review = {"checks": {
            "asr": {"verified": True, "evidence": " "},
            "photo": {"verified": True, "evidence": "new JPEG checked visually"},
        }}
        self.assertEqual(tool.verdict(self.case, self.run, review)[0], "UNVERIFIED")

    def test_explicit_external_evidence_allows_pass(self):
        review = {"checks": {
            "asr": {"verified": True, "evidence": "ASR text and ID matched"},
            "photo": {"verified": True, "evidence": "new JPEG checked against real subject"},
        }}
        self.assertEqual(tool.verdict(self.case, self.run, review)[0], "PASS")

    def test_command_expansion_is_argv_not_shell(self):
        argv = tool.command("python3 speak.py {text}", text="写真撮って; rm -rf /")
        self.assertEqual(argv, ["python3", "speak.py", "写真撮って; rm -rf /"])

    def test_cases_are_complete(self):
        cases = tool.load_cases(ROOT / "voice-e2e-cases.json")
        self.assertEqual(len(cases), 18)
        self.assertEqual(len({c["id"] for c in cases}), len(cases))


    def test_debug_summary_contains_only_counts_and_digests(self):
        source = b"[asr] final chars=10\n[boot-mode] restored conversation ON\n[volume] applied percent=20\n"
        result = tool.debug_markers(source)
        self.assertEqual(result["markers"]["asr_final"], 1)
        self.assertEqual(result["markers"]["boot_mode_restored"], 1)
        self.assertEqual(result["markers"]["mode_session_connected"], 0)
        self.assertEqual(result["markers"]["volume_applied"], 1)
        self.assertEqual(result["bytes"], len(source))
        self.assertEqual(len(result["sha256"]), 64)
        self.assertNotIn("chars=10", str(result))

    def test_only_new_device_log_bytes_are_summarized(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "usb-debug.log"
            target.write_bytes(b"[asr] final\n")
            offset = target.stat().st_size
            with target.open("ab") as handle:
                handle.write(b"[boot-mode] restored conversation ON\n")
            summary = tool.tail_device_log(target, offset)
            self.assertEqual(summary["markers"]["asr_final"], 0)
            self.assertEqual(summary["markers"]["boot_mode_restored"], 1)
            self.assertFalse(summary["truncated"])

    def test_missing_device_log_is_not_success(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = pathlib.Path(directory) / "missing.log"
            self.assertIn("error", tool.tail_device_log(missing, 0))

    def test_optional_stt_command_takes_wav_as_single_argv(self):
        wav = pathlib.Path("/tmp/pc test.wav")
        argv = tool.command("whisper-cli -m model.bin -f {wav}", wav=wav)
        self.assertEqual(argv[-1], str(wav))
        self.assertEqual(len(argv), 5)


if __name__ == "__main__":
    unittest.main()
