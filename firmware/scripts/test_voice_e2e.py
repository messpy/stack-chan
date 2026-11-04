#!/usr/bin/env python3
"""Evidence gate unit tests; no microphone, network or CoreS3 needed."""
import importlib.util
import pathlib
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
        self.assertEqual(len(cases), 11)
        self.assertEqual(len({c["id"] for c in cases}), len(cases))


if __name__ == "__main__":
    unittest.main()
