"""Offline tests for the one-time local stackchan.sh root migration."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import importlib.util

SCRIPT = Path(__file__).with_name('migrate-stackchan-root.py')
spec = importlib.util.spec_from_file_location('migrate_root', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MigrationTests(unittest.TestCase):
    def test_rewrite_once(self):
        before = 'HOME = pathlib.Path.home()\n' + module.OLD + '\nDEFAULT_REPO = PROJECT / "work"\n'
        after, changed = module.rewrite(before)
        self.assertTrue(changed)
        self.assertEqual(after.count(module.NEW), 1)
        self.assertIn('DEFAULT_REPO = PROJECT', after)

    def test_idempotent(self):
        after, changed = module.rewrite(module.NEW)
        self.assertFalse(changed)
        self.assertEqual(after, module.NEW)

    def test_reject_unknown_version(self):
        with self.assertRaises(ValueError):
            module.rewrite('PROJECT = /unexpected')

    def test_reject_duplicate(self):
        with self.assertRaises(ValueError):
            module.rewrite(module.OLD + '\n' + module.OLD)

    def test_real_script_backup_and_syntax(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for d in ('repository', 'runs'):
                (root / d).mkdir()
            script = root / 'stackchan.sh'
            original = '#!/usr/bin/env bash\npython3 - <<\'PY\'\nimport os, pathlib\nHOME = pathlib.Path.home()\n' + module.OLD + '\nPY\n'
            script.write_text(original)
            result = subprocess.run([sys.executable, str(SCRIPT), '--script', str(script), '--projects', str(root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn(module.NEW, script.read_text())
            backups = list((root / 'runs').glob('stackchan.sh.before-root-fix-*.bak'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), original)
            repeat = subprocess.run([sys.executable, str(SCRIPT), '--script', str(script), '--projects', str(root)], capture_output=True, text=True)
            self.assertEqual(repeat.returncode, 0)
            self.assertIn('ALREADY_APPLIED', repeat.stdout)
            self.assertEqual(len(list((root / 'runs').glob('*.bak'))), 1)


if __name__ == '__main__':
    unittest.main()
