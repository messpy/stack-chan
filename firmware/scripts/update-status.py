#!/usr/bin/env python3
"""Persist machine-readable update state without copying build output/secrets."""
import datetime
import json
import os
from pathlib import Path
import sys


def write_status(directory, state, run_id, log, result=None):
    folder = Path(directory)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / 'latest.json'
    previous = {}
    try:
        previous = json.loads(target.read_text())
    except (OSError, ValueError):
        pass
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    data = {'version': 1, 'run_id': run_id, 'state': state, 'log': log,
            'started_at': previous.get('started_at', now) if previous.get('run_id') == run_id else now,
            'updated_at': now, 'pid': os.getppid(), 'exit_code': result,
            'needs_review': state in ('succeeded', 'built', 'failed')}
    temporary = folder / f'.latest-{os.getpid()}.tmp'
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    os.chmod(temporary, 0o600)
    temporary.replace(target)


if __name__ == '__main__':
    write_status(*sys.argv[1:5], int(sys.argv[5]) if len(sys.argv) > 5 else None)
