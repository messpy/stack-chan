#!/usr/bin/env bash
# Single entry point; Python is part of the existing kmac environment.
exec python3 - "$@" <<'PY'
import argparse, contextlib, datetime, fcntl, hashlib, json, os, pathlib, re, shlex
import signal, subprocess, sys, tempfile, time, shutil

HOME = pathlib.Path('/home/kmac')
DEFAULT_REPO = HOME / 'work/stackchan-wifi-offline-review'
SDK_ENV = HOME / 'work/stackchan-pr87-pr89-evidence/sdk-env.sh'
IDF_ENV = HOME / '.local/share/esp32/esp-idf/export.sh'
DEVICE_PYTHON = HOME / '.espressif/python_env/idf6.1_py3.12_env/bin/python'
PRIVATE = pathlib.Path('/mnt/data/Development/stackchan/stack-chan/firmware/host/app/manifest_archive_private.json')
NODE = HOME / '.nvm/versions/node/v22.23.4/bin'
SERVICE = 'stackchan-hub.service'
SERIAL = '44:1B:F6:DF:5A:D0'
FILES = {'0x0': 'bootloader.bin', '0x8000': 'partition-table.bin', '0x10000': 'xs_esp32.bin'}

# No arbitrary trace lines: settings, tokens and conversation text must not leak.
SAFE_SOURCE = "def safe_line(line):\n    s = line.strip()\n    patterns = (\n        r'\\[main\\] (?:start|loading app behaviors|app context created|app behaviors ready)',\n        r'\\[main\\] onLaunch shouldCreateContext=(?:true|false)',\n        r'\\[main\\] network ready: (?:connected|skipped|failed)',\n        r'\\[main\\] startup failed phase=[a-z-]+ error=[A-Za-z]+',\n        r'\\[network\\] offline boot selected; saved credentials preserved',\n        r'\\[settings\\] (?:Wi-Fi connected|Wi-Fi connection failed|SD configuration unavailable|initialization failed; USB remains available)',\n        r'rst:0x[0-9a-f]+ \\([A-Z0-9_]+\\),boot:0x[0-9a-f]+ \\([A-Z0-9_]+\\)',\n        r'ESP-ROM:[a-zA-Z0-9-]+',\n    )\n    if any(re.fullmatch(p, s) for p in patterns): return s\n    if s.startswith('[main] startup detail:'): return '[main] startup detail: [omitted; may contain private values]'\n    return None"
exec(SAFE_SOURCE)

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()

