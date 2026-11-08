#!/usr/bin/env python3
"""Durable, one-shot photo supervisor; no camera retry on reconnect."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import uuid

FW = Path(__file__).resolve().parents[1]


def identity(info):
    return dict(vid=info.vid, pid=info.pid, serial=info.serial_number,
                location=info.location, device=info.device)


def same_device(expected, candidate):
    if (expected['vid'], expected['pid']) != (candidate['vid'], candidate['pid']):
        return False
    if expected['serial']:
        return expected['serial'] == candidate['serial']
    return bool(expected['location'] and expected['location'] == candidate['location'])


def discover(port=None, expected=None):
    from serial.tools import list_ports
    devices = [identity(p) for p in list_ports.comports()]
    candidates = [p for p in devices if same_device(expected, p)] if expected else [
        p for p in devices if (p['vid'], p['pid']) == (0x303a, 0x1001)
        and (port is None or p['device'] == port)]
    if len(candidates) != 1 or not (candidates[0]['serial'] or candidates[0]['location']):
        raise RuntimeError('USB identity missing or ambiguous')
    return candidates[0]


def service_state(service):
    result = subprocess.run(['systemctl', '--user', 'show', service, '-p', 'ActiveState', '--value'],
                            capture_output=True, text=True, timeout=5, check=True)
    state = result.stdout.strip()
    if state not in ('active', 'inactive', 'failed'):
        raise RuntimeError('service state unavailable or transitioning')
    return state


def launch(args):
    # Create before discovery, service mutation, confirmation or SSH detachment.
    directory = FW / 'dist/camera-logs'
    directory.mkdir(parents=True, exist_ok=True)
    run = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex
    log = directory / (run + '.log')
    fd = os.open(log, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_APPEND, 0o600)
    print('LOG=' + str(log), flush=True)
    unit = 'stackchan-camera-' + run.lower()
    with os.fdopen(fd, 'w', buffering=1) as stream:
        def record(message):
            stream.write(message + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        record('START_UTC=' + datetime.datetime.now(datetime.timezone.utc).isoformat())
        sha = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=FW, capture_output=True,
                             text=True, check=True).stdout.strip()
        record('GIT_SHA=' + sha)
        dirty = subprocess.run(['git', 'diff', '--quiet', 'HEAD'], cwd=FW).returncode
        record('GIT_DIRTY=' + str(dirty != 0))
        binary = FW / 'dist/bin/esp32/m5stack_cores3/release/stack-chan-host/xs_esp32.bin'
        record('BUILD_SHA256=' + (hashlib.sha256(binary.read_bytes()).hexdigest() if binary.exists() else 'unavailable'))
        record('DEVICE_BUILD_ID=unavailable (host binary hash does not identify installed firmware)')
        try:
            device = discover(args.port)
            state = service_state(args.service)
            record('USB=' + json.dumps(device, sort_keys=True))
            record('SERVICE_INITIAL=' + state)
            if not args.approved_once:
                if input('写真を1回だけ撮影してSDへ保存しますか？ (yes/no): ') != 'yes':
                    record('CANCELLED'); return 1
            cmd = ['systemd-run', '--user', '--unit=' + unit, '--collect', '--wait',
                   '--property=Type=exec', '--property=RuntimeMaxSec=150',
                   '--property=TimeoutStopSec=10', '--property=UMask=0077',
                   '--property=StandardOutput=append:' + str(log),
                   '--property=StandardError=append:' + str(log)]
            # Executes on worker crash, SIGKILL, timeout and normal exit. Never
            # start a hub that was inactive before this diagnostic session.
            if state == 'active':
                cmd += ['--property=ExecStopPost=/usr/bin/systemctl --user start ' + args.service]
            cmd += [sys.executable, '-u', str(FW / 'scripts/stackchan-camera-probe.py'),
                    '--port', device['device'], '--managed-service', args.service,
                    '--config', str(getattr(args, 'config', FW / 'host/app/manifest_archive_private.json')),
                    '--initial-service', state, '--expected-device', json.dumps(device, separators=(',', ':'))]
            if args.allow_ai_on:
                cmd.append('--allow-ai-on')
            record('UNIT=' + unit)
            print('診断ユニット: ' + unit + '\nSSH切断後もログを保持します。', flush=True)
            subprocess.run(cmd, check=True, timeout=170, stdout=stream, stderr=stream)
            return 0
        except (KeyboardInterrupt, subprocess.TimeoutExpired) as error:
            # Stop only our own unit; ExecStopPost handles original hub state.
            subprocess.run(['systemctl', '--user', 'stop', unit], timeout=15, check=False)
            record('INTERRUPTED=' + type(error).__name__)
            print(log.read_text()[-2500:], file=sys.stderr)
            return 130
        except Exception as error:
            record('FAILED=' + type(error).__name__)
            print(log.read_text()[-2500:], file=sys.stderr)
            return 1


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--port')
    p.add_argument('--config', type=Path, default=FW / 'host/app/manifest_archive_private.json')
    p.add_argument('--service', default='stackchan-hub.service', choices=['stackchan-hub.service'])
    p.add_argument('--approved-once', action='store_true')
    p.add_argument('--allow-ai-on', action='store_true')
    raise SystemExit(launch(p.parse_args()))
