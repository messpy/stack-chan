#!/usr/bin/env python3
"""One-time local migration for kmac's legacy ~/stackchan.sh PROJECT path.

This tool never executes build/flash or changes Git checkouts.
"""
import argparse
from datetime import datetime
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys

OLD = "PROJECT = pathlib.Path(os.environ.pop('STACKCHAN_SCRIPT_DIR')).parent"
NEW = "PROJECT = HOME / 'Stackchan_Projects'\nos.environ.pop('STACKCHAN_SCRIPT_DIR', None)"


def rewrite(source: str) -> tuple[str, bool]:
    if NEW in source:
        return source, False
    if source.count(OLD) != 1:
        raise ValueError("unexpected project-root declaration")
    return source.replace(OLD, NEW, 1), True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--script', type=Path, default=Path.home() / 'stackchan.sh')
    ap.add_argument('--projects', type=Path, default=Path.home() / 'Stackchan_Projects')
    args = ap.parse_args(argv)
    root = args.projects
    if not (root / 'repository').is_dir() or not (root / 'runs').is_dir():
        print('[FATAL] STEP=PREFLIGHT REASON=project-layout-invalid')
        return 2
    target = args.script
    if not target.is_file() or target.is_symlink():
        print('[FATAL] STEP=PREFLIGHT REASON=script-missing-or-symlink')
        return 2
    old_content = target.read_text()
    try:
        new_content, changed = rewrite(old_content)
    except ValueError:
        print('[FATAL] STEP=PREFLIGHT REASON=unexpected-script-version')
        return 2
    if not changed:
        print('[INFO] STEP=MIGRATE RESULT=ALREADY_APPLIED')
        return 0
    timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    backup = root / 'runs' / f'stackchan.sh.before-root-fix-{timestamp}.bak'
    shutil.copy2(target, backup)
    backup.chmod(0o600)
    if hashlib.sha256(backup.read_bytes()).digest() != hashlib.sha256(old_content.encode()).digest():
        print('[FATAL] STEP=BACKUP REASON=sha256-mismatch')
        return 1
    tmp = target.with_name(f'.{target.name}.root-fix-{os.getpid()}')
    try:
        tmp.write_text(new_content)
        tmp.chmod(target.stat().st_mode & 0o777)
        if subprocess.run(['bash', '-n', str(tmp)], capture_output=True).returncode:
            raise RuntimeError('syntax-invalid')
        os.replace(tmp, target)
    except (OSError, RuntimeError):
        tmp.unlink(missing_ok=True)
        shutil.copy2(backup, target)
        print('[FATAL] STEP=MIGRATE REASON=verification-failed ROLLBACK=SUCCESS')
        return 1
    print('[INFO] STEP=MIGRATE RESULT=SUCCESS')
    print(f'[INFO] STEP=BACKUP FILE={backup.name}')
    print('[INFO] STEP=SAFETY NO_BUILD_NO_FLASH_NO_GIT_WRITE')
    return 0


if __name__ == '__main__':
    sys.exit(main())