class Runner:
    def __init__(self, args):
        self.a = args
        self.repo = pathlib.Path(args.repo).resolve()
        self.fw = self.repo / 'firmware'
        base = pathlib.Path(args.log_root).expanduser()
        base.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.run = pathlib.Path(tempfile.mkdtemp(prefix=datetime.datetime.now().strftime('run-%Y%m%d-%H%M%S-'), dir=base))
        self.console = (self.run / 'console.log').open('a', buffering=1)
        self.step = 'preflight'
        self.child = None
        self.lock = None
        self.restored = False
        self.restore_service = False
        self.manifest_before = None
        self.manifest_changed = False
        self.env = dict(os.environ, PATH=str(NODE) + ':' + os.environ.get('PATH', ''))
        self.log('INFO', 'START=' + datetime.datetime.now().astimezone().isoformat() + ' LOG=' + str(self.run / 'console.log'))

    def log(self, level, message):
        line = '[' + level + '] ' + message
        print(line, flush=True)
        self.console.write(line + '\n')

    def cmd(self, name, argv, cwd=None, timeout=None, env=None):
        self.step = name
        command = shlex.join(map(str, argv))
        (self.run / (name + '.command.txt')).write_text(command + '\n')
        shown = shlex.join(list(map(str, argv[:2]))) + ' <embedded helper; see command log>' if '-c' in list(map(str, argv)) else command
        self.log('ACTION', 'STEP=' + name + ' CMD=' + shown)
        path = self.run / (name + '.log')
        with path.open('w') as out:
            self.child = subprocess.Popen(list(map(str, argv)), cwd=cwd, stdout=out, stderr=subprocess.STDOUT,
                                          env=env or self.env, start_new_session=True)
            try:
                rc = self.child.wait(timeout=timeout)
            except BaseException:
                self.stop_child()
                raise
            finally:
                self.child = None
        if rc:
            self.log('ERROR', 'STEP=' + name + ' EXIT=' + str(rc) + ' CMD=' + shown + ' LOG=' + str(path))
            for line in path.read_text(errors='replace').splitlines()[-40:]:
                # Full tool output is private on disk; sanitize terminal error snippets.
                self.log('ERROR', self.redact(line)[:600])
            raise RuntimeError('command failed: ' + name)
        self.log('INFO', 'PASS STEP=' + name + ' LOG=' + str(path))
        return path

    def redact(self, line):
        # Tool failure logs stay private; also remove configured secrets from terminal tails.
        try:
            def visit(value, secret=False):
                if isinstance(value, dict):
                    for k, v in value.items(): yield from visit(v, secret or bool(re.search(r'(?i)ssid|password|token|key|secret|authorization', k)))
                elif isinstance(value, list):
                    for v in value: yield from visit(v, secret)
                elif secret and isinstance(value, str) and value: yield value
            for value in sorted(set(visit(json.loads(PRIVATE.read_text()))), key=len, reverse=True): line=line.replace(value, '[redacted]')
        except Exception:
            return '[tool output withheld; private configuration unavailable for redaction]'
        return re.sub(r'(?i)(password|token|api[_-]?key|ssid)\s*[:=].*', r'\1=[redacted]', line)

    def stop_child(self):
        if self.child and self.child.poll() is None:
            os.killpg(self.child.pid, signal.SIGTERM)
            try: self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.child.pid, signal.SIGKILL)
                self.child.wait()

    def query(self, argv):
        return subprocess.check_output(list(map(str, argv)), cwd=self.repo, env=self.env, text=True, stderr=subprocess.DEVNULL).strip()

    def confirm(self, message):
        # stdin is the embedded Python program; use the controlling terminal for consent.
        self.step = 'approval'
        if getattr(self.a, 'yes', False):
            self.log('ACTION', 'Approved by explicit --yes: ' + message)
            return
        # Text r+ creates a BufferedRandom stream, which requires seek() and fails on a TTY.
        # Independent read/write handles work on non-seekable terminals.
        with open('/dev/tty', 'r') as reader, open('/dev/tty', 'w') as writer:
            writer.write('[CHECK] ' + message + ' [yes/no] '); writer.flush()
            if reader.readline().strip() != 'yes': raise RuntimeError('cancelled; no further device operation')

    def pr_metadata(self):
        path = self.cmd('pr-metadata', ['gh', 'api', 'repos/messpy/stack-chan/pulls/' + str(self.a.pr),
            '--jq', '{number:.number,state:.state,baseRef:.base.ref,baseSHA:.base.sha,headSHA:.head.sha,headRepo:.head.repo.full_name}'])
        return json.loads(path.read_text())

    def prepare_pr(self):
        info = self.pr_metadata()
        if info['number'] != self.a.pr or info['state'] != 'open' or info['baseRef'] != 'stackchan-super' or info['headRepo'] != 'messpy/stack-chan':
            raise RuntimeError('PR is not an open same-repository PR targeting stackchan-super')
        for key in ('baseSHA', 'headSHA'):
            if not re.fullmatch('[0-9a-f]{40}', info[key]): raise RuntimeError('invalid PR commit SHA')
        if self.a.sha and self.a.sha != info['headSHA']: raise RuntimeError('PR HEAD differs from --sha')
        (self.run / 'pr-selection.json').write_text(json.dumps(info, indent=2) + '\n')
        self.pr_info = info
        source = self.repo
        # Fetch objects only. Never checkout/reset/merge the user's source worktree.
        self.cmd('pr-fetch', ['git', 'fetch', '--no-tags', 'https://github.com/messpy/stack-chan.git', info['baseSHA'], info['headSHA']], source)
        tree_log = self.cmd('pr-merge-tree', ['git', 'merge-tree', '--write-tree', info['baseSHA'], info['headSHA']], source)
        tree = tree_log.read_text().splitlines()[0]
        if not re.fullmatch('[0-9a-f]{40}', tree): raise RuntimeError('unexpected merge-tree result')
        target = HOME / 'work' / ('stackchan-pr' + str(self.a.pr) + '-integration-' + info['baseSHA'][:12] + '-' + info['headSHA'][:12])
        if target.exists():
            # Never repair/reset an existing worktree automatically.
            current = subprocess.check_output(['git','-C',str(target),'rev-parse','HEAD^{tree}'],text=True).strip()
            dirty = subprocess.check_output(['git','-C',str(target),'status','--porcelain','--untracked-files=no'],text=True).strip()
            if current != tree or dirty: raise RuntimeError('existing integration worktree differs or has conflicts; preserve it and inspect manually: ' + str(target))
        else:
            self.cmd('pr-worktree', ['git', 'worktree', 'add', '--detach', target, info['baseSHA']], source)
            self.cmd('pr-local-merge', ['git', '-c', 'user.name=messpy', '-c', 'user.email=110882522+messpy@users.noreply.github.com',
                'merge', '--no-ff', '--no-edit', info['headSHA']], target)
        self.repo = target
        self.fw = target / 'firmware'
        modules = self.fw / 'node_modules'
        existing = source / 'firmware/node_modules'
        if not modules.exists() and not modules.is_symlink() and existing.is_dir(): modules.symlink_to(existing.resolve(), target_is_directory=True)
        self.log('CHECK', 'PR=' + str(self.a.pr) + ' BASE=' + info['baseSHA'] + ' PR_HEAD=' + info['headSHA'] + ' WORKTREE=' + str(target))
        self.log('INFO', 'Local integration only. GitHub PR merge/push is never performed.')

    def check(self):
        if not (self.repo / 'AGENTS.md').is_file() or not self.fw.is_dir(): raise RuntimeError('repository missing: ' + str(self.repo))
        self.head = self.query(['git', 'rev-parse', 'HEAD'])
        if self.a.sha and not getattr(self, 'pr_info', None) and self.a.sha != self.head: raise RuntimeError('HEAD differs from --sha')
        if self.query(['git', 'status', '--porcelain', '--untracked-files=no']): raise RuntimeError('tracked changes exist; preserve them and use a clean worktree')
        self.cmd('diff-check', ['git', 'diff', '--check'], self.repo)
        for path in [SDK_ENV, IDF_ENV, DEVICE_PYTHON, NODE / 'node', PRIVATE]:
            if not path.is_file(): raise RuntimeError('missing: ' + str(path))
        self.log('CHECK', 'HOST=' + os.uname().nodename + ' SHA=' + self.head + ' REPO=' + str(self.repo))
        self.log('CHECK', 'DISK_FREE_GiB=' + str(round(shutil.disk_usage(self.repo).free / 2**30, 1)))
        self.cmd('host-uptime', ['uptime'])
        if not any((self.a.test, self.a.build, self.a.write, self.a.logs)):
            try: self.log('CHECK', 'USB=' + self.identity()['port'])
            except RuntimeError: self.log('WARN', 'USB not visible/ambiguous; --check did not open or reset a device')
            state = subprocess.run(['systemctl','--user','show',SERVICE,'-p','ActiveState','-p','Result','-p','ExecMainStatus'], capture_output=True, text=True)
            if state.returncode: self.log('WARN', 'user systemd bus unavailable; service state unknown')
            else:
                for line in state.stdout.splitlines(): self.log('CHECK', line)
        self.log('INFO', 'No GitHub merge/push, SD backup, settings erase or photo request. Flash backup retained.')

    def setup_env(self):
        # Only source the known SDK exports; never evaluate user input as shell code.
        source = 'set -e; source "$1" >&2; source "$2" >&2; env -0'
        p = subprocess.run(['bash', '-c', source, 'stackchan-env', str(SDK_ENV), str(IDF_ENV)], env=self.env,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        (self.run / 'environment.log').write_bytes(p.stderr)
        if p.returncode: raise RuntimeError('SDK/IDF export failed; see environment.log')
        self.env = dict(item.decode().split('=', 1) for item in p.stdout.split(b'\0') if b'=' in item)
        self.env['PATH'] = str(NODE) + ':' + self.env['PATH']

    def fingerprint(self):
        sdk = pathlib.Path(self.env['MODDABLE'])
        # Include locally patched SDK files, not only its Git HEAD.
        tracked = subprocess.check_output(['git', '-C', str(sdk), 'ls-files', '-z']).split(b'\0')
        h = hashlib.sha256()
        for name in tracked:
            if not name: continue
            p = sdk / os.fsdecode(name)
            h.update(name)
            h.update((sha(p) if p.is_file() else 'missing').encode())
        return {'sha': self.head, 'sdk': h.hexdigest(), 'idf': self.query(['git', '-C', str(IDF_ENV.parent), 'rev-parse', 'HEAD']),
                'private': sha(PRIVATE)}

    def test(self):
        self.cmd('cli', ['python3', DEFAULT_REPO / 'firmware/scripts/lib/stackchan-cli.test.py'], self.fw)
        self.cmd('unit', ['npm', 'run', 'test:unit'], self.fw)
        self.cmd('archive', ['bash', '-c', 'node --experimental-vm-modules --test --test-concurrency=1 scripts/lib/archive-*.test.mjs'], self.fw)

    def build(self):
        dst = self.fw / 'host/app/manifest_archive_private.json'
        data = json.loads(PRIVATE.read_text())
        example = json.loads((self.fw / 'host/app/manifest_archive.example.json').read_text())
        for name in ['archive-camera-handoff', 'archive-camera-release', 'archive-chat-pause-gate']:
            data.setdefault('modules', {})[name] = example['modules'][name]
        data.setdefault('platforms', {})['esp32/m5stackchan_cores3'] = example['platforms']['esp32/m5stackchan_cores3']
        self.manifest_before = dst.read_bytes() if dst.exists() else None
        if self.manifest_before is not None: (self.run / 'private-manifest.before.json').write_bytes(self.manifest_before)
        self.manifest_changed = True
        dst.write_text(json.dumps(data, indent=2) + '\n'); dst.chmod(0o600)
        self.cmd('build', ['npm', 'run', 'build:archive:m5stackchan_cores3'], self.fw)
        self.validate_layout()
        receipt = dict(self.fingerprint(), artifacts={v: sha(self.bin / v) for v in FILES.values()})
        self.receipt.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.receipt.with_suffix('.tmp')
        tmp.write_text(json.dumps(receipt, indent=2) + '\n'); tmp.replace(self.receipt)
        self.log('INFO', 'BUILD RECEIPT=' + str(self.receipt))

    @property
    def bin(self): return self.fw / 'dist/bin/esp32/m5stackchan_cores3/release/stack-chan-host'
    @property
    def receipt(self): return self.fw / 'dist/stackchan-build-receipt.json'

    def validate_layout(self):
        p = self.fw / 'dist/tmp/esp32/m5stackchan_cores3/release/stack-chan-host/xsProj-esp32s3/build/flasher_args.json'
        d = json.loads(p.read_text())
        if d['extra_esptool_args']['chip'] != 'esp32s3' or d['flash_settings'] != dict(flash_mode='dio', flash_size='16MB', flash_freq='80m'):
            raise RuntimeError('unexpected CoreS3 flash settings')
        if {int(k, 0): pathlib.Path(v).name for k, v in d['flash_files'].items()} != {int(k, 0): v for k, v in FILES.items()}:
            raise RuntimeError('unexpected flash image addresses')
        # Protect NVS even if a future partition layout changes.
        table = (self.bin / 'partition-table.bin').read_bytes()
        import struct
        entries = [struct.unpack('<HBBII16sI', table[i:i+32]) for i in range(0, len(table)-31, 32) if table[i:i+2] == b'\xaaP']
        nvs = [e for e in entries if e[5].rstrip(b'\0') == b'nvs']
        if len(nvs) != 1 or (nvs[0][3], nvs[0][4]) != (0x9000, 0x6000): raise RuntimeError('unexpected NVS layout')
        for offset, name in FILES.items():
            start = int(offset, 0); end = (start + (self.bin / name).stat().st_size + 4095) & ~4095
            if start < 0xf000 and end > 0x9000: raise RuntimeError('image would overlap NVS')

    def verify_receipt(self):
        if self.query(['git', 'rev-parse', 'HEAD']) != self.head or self.query(['git', 'status', '--porcelain', '--untracked-files=no']):
            raise RuntimeError('source changed during operation; refusing write')
        if not self.receipt.exists(): raise RuntimeError('build receipt missing; run --build first (existing old binaries are not silently reused)')
        r = json.loads(self.receipt.read_text())
        if any(r.get(k) != v for k, v in self.fingerprint().items()): raise RuntimeError('source/SDK/private configuration changed; run --build')
        self.validate_layout()
        if r['artifacts'] != {v: sha(self.bin / v) for v in FILES.values()}: raise RuntimeError('artifact hash mismatch; run --build')

    def identity(self):
        p = self.cmd('usb-identity', [DEVICE_PYTHON, '-c', '''import json,sys,os
from serial.tools import list_ports
ps=[p for p in list_ports.comports() if (p.vid,p.pid,p.serial_number)==(0x303a,0x1001,sys.argv[1]) and p.location and (not sys.argv[2] or os.path.realpath(p.device)==os.path.realpath(sys.argv[2]))]
if len(ps)!=1: raise SystemExit('Known USB device missing or ambiguous; no port opened')
p=ps[0];print(json.dumps(dict(port=p.device,vid=p.vid,pid=p.pid,serial=p.serial_number,location=p.location)))''', SERIAL, self.a.port or ''])
        return json.loads(p.read_text())

    def same_device(self, expected):
        now = self.identity()
        if any(now[k] != expected[k] for k in ('vid', 'pid', 'serial', 'location')): raise RuntimeError('USB device identity changed')
        return now

    @contextlib.contextmanager
    def own_usb(self):
        state = self.cmd('hub-state', ['systemctl', '--user', 'show', SERVICE, '-p', 'ActiveState', '--value']).read_text().strip()
        if state not in ('active', 'inactive', 'failed'): raise RuntimeError('hub service state is not stable')
        if state == 'active':
            self.confirm('USBログ/書き込みの間、起動中のhubを停止し、終了時に戻しますか？')
            self.restore_service = True
            self.cmd('hub-stop', ['systemctl', '--user', 'stop', SERVICE])
        try:
            yield
        finally:
            self.restore_hub()

    def restore_hub(self):
        if self.restore_service:
            previous_step = self.step
            try:
                self.cmd('hub-restore', ['systemctl', '--user', 'start', SERVICE])
                self.restore_service = False
            finally:
                self.step = previous_step

    def unoccupied(self, port):
        p = subprocess.run(['fuser', port], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if p.returncode != 1: raise RuntimeError('USB port occupied or occupancy check failed')

    def capture(self, expected):
        self.log('INFO', '起動phase/reset reasonのみ保存。必要ならログ取得中に本体を操作してください。自動RSTはしません。')
        self.cmd('boot-stages', [DEVICE_PYTHON, '-c', '''import json,time,sys
from serial import Serial,SerialException
from serial.tools import list_ports
expected=json.loads(sys.argv[1]);end=time.monotonic()+int(sys.argv[2]);seen=False
# Whitelist is supplied as code from this same reviewed script, never from the device.
ns={};exec(sys.argv[3],ns);safe=ns['safe_line']
while time.monotonic()<end:
 ps=[p for p in list_ports.comports() if (p.vid,p.pid,p.serial_number,p.location)==(expected['vid'],expected['pid'],expected['serial'],expected['location'])]
 if len(ps)!=1: time.sleep(.5);continue
 try:
  s=Serial(port=None,baudrate=115200,timeout=.5,exclusive=True);s.dtr=False;s.rts=False;s.port=ps[0].device
  with s:
   seen=True
   while time.monotonic()<end:
    line=safe(s.readline(2048).decode('utf8','replace'))
    if line: print(time.strftime('%Y-%m-%dT%H:%M:%S%z')+' '+line,flush=True)
 except (SerialException,OSError): print('[WARN] USB disconnected; no request retransmitted',flush=True);time.sleep(.5)
if not seen: raise SystemExit('USB never became available during bounded log capture')
''', json.dumps(expected), str(self.a.seconds), 'import re\n' + SAFE_SOURCE], timeout=self.a.seconds + 10)
        self.log('WARN', 'ログ収集の終了は正常起動・撮影成功の判定ではありません。')

    def logs(self):
        self.cmd('kernel-usb', ['bash', '-c', "journalctl -k --since '-30 min' --no-pager -o short-iso | rg -i 'usb|ttyACM|cdc_acm|oom|out of memory' || test ${PIPESTATUS[0]} -eq 0"])
        # Do not dump raw hub logs or general journal entries containing private values.
        source = pathlib.Path('/mnt/data/Development/stackchan/hub/logs/diagnostic.log')
        if source.exists():
            self.log('CHECK', 'Hub log modified=' + datetime.datetime.fromtimestamp(source.stat().st_mtime).astimezone().isoformat())
            with (self.run / 'hub-stages.log').open('w') as out:
                for line in source.read_text(errors='replace').splitlines():
                    marker = line.find('[main]')
                    safe = safe_line(line[marker:]) if marker >= 0 else None
                    if safe: out.write(safe + '\n')
        self.confirm('本体へ要求を送らず、USB起動ログを' + str(self.a.seconds) + '秒取得しますか？')
        expected = self.identity()
        with self.own_usb():
            self.unoccupied(expected['port'])
            self.capture(expected)

    def check_pr_freshness(self):
        if getattr(self, 'pr_info', None) and self.pr_metadata() != self.pr_info:
            raise RuntimeError('PR/base changed during validation; stop and rerun against the new snapshot')

    def write(self):
        if not os.environ.get('TMUX'): raise RuntimeError('--write/--all must run inside tmux to survive SSH disconnect')
        self.check_pr_freshness()
        self.verify_receipt()
        expected = self.identity()
        self.log('CHECK', 'TARGET=m5stackchan_cores3 SHA=' + self.head + ' PORT=' + expected['port'])
        self.confirm('手動ダウンロードモードの本体から16MiBバックアップを読み取りますか？ 自動RSTなし')
        with self.own_usb():
            expected = self.same_device(expected)
            self.unoccupied(expected['port'])
            base = [DEVICE_PYTHON, '-m', 'esptool', '--chip', 'esp32s3', '--port', expected['port'], '--before', 'no-reset', '--after', 'no-reset']
            info = self.cmd('flash-id', base + ['--no-stub', 'flash-id'], timeout=30)
            if not re.search(r'Detected flash size: 16(?:MB| MiB)', info.read_text()): raise RuntimeError('16MiB flash not verified')
            backup = self.run / 'flash-16MiB.bin'
            self.cmd('backup', base + ['read-flash', '0', '0x1000000', backup], timeout=600)
            if backup.stat().st_size != 16777216: raise RuntimeError('backup length mismatch')
            digest = sha(backup)
            (self.run / 'flash-16MiB.sha256').write_text(digest + '  flash-16MiB.bin\n')
            if sha(backup) != digest: raise RuntimeError('backup checksum mismatch')
            self.log('INFO', '16MiBバックアップ検証済み。SDバックアップはユーザー指定で省略。')
            self.confirm('SHA=' + self.head + ' の成果物を本体へ書き込みますか？')
            now = self.same_device(expected)
            self.unoccupied(now['port'])
            self.check_pr_freshness()
            self.verify_receipt()
            base[base.index('--port')+1] = now['port']
            argv = base + ['write-flash', '--flash-mode', 'dio', '--flash-size', '16MB', '--flash-freq', '80m']
            for offset, name in FILES.items(): argv += [offset, self.bin / name]
            self.cmd('flash', argv, timeout=300)
            self.log('INFO', '書き込み検証完了。通常起動ログを取得します。本体RSTを短く1回押してください。')
            self.capture(expected)
            self.validate_boot()
        self.log('INFO', 'Rollback backup=' + str(backup) + '; restore requires separate approval. Hardware acceptance remains unverified.')

    def validate_boot(self):
        self.step = 'boot-check'
        stages = (self.run / 'boot-stages.log').read_text()
        if 'startup failed phase=' in stages or '[main] app behaviors ready' not in stages:
            raise RuntimeError('normal startup not verified; inspect boot-stages.log. No photo requests were sent')
        self.log('INFO', 'PASS boot-check: app behaviors ready observed. Face/camera/audio acceptance remains manual.')

    def execute(self):
        if self.a.write and not os.environ.get('TMUX'): raise RuntimeError('--write/--all must run inside tmux; stopped before tests/build')
        lock_root = HOME / 'work/stackchan-tools/locks'
        lock_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = (lock_root / (hashlib.sha256(('PR:' + str(self.a.pr) if getattr(self.a, 'pr', None) else str(self.repo)).encode()).hexdigest() + '.lock')).open('a')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if getattr(self.a, 'pr', None): self.prepare_pr()
        self.check()
        if self.a.test or self.a.build or self.a.write:
            self.setup_env()
        if self.a.test: self.test()
        if self.a.build: self.build()
        if self.a.write: self.write()
        if self.a.logs and not self.a.write: self.logs()

    def cleanup(self):
        self.stop_child()
        dst = self.fw / 'host/app/manifest_archive_private.json'
        if self.manifest_changed:
            if self.manifest_before is None: dst.unlink(missing_ok=True)
            else: dst.write_bytes(self.manifest_before); dst.chmod(0o600)
        self.restore_hub()

def main(argv=None):
    p = argparse.ArgumentParser(prog='stackchan.sh', description='StackChan統一操作。指定した処理だけ実行。無指定は--check。書き込みはyes/no確認。')
    for mode in ('check', 'test', 'build', 'write', 'logs', 'all'): p.add_argument('--'+mode, action='store_true')
    p.add_argument('--yes', action='store_true', help='この実行のバックアップ・書き込み・hub一時停止・ログ取得を事前承認。確認入力を省略')
    p.add_argument('--PR', '--pr', dest='pr', type=int, help='PR番号。最新baseとHEADを専用worktreeでローカル統合。GitHubマージはしない')
    p.add_argument('--repo', default=str(DEFAULT_REPO), help='対象worktree（既定はWi-Fi修正を含むPR90）')
    p.add_argument('--sha', help='要求する40桁HEAD。--PR指定時はPRのHEADを照合')
    p.add_argument('--port', help='任意のUSBパス。指定時も本体シリアルと物理ポートを照合')
    p.add_argument('--seconds', type=int, default=90, help='起動ログ取得秒数（1〜300）')
    p.add_argument('--log-root', default=str(HOME / 'work/stackchan-runs'))
    a = p.parse_args(argv)
    if a.pr is not None and a.pr <= 0: p.error('--PR must be positive')
    if not 1 <= a.seconds <= 300: p.error('--seconds must be 1..300')
    if a.sha and not re.fullmatch('[0-9a-f]{40}', a.sha): p.error('--sha must be a full lowercase Git SHA')
    if a.all: a.check = a.test = a.build = a.write = True
    if not any((a.check,a.test,a.build,a.write,a.logs)): a.check=True
    os.umask(0o077)
    runner = Runner(a)
    for s in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(s, lambda signum, frame: (_ for _ in ()).throw(SystemExit(128+signum)))
    rc=0
    try: runner.execute()
    except (Exception, SystemExit) as e:
        rc = e.code if isinstance(e, SystemExit) and isinstance(e.code,int) else 1
        runner.log('ERROR', 'STEP='+runner.step+' '+str(e))
    finally:
        failed_step=runner.step
        try: runner.cleanup()
        except Exception as e:
            rc=1;runner.log('ERROR','cleanup/service restore failed: '+str(e))
        runner.log('INFO','EXIT='+str(rc)+' STEP='+failed_step+' LOG='+str(runner.run/'console.log'))
        runner.console.close()
    return rc

if __name__ == '__main__': sys.exit(main())
PY
