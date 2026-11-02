import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class UpdateStatusTests(unittest.TestCase):
    def test_success_failure_and_setup_error_are_durable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'host/app').mkdir(parents=True)
            (root / 'host/app/manifest_archive_private.json').write_text('{}')
            for name in ('update-archive.sh', 'update-status.py'):
                shutil.copyfile(Path(__file__).with_name(name), root / 'scripts' / name)
            (root / 'scripts/patch-promise-checkpoint.py').write_text('print("SDK patch fixture")\n')
            (root / 'scripts/patch-self-message-queue.py').write_text('print("SDK self queue fixture")\n')
            (root / 'scripts/patch-audio-input-ring.py').write_text('print("SDK audio ring fixture")\n')
            (root / 'scripts/patch-worker-task-start.py').write_text('print("SDK worker allocation fixture")\n')
            (root / 'scripts/patch-audioout-callback-lifetime.py').write_text('print("SDK audio callback fixture")\n')
            binary = root / 'bin'
            binary.mkdir()
            npm = binary / 'npm'
            npm.write_text('#!/bin/sh\necho fake-compiler-output\nexit "${FAKE_RESULT:-0}"\n')
            npm.chmod(0o755)
            env_script = root / 'environment.sh'
            env_script.write_text(':\n')
            env = {**os.environ, 'STACKCHAN_NODE_BIN': str(binary),
                   'STACKCHAN_XS_ENV': str(env_script), 'STACKCHAN_IDF_ENV': str(env_script)}
            command = ['bash', str(root / 'scripts/update-archive.sh'), '--build-only']
            for expected in (0, 7):
                result = subprocess.run(command, env={**env, 'FAKE_RESULT': str(expected)}, capture_output=True, text=True)
                self.assertEqual(result.returncode, expected)
                status = json.loads((root / 'dist/update-logs/latest.json').read_text())
                self.assertEqual(status['state'], 'built' if expected == 0 else 'failed')
                self.assertEqual(status['exit_code'], expected)
                self.assertTrue(status['needs_review'])
                self.assertIn('fake-compiler-output', Path(status['log']).read_text())
                if expected == 0:
                    self.assertNotIn('fake-compiler-output', result.stdout)
            result = subprocess.run(command, env={**env, 'STACKCHAN_XS_ENV': str(root / 'missing')}, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            status = json.loads((root / 'dist/update-logs/latest.json').read_text())
            self.assertEqual(status['state'], 'failed')
            self.assertIsNotNone(status['exit_code'])


if __name__ == '__main__':
    unittest.main()
