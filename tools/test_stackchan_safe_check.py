"""Offline safety tests. Run: python3 -m unittest discover -s tools -p 'test_stackchan_safe_check.py'"""

from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("stackchan-safe-check.py")


class SafeCheckTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "Stackchan_Projects"
        (self.root / "work").mkdir(parents=True)
        self.engine = self.base / "stackchan.sh"
        self.engine.write_text('#!/usr/bin/env bash\nprintf "%s\\n" "$*"\n')

    def repo(self, name, *, dirty=False, modules=True):
        repo = self.root / "work" / name
        (repo / "firmware").mkdir(parents=True)
        (repo / "firmware" / "package.json").write_text("{}\n")
        if modules:
            (repo / "firmware" / "node_modules").mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "add", "firmware/package.json"], check=True)
        subprocess.run([
            "git", "-C", str(repo), "-c", "user.name=Test", "-c", "user.email=test@example.com",
            "commit", "-qm", "fixture",
        ], check=True)
        if dirty:
            (repo / "firmware" / "package.json").write_text('{"changed":true}\n')
        return repo

    def run_check(self):
        return subprocess.run([
            sys.executable, str(SCRIPT), "--allow-other-host", "--projects", str(self.root),
            "--engine", str(self.engine),
        ], capture_output=True, text=True)

    def test_selects_clean_integration_and_passes_explicit_repo(self):
        repo = self.repo("stackchan-pr102-integration-clean")
        check = self.run_check()
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
        self.assertIn(f"--repo {repo} --log-root {self.root / 'runs'} --check", check.stdout)

    def test_dirty_main_checkout_does_not_block_clean_integration(self):
        main = self.root / "repository"
        main.mkdir()
        subprocess.run(["git", "init", "-q", str(main)], check=True)
        (main / "main.txt").write_text("before\n")
        subprocess.run(["git", "-C", str(main), "add", "main.txt"], check=True)
        subprocess.run([
            "git", "-C", str(main), "-c", "user.name=Test", "-c", "user.email=test@example.com",
            "commit", "-qm", "fixture",
        ], check=True)
        (main / "main.txt").write_text("modified and preserved\n")
        selected = self.repo("stackchan-pr102-integration-clean")
        check = self.run_check()
        self.assertEqual(check.returncode, 0)
        self.assertIn(str(selected), check.stdout)
        self.assertEqual((main / "main.txt").read_text(), "modified and preserved\n")

    def test_never_uses_dirty_integration(self):
        self.repo("stackchan-pr102-integration-dirty", dirty=True)
        check = self.run_check()
        self.assertEqual(check.returncode, 2)
        self.assertIn("REASON=none", check.stdout)

    def test_requires_installed_dependencies(self):
        self.repo("stackchan-pr102-integration-no-modules", modules=False)
        check = self.run_check()
        self.assertEqual(check.returncode, 2)

    def test_does_not_use_main_checkout(self):
        self.repo("other-worktree")
        check = self.run_check()
        self.assertEqual(check.returncode, 2)

    def test_propagates_engine_exit(self):
        self.repo("stackchan-pr102-integration-good")
        self.engine.write_text('#!/usr/bin/env bash\nexit 7\n')
        check = self.run_check()
        self.assertEqual(check.returncode, 7)
        self.assertIn("STEP=CHECK EXIT=7", check.stdout)

    def test_missing_engine_fails_closed(self):
        self.engine.unlink()
        check = self.run_check()
        self.assertEqual(check.returncode, 2)
        self.assertIn("STEP=ENGINE", check.stdout)


if __name__ == "__main__":
    unittest.main()
