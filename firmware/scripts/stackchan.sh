#!/usr/bin/env bash
# Single entry point; Python is part of the existing kmac environment.
exec python3 - "$@" <<'PY'
import argparse, contextlib, datetime, fcntl, hashlib, json, os, pathlib, re, shlex
import signal, subprocess, sys, tempfile, time, shutil

HOME = pathlib.Path('/home/kmac')
DEFAULT_REPO = HOME / 'work/stackchan-context-recovery-20261109'
SDK_ENV = HOME / 'work/stackchan-pr87-pr89-evidence/sdk-env.sh'
IDF_ENV = HOME / '.local/share/esp32/esp-idf/export.sh'
DEVICE_PYTHON = HOME / '.espressif/python_env/idf6.1_py3.12_env/bin/python'
PRIVATE = pathlib.Path('/mnt/data/Development/stackchan/stack-chan/firmware/host/app/manifest_archive_private.json')
NODE = HOME / '.nvm/versions/node/v22.23.4/bin'
SERVICE = 'stackchan-hub.service'
SERIAL = '44:1B:F6:DF:5A:D0'
FILES = {'0x0': 'bootloader.bin', '0x8000': 'partition-table.bin', '0x10000': 'xs_esp32.bin'}

# No arbitrary trace lines: settings, tokens and conversation text must not leak.
SAFE_SOURCE = "def safe_line(line):\n    s = line.strip()\n    if s.startswith('@SC '):\n        try:\n            packet=json.loads(s[4:])\n            if packet.get('event')!='startup': return None\n            phase=packet.get('phase');error=packet.get('error');reason=packet.get('reason');site=packet.get('site','')\n            if phase not in ('initialization','launch','network','context','behavior','ready','unknown'): return None\n            if error not in ('none','Error','TypeError','RangeError','ReferenceError','SyntaxError','URIError','unknown'): return None\n            if reason not in ('none','memory','storage','network','unclassified'): return None\n            if site and not re.fullmatch(r'[A-Za-z0-9_-]+(?:\\.(?:js|ts))?(?::[0-9]+(?::[0-9]+)?)?',site): return None\n            component=packet.get('component','none');state=packet.get('componentState','begin')\n            if component not in ('none','preferences','selection','driver','ui','tts','touch','head-touch','touch-panel','imu','microphone','camera','speaker','media','led','runtime','runtime-motion','runtime-ui','runtime-audio','runtime-input','runtime-camera','runtime-lighting','runtime-timer','dock-context','experimental-miniapps','context-behaviors','archive-import','archive-start','mod-shortcut','archive-debug','archive-clock','archive-face','archive-offline','archive-history','archive-volume','archive-ai-settings','archive-wifi-display','archive-timer','archive-alarms','default-setup','default-face','default-hands','default-colors','default-imu'): return None\n            if state not in ('begin','done','failed'): return None\n            fields=[]\n            for key in ('sequence','stage','previousValid','previousSequence','previousStage','previousError','resetReason','internalFree','internalLargest','psramFree'):\n                value=packet.get(key)\n                if not isinstance(value,int) or isinstance(value,bool): return None\n                fields.append(key+'='+str(value))\n            for key in ('componentCode','previousComponent','previousInternalFree','previousInternalLargest','previousPsramFree'):\n                if key in packet:\n                    if not isinstance(packet[key],int) or isinstance(packet[key],bool): return None\n                    fields.append(key+'='+str(packet[key]))\n            for key,allowed in (\n                ('bootNetwork',('unknown','connected','skipped','failed')),\n                ('bootOffline',('unknown','selected','not-selected','automatic')),\n                ('bootNetworkReason',('unknown','connected','offline-selected','automatic-offline','usb-only','missing-credentials','timeout','scan-exhausted','connection-failed','not-started')),\n            ):\n                if key in packet:\n                    if packet[key] not in allowed: return None\n                    fields.append(key+'='+packet[key])\n            result='[startup] component='+component+' state='+state+' phase='+phase+' error='+error+' reason='+reason+' site='+site+' '+' '.join(fields)\n            if error!='none': result+='\\n[main] startup failed phase='+phase+' error='+error\n            elif phase=='ready': result+='\\n[main] app behaviors ready'\n            return result\n        except (ValueError,TypeError,AttributeError): return None\n    patterns = (\n        r'\\[main\\] (?:start|loading app behaviors|app context created|app behaviors ready)',\n        r'\\[main\\] onLaunch shouldCreateContext=(?:true|false)',\n        r'\\[main\\] network ready: (?:connected|skipped|failed)',\n        r'\\[main\\] startup failed phase=[a-z-]+ error=[A-Za-z]+',\n        r'\\[network\\] offline boot selected; saved credentials preserved',\n        r'\\[settings\\] (?:Wi-Fi connected|Wi-Fi connection failed|SD configuration unavailable|initialization failed; USB remains available)',\n        r'rst:0x[0-9a-f]+ \\([A-Z0-9_]+\\),boot:0x[0-9a-f]+ \\([A-Z0-9_]+\\)',\n        r'ESP-ROM:[a-zA-Z0-9-]+',\n    )\n    if any(re.fullmatch(p, s) for p in patterns): return s\n    if s.startswith('[main] startup detail:'): return '[main] startup detail: [omitted; may contain private values]'\n    return None"
exec(SAFE_SOURCE)

def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()


# Resolve tools inside the actual child shell; outer shell aliases/functions are irrelevant.
KERNEL_USB_SOURCE = r"""set +e
if command -v rg >/dev/null 2>&1; then
    search=(rg -i -e 'usb|ttyACM|cdc_acm|oom|out of memory')
elif command -v grep >/dev/null 2>&1; then
    search=(grep -Ei -e 'usb|ttyACM|cdc_acm|oom|out of memory')
else
    printf '%s\n' '[ERROR] Neither rg nor grep is available for kernel-usb' >&2
    exit 127
fi
journalctl -k --since '-30 min' --no-pager -o short-iso | "${search[@]}"
status=("${PIPESTATUS[@]}")
if (( status[0] != 0 )); then
    printf '[ERROR] journalctl failed exit=%s; search exit=%s\n' "${status[0]}" "${status[1]}" >&2
    exit "${status[0]}"
fi
case "${status[1]}" in
    0) exit 0 ;;
    1) printf '%s\n' '[INFO] No matching kernel USB/OOM events in the selected interval'; exit 0 ;;
    *) printf '[ERROR] Kernel search failed exit=%s\n' "${status[1]}" >&2; exit "${status[1]}" ;;
esac
"""

AUDIO_SAFE_SOURCE = "def safe_audio_line(line):\n    line=line.strip()\n    if line.startswith('[audio-state] '):\n        allowed={'ms','session','turn','drainTurn','state','previousState','provider','failureKind','drainUntil','hardwareUntil','resuming','head','tail','pending','queuedBytes','pcmBytes','asr','underruns','maxPumpGapMs'}\n        events={'tts-start','tts-stop','asr','text-final','mic-open','output-open','output-close','drain-start','drain-complete','health','failed','disconnected'}\n        fields=line.split()[1:];seen=set()\n        for field in fields:\n            key,sep,value=field.partition('=')\n            if not sep or key in seen: return None\n            seen.add(key)\n            if key=='event':\n                if value not in events:return None\n            elif key not in allowed or not re.fullmatch(r'-?[0-9]{1,16}',value):return None\n        return line if {'event','ms','session','state'}<=seen else None\n    if re.fullmatch(r'\\[playback\\] native queue starvation count=[0-9]+',line):return line\n    if re.fullmatch(r'\\[opus\\](?: (?:packets|pcm|captured|dropped_pcm|compressed|encode_avg|encode_max|decode_avg|decode_max|load)=[0-9]+(?:\\.[0-9]+)?(?:B|us|%)?)+',line):return line\n    if re.fullmatch(r'\\[heap\\](?: (?:nativeStackMinimumFree|internalFree|internalMinimum|internalLargest|psramFree|psramMinimum|psramLargest)=[0-9]+)+',line):return line\n    if line=='[xiaozhi] unsolicited speech suppressed; listening resumed':return line\n    if line.startswith(\"[audio-path] \"):\n        values={}\n        for field in line.split()[1:]:\n            key,sep,value=field.partition(\"=\")\n            if not sep or key in values:return None\n            values[key]=value\n        stage=values.pop(\"stage\",\"\")\n        required={\"decode\":{\"ms\",\"turn\",\"fragments\",\"skipped\",\"decoded\",\"failures\",\"pcmBytes\"},\"output\":{\"ms\",\"turn\",\"submittedBytes\",\"completedBytes\",\"completedChunks\",\"failures\",\"pending\",\"completed\",\"volume\"}}\n        if stage not in required or set(values)!=required[stage]:return None\n        return line if all(re.fullmatch(r\"[0-9]{1,16}\",v) for v in values.values()) else None\n    if re.fullmatch(r\"\\[asr\\] final chars=[0-9]{1,5}\",line):return line\n    if re.fullmatch(r\"\\[llm\\] output_final chars=[0-9]{1,5}\",line):return line\n    return None\n\ndef audio_packet_lines(packet, partial):\n    result=[]\n    if not isinstance(packet,dict) or packet.get('event')!='debug':return result,partial\n    fragments=packet.get('lines',[])\n    if not isinstance(fragments,list):return result,partial\n    for fragment in fragments[:16]:\n        if not isinstance(fragment,str):continue\n        if len(partial)+len(fragment)>4096:\n            partial='';result.append('[WARN] Oversized debug line omitted');continue\n        partial+=fragment\n        while '\\n' in partial:\n            line,partial=partial.split('\\n',1)\n            safe=safe_audio_line(line)\n            if safe:result.append(safe)\n    return result,partial\n"

AUDIO_CAPTURE_SOURCE = "import json,time,sys\nfrom pathlib import Path\nfrom serial import Serial,SerialException\nfrom serial.tools import list_ports\nexpected=json.loads(sys.argv[1]);duration=int(sys.argv[2]);manifest=Path(sys.argv[3])\nns={};exec('import re\\n'+sys.argv[4],ns);filter_packet=ns['audio_packet_lines']\ntry: token=json.loads(manifest.read_text())['config']['archiveToken']\nexcept (OSError,ValueError,KeyError,TypeError):raise SystemExit('Diagnostic authentication unavailable; no request sent')\nif not isinstance(token,str) or not token:raise SystemExit('Diagnostic authentication unavailable; no request sent')\ndtr_mode=sys.argv[5] if len(sys.argv)>5 else 'off'\nif dtr_mode not in ('off','on'):raise SystemExit('Invalid DTR mode; no port opened')\nend=time.monotonic()+duration;seen=False;counter=0;partial='';lines=0;responses=0\ndef emit(line):print(time.strftime('%Y-%m-%dT%H:%M:%S%z')+' '+line,flush=True)\nemit('[INFO] Delivery times may differ from buffered event times; no transcript collection enabled')\nwhile time.monotonic()<end:\n ports=[p for p in list_ports.comports() if (p.vid,p.pid,p.serial_number,p.location)==(expected['vid'],expected['pid'],expected['serial'],expected['location'])]\n if len(ports)!=1:time.sleep(.5);continue\n try:\n  stage='open'\n  serial=Serial(port=None,baudrate=115200,timeout=.25,write_timeout=1,exclusive=True)\n  serial.dtr=(dtr_mode=='on');serial.rts=False;serial.port=ports[0].device\n  with serial:\n   seen=True;inflight=None;next_poll=0\n   emit('[audio-io] stage=open result=success dtr='+dtr_mode+' rts=off')\n   while time.monotonic()<end:\n    now=time.monotonic()\n    if inflight is not None and now-sent_at>5:\n     emit('[ERROR] debug/status timed out; VM stall or transport failure not distinguished')\n     raise SystemExit(1)\n    if inflight is None and now>=next_poll:\n     counter+=1;inflight=counter;sent_at=now\n     # The only RPC used. No SD enumeration, mode changes, conversation logging, photo or replay.\n     packet={'id':counter,'token':token,'op':'/debug/status','args':{}}\n     stage='write'\n     wire=('@SC '+json.dumps(packet,separators=(',',':'))+'\\n').encode()\n     emit('[audio-io] stage=write request='+str(counter))\n     written=serial.write(wire)\n     if written!=len(wire):raise SystemExit('Diagnostic request write incomplete; no replay')\n    stage='read'\n    raw=serial.readline(4096)\n    if not raw.startswith(b'@SC '):continue\n    try:packet=json.loads(raw[4:])\n    except (ValueError,UnicodeDecodeError):continue\n    if not isinstance(packet,dict):continue\n    if inflight is not None and packet.get('id')==inflight:\n     if 'error' in packet:raise SystemExit('debug/status rejected; response body omitted')\n     status=packet.get('result')\n     if not isinstance(status,dict):raise SystemExit('Unexpected diagnostic response; body omitted')\n     fields=[]\n     for key in ('queued','dropped','truncated','usbRetries'):\n      value=status.get(key)\n      if isinstance(value,int) and not isinstance(value,bool) and 0<=value<=9007199254740991:fields.append(key+'='+str(value))\n     emit('[audio-status] '+' '.join(fields));responses+=1;inflight=None;next_poll=now+2\n    safe,partial=filter_packet(packet,partial)\n    for line in safe:emit(line);lines+=1\n except (SerialException,OSError) as error:\n  kind=type(error).__name__\n  if kind not in ('SerialException','SerialTimeoutException','OSError','PermissionError','BlockingIOError','TimeoutError'):kind='SerialError'\n  number=getattr(error,'errno',None)\n  if not isinstance(number,int) or isinstance(number,bool):number=0\n  emit('[ERROR] USB transport stage='+stage+' type='+kind+' errno='+str(number))\n  present=[p for p in list_ports.comports() if (p.vid,p.pid,p.serial_number,p.location)==(expected['vid'],expected['pid'],expected['serial'],expected['location'])]\n  if present:\n   raise SystemExit('Verified device remains enumerated; stopped without reopening or resending')\n  emit('[WARN] Verified device is no longer enumerated; bounded same-device observation continues')\n  partial='';time.sleep(.5)\nif not seen:raise SystemExit('Known USB device never became available; no audio evidence collected')\nemit('[INFO] audio diagnostic responses='+str(responses)+' lines='+str(lines))\nif not responses:raise SystemExit('No authenticated diagnostic response; capture is incomplete')\nif not lines:emit('[WARN] No matching audio evidence; completion does not prove playback success')\n"

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
        self.completed = []
        self.failed_command = None
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
            isolation = {'process_group': 0} if pathlib.Path(str(argv[0])).name == 'sudo' else {'start_new_session': True}
            self.child = subprocess.Popen(list(map(str, argv)), cwd=cwd, stdout=out, stderr=subprocess.STDOUT,
                                          env=env or self.env, **isolation)
            try:
                rc = self.child.wait(timeout=timeout)
            except BaseException:
                self.stop_child()
                raise
            finally:
                self.child = None
        if rc:
            self.failed_command = name
            self.log('ERROR', 'STEP=' + name + ' EXIT=' + str(rc) + ' CMD=' + shown + ' LOG=' + str(path))
            for line in path.read_text(errors='replace').splitlines()[-40:]:
                # Full tool output is private on disk; sanitize terminal error snippets.
                self.log('ERROR', self.redact(line)[:600])
            raise RuntimeError('command failed: ' + name)
        self.completed.append(name)
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

    def recovery_port(self):
        address = getattr(self.a, 'usb_path', None)
        if not address or not re.fullmatch(r'[1-9][0-9]*-[1-9][0-9]*',address):
            raise RuntimeError('--recover-usb requires an explicit root-hub --usb-path, e.g. 1-1')
        bus, port = address.split('-')
        root = pathlib.Path('/sys/bus/usb/devices')
        target = root / ('usb'+bus) / (bus+'-0:1.0') / ('usb'+bus+'-port'+port)
        if (target/'connect_type').read_text().strip() != 'hotplug':
            raise RuntimeError('refusing recovery of an internal/unknown USB port')
        if (target/'disable').read_text().strip() != '0':
            raise RuntimeError('port already disabled; preserve its state and inspect manually')
        device = root/address
        if device.exists():
            identity = ((device/'idVendor').read_text().strip(),(device/'idProduct').read_text().strip(),(device/'serial').read_text().strip())
            if identity != ('303a','1001',SERIAL): raise RuntimeError('USB port belongs to another device; recovery refused')
        return bus, port

    def recover_usb(self):
        bus, port = self.recovery_port()
        self.confirm('指定した外部USBポート '+bus+'-'+port+' だけを一時無効化し、再認識を1回試しますか？')
        self.cmd('recovery-privilege', ['sudo','-n','true'])
        with self.own_usb():
            self.cmd('usb-port-recovery', ['sudo','-n','/usr/bin/python3','-c',USB_RECOVERY_SOURCE,bus,port,SERIAL],timeout=20)
            self.cmd('usb-recovery-wait', [DEVICE_PYTHON,'-c',
                'import time,sys,json\nfrom serial.tools import list_ports\nend=time.monotonic()+20\n'
                'while time.monotonic()<end:\n ps=[p for p in list_ports.comports() if (p.vid,p.pid,p.serial_number)==(0x303a,0x1001,sys.argv[1]) and p.location and p.location.split(":")[0]==sys.argv[2]]\n'
                ' if len(ps)==1: print(json.dumps(dict(port=ps[0].device,location=ps[0].location)));sys.exit(0)\n time.sleep(.5)\n'
                'raise SystemExit("Known StackChan did not re-enumerate; no flash attempted")',SERIAL,bus+'-'+port],timeout=25)
        self.log('INFO','USB recovery verified for known device. No firmware has been written by recovery.')

    def check(self):
        self.report_last_flash()
        if not (self.repo / 'AGENTS.md').is_file() or not self.fw.is_dir(): raise RuntimeError('repository missing: ' + str(self.repo))
        self.head = self.query(['git', 'rev-parse', 'HEAD'])
        if self.a.sha and not getattr(self, 'pr_info', None) and self.a.sha != self.head: raise RuntimeError('HEAD differs from --sha')
        if self.query(['git', 'status', '--porcelain', '--untracked-files=no']): raise RuntimeError('tracked changes exist; preserve them and use a clean worktree')
        self.cmd('diff-check', ['git', 'diff', '--check'], self.repo)
        for path in [SDK_ENV, IDF_ENV, DEVICE_PYTHON, NODE / 'node', PRIVATE]:
            if not path.is_file(): raise RuntimeError('missing: ' + str(path))
        self.log('CHECK', 'HOST=' + os.uname().nodename + ' SHA=' + self.head + ' REPO=' + str(self.repo))
        self.log('CHECK', 'WORKTREE_BRANCH=' + (self.query(['git','branch','--show-current']) or '(detached)'))
        self.log('CHECK', 'DISK_FREE_GiB=' + str(round(shutil.disk_usage(self.repo).free / 2**30, 1)))
        self.cmd('host-uptime', ['uptime'])
        if getattr(self.a, 'check', False) or not any((self.a.test, self.a.build, self.a.write, self.a.logs)):
            self.check_usb()
        self.log('INFO', 'No GitHub merge/push, SD backup, settings erase or photo request. Flash backup retained.')

    def save_flash_record(self, record):
        path = self.run / 'flash-record.json'
        temporary = path.with_suffix('.tmp')
        with temporary.open('x', encoding='utf-8') as out:
            json.dump(record, out, indent=2, ensure_ascii=True)
            out.write('\n'); out.flush(); os.fsync(out.fileno())
        temporary.replace(path)

    def flash_record_snapshot(self, expected):
        receipt = json.loads(self.receipt.read_text())
        return dict(version=1, sha=self.head,
                    branch=self.query(['git','branch','--show-current']) or '(detached)',
                    repo=str(self.repo), serial=expected['serial'],
                    firmware_sha256=receipt['artifacts']['xs_esp32.bin'],
                    artifacts=receipt['artifacts'], boot='not-verified', origin='recorded-at-flash')

    def legacy_flash_record(self, run, text):
        match = re.search(r'^\[CHECK\] HOST=.*? SHA=([0-9a-f]{40}) .*?REPO=(.+)$', text, re.M)
        if not match: return None
        commit, repo = match.groups()
        record = dict(sha=commit, repo=repo, branch='unknown', firmware_sha256='unknown',
                      boot='startup-confirmed' if 'PASS boot-check:' in text else 'not-verified', origin='legacy-log')
        # Old logs did not snapshot branch/hash. Infer only from a matching
        # worktree/receipt, and label the inference rather than claiming a read
        # of the currently running device.
        try:
            def git(*args):
                return subprocess.check_output(['git','-C',repo,*args], text=True, stderr=subprocess.DEVNULL).strip()
            if git('rev-parse','HEAD') == commit:
                record['branch'] = git('branch','--show-current') or '(detached)'
                record['branch_inferred'] = True
            receipt = json.loads((pathlib.Path(repo)/'firmware/dist/stackchan-build-receipt.json').read_text())
            app = pathlib.Path(repo)/'firmware/dist/bin/esp32/m5stackchan_cores3/release/stack-chan-host/xs_esp32.bin'
            digest = receipt.get('artifacts', {}).get('xs_esp32.bin')
            if receipt.get('sha') == commit and isinstance(digest,str) and re.fullmatch('[0-9a-f]{64}',digest) and sha(app) == digest:
                record['firmware_sha256'] = digest
                record['hash_inferred'] = True
        except (OSError, ValueError, subprocess.SubprocessError): pass
        return record

    def report_last_flash(self):
        latest_attempt = None
        for run in sorted(self.run.parent.glob('run-*'), reverse=True):
            if not run.is_dir() or run == self.run: continue
            try:
                text = (run/'console.log').read_text(errors='replace')
                if not (run/'flash.command.txt').is_file() and '[INFO] PASS STEP=flash LOG=' not in text: continue
                saved = run/'flash-record.json'
                try: record = json.loads(saved.read_text()) if saved.is_file() else None
                except (OSError,ValueError): record = None
                if isinstance(record,dict) and record.get('serial',SERIAL) != SERIAL: continue
                if latest_attempt is None: latest_attempt = run
                # A later failed build/test/backup is not a new flash. A later
                # interrupted write CAN have changed the device: warn below.
                if '[INFO] PASS STEP=flash LOG=' not in text: continue
                if not isinstance(record,dict) or not re.fullmatch('[0-9a-f]{40}',str(record.get('sha',''))):
                    record = self.legacy_flash_record(run,text)
                if record is None: continue
                digest = record.get('firmware_sha256','unknown')
                if digest != 'unknown' and not re.fullmatch('[0-9a-f]{64}',str(digest)): continue
            except (OSError,ValueError): continue
            self.log('CHECK', 'LAST_FLASH_COMMIT=' + record['sha'])
            self.log('CHECK', 'LAST_FLASH_BRANCH=' + json.dumps(record.get('branch','unknown'),ensure_ascii=True))
            self.log('CHECK', 'LAST_FLASH_FIRMWARE_SHA256=' + digest)
            self.log('CHECK', 'LAST_FLASH_BOOT=' + record.get('boot','not-verified') + ' LOG=' + str(run/'console.log'))
            self.log('INFO', '最終書き込みのホスト記録です。実機の現在値を読み出した結果ではありません。')
            if record.get('origin') == 'legacy-log':
                self.log('WARN', '旧ログ: ブランチは現在の同SHA worktree、SHA256は同SHAの現存ビルドからの推定。確認できない項目はunknown。')
            if latest_attempt != run:
                self.log('WARN', '後続の書き込みは未完了。実機内容は不明: ' + str(latest_attempt/'console.log'))
            return record
        self.log('CHECK', 'LAST_FLASH_COMMIT=unknown LAST_FLASH_BRANCH=unknown LAST_FLASH_FIRMWARE_SHA256=unknown')
        if latest_attempt: self.log('WARN', '成功未確認の書き込み記録あり: ' + str(latest_attempt/'console.log'))
        return None

    def check_usb(self):
        usb_error = None
        try: self.log('CHECK', 'USB=' + self.identity()['port'])
        except RuntimeError as error: usb_error = error
        state = subprocess.run(['systemctl','--user','show',SERVICE,'-p','ActiveState','-p','Result','-p','ExecMainStatus'], capture_output=True, text=True)
        if state.returncode: self.log('WARN', 'HUB: user systemd bus unavailable; service state unknown')
        else:
            for line in state.stdout.splitlines(): self.log('CHECK', 'HUB.' + line)
        if usb_error:
            journal = subprocess.run(['journalctl','-k','--since','-15 min','--no-pager','-o','short-iso'],capture_output=True,text=True)
            path = self.run / 'usb-kernel.log'
            lines = [line for line in journal.stdout.splitlines() if re.search(r'usb|ttyACM|cdc_acm',line,re.I)]
            path.write_text('\n'.join(lines[-200:]) + '\n')
            self.log('ERROR', 'USB preflight failed; no port opened. KERNEL_LOG=' + str(path))
            raise usb_error
        if state.returncode:
            self.step = 'hub-state'
            raise RuntimeError('cannot verify hub service state; preflight incomplete')

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
        modules = data.setdefault('modules', {})
        public_modules = example.get('modules', {})
        for name in ['archive-camera-handoff', 'archive-camera-release', 'archive-chat-pause-gate']:
            if name not in public_modules:
                modules.pop(name, None)
        for name, mapping in public_modules.items():
            modules[name] = mapping
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

    def firmware_identity(self, ref):
        if not re.fullmatch('[0-9a-f]{40}',ref): raise RuntimeError('invalid receipt source SHA')
        data=subprocess.check_output(['git','ls-tree','-rz',ref,'--','firmware'],cwd=self.repo)
        # CLI/docs do not enter the firmware image. Keep all other source/build inputs.
        entries=[e for e in data.split(b'\0') if e and e.split(b'\t',1)[1] not in
                 (b'firmware/scripts/stackchan.sh',b'firmware/scripts/lib/stackchan-cli.test.py') and
                 not e.split(b'\t',1)[1].startswith(b'firmware/docs/')]
        return hashlib.sha256(b'\0'.join(entries)).hexdigest()

    def verify_receipt(self):
        if self.query(['git', 'rev-parse', 'HEAD']) != self.head or self.query(['git', 'status', '--porcelain', '--untracked-files=no']):
            raise RuntimeError('source changed during operation; refusing write')
        if not self.receipt.exists(): raise RuntimeError('build receipt missing; run --build first (existing old binaries are not silently reused)')
        r = json.loads(self.receipt.read_text())
        current=self.fingerprint()
        for k,v in current.items():
            if r.get(k)==v: continue
            if k=='sha' and self.firmware_identity(r.get(k,''))==self.firmware_identity(v):
                self.log('INFO','Firmware inputs unchanged; reusing build SHA='+r[k]+' with tool SHA='+v)
                continue
            raise RuntimeError('source/SDK/private configuration changed; run --build')
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
        self.log('INFO', '起動phase/reset reasonのみ保存。次のSTEP=boot-stages表示後、本体RSTを短く1回押してください。指定した秒数だけ収集します。自動RSTはしません。')
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
''', json.dumps(expected), str(self.a.seconds), 'import re,json\n' + SAFE_SOURCE], timeout=self.a.seconds + 10)
        self.log('WARN', 'ログ収集の終了は正常起動・撮影成功の判定ではありません。')

    def capture_audio(self, expected):
        self.log('INFO', '音声の状態・数値のみ保存します。RSTは押さず、そのまま取得してください。AIモード・会話本文ログは変更しません。')
        self.cmd('audio-logs', [DEVICE_PYTHON, '-c', AUDIO_CAPTURE_SOURCE, json.dumps(expected),
                                str(self.a.seconds), PRIVATE, AUDIO_SAFE_SOURCE, getattr(self.a, 'dtr', 'off')], timeout=self.a.seconds + 10)
        self.log('WARN', 'ログ取得完了は音声再生の成功判定ではありません。')

    def logs(self):
        self.cmd('kernel-usb', ['bash', '-c', KERNEL_USB_SOURCE])
        # Do not dump raw hub logs or general journal entries containing private values.
        source = pathlib.Path('/mnt/data/Development/stackchan/hub/logs/diagnostic.log')
        if source.exists():
            self.log('CHECK', 'Hub log modified=' + datetime.datetime.fromtimestamp(source.stat().st_mtime).astimezone().isoformat())
            with (self.run / 'hub-stages.log').open('w') as out:
                for line in source.read_text(errors='replace').splitlines():
                    marker = line.find('[main]')
                    safe = safe_line(line[marker:]) if marker >= 0 else None
                    if safe: out.write(safe + '\n')
        audio = getattr(self.a, 'audio', False)
        self.confirm(('認証済みdebug/statusのみで音声ログを' if audio else '本体へ要求を送らず、USB起動ログを') + str(self.a.seconds) + '秒取得しますか？')
        expected = self.identity()
        with self.own_usb():
            self.unoccupied(expected['port'])
            if audio: self.capture_audio(expected)
            else: self.capture(expected)

    def connection_command(self, base):
        command = list(base)
        if getattr(self.a, 'reset', 'manual') == 'usb':
            command[command.index('--before') + 1] = 'usb-reset'
        return command

    def check_pr_freshness(self):
        if getattr(self, 'pr_info', None) and self.pr_metadata() != self.pr_info:
            raise RuntimeError('PR/base changed during validation; stop and rerun against the new snapshot')

    def write(self):
        if not os.environ.get('TMUX'): raise RuntimeError('--write/--all must run inside tmux to survive SSH disconnect')
        self.check_pr_freshness()
        self.verify_receipt()
        expected = self.identity()
        self.log('CHECK', 'TARGET=m5stackchan_cores3 SHA=' + self.head + ' PORT=' + expected['port'])
        self.confirm('16MiBバックアップを読み取りますか？ 接続方式=' + getattr(self.a, 'reset', 'manual'))
        with self.own_usb():
            expected = self.same_device(expected)
            self.unoccupied(expected['port'])
            base = [DEVICE_PYTHON, '-m', 'esptool', '--chip', 'esp32s3', '--port', expected['port'], '--before', 'no-reset', '--after', 'no-reset', '--connect-attempts', '1']
            connect = self.connection_command(base)
            info = self.cmd('flash-id', connect + ['--no-stub', 'flash-id'], timeout=30)
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
            record = self.flash_record_snapshot(now)
            self.cmd('flash', argv, timeout=300)
            record['verified_at'] = datetime.datetime.now().astimezone().isoformat()
            self.save_flash_record(record)
            self.log('INFO', '書き込み検証完了。通常起動ログを取得します。本体RSTを短く1回押してください。')
            self.capture(expected)
            self.validate_boot()
            record['boot'] = 'startup-confirmed'
            self.save_flash_record(record)
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
        if getattr(self.a, 'recover_usb', False):
            self.recover_usb()
            if not any((self.a.check,self.a.test,self.a.build,self.a.write,self.a.logs)): return
        if getattr(self.a, 'pr', None): self.prepare_pr()
        self.check()
        if self.a.test or self.a.build or self.a.write:
            self.setup_env()
        if self.a.test: self.test()
        if self.a.build: self.build()
        if self.a.write: self.write()
        if self.a.logs and not self.a.write: self.logs()

    def final_summary(self, rc, failed_step):
        def git(*args):
            try:
                return subprocess.check_output(['git', '-C', str(self.repo), *args],
                    stderr=subprocess.DEVNULL, text=True, timeout=5).strip()
            except Exception:
                return ''
        commit = getattr(self, 'head', None) or git('rev-parse', 'HEAD')
        branch = git('branch', '--show-current') or '(detached)'
        selected = {'状態確認': True, 'テスト': self.a.test,
                    'ビルド': self.a.build, '書き込み': self.a.write,
                    '起動確認': self.a.write or self.a.logs}
        required = {'状態確認': ('diff-check', 'host-uptime'),
                    'テスト': ('cli', 'unit', 'archive'),
                    'ビルド': ('build',), '書き込み': ('flash',),
                    '起動確認': ('boot-check',)}
        completed = set(self.completed)
        states = {}
        for label, names in required.items():
            if not selected[label]: states[label] = '対象外'
            elif all(n in completed for n in names): states[label] = '成功'
            elif rc and (failed_step in names or self.failed_command in names):
                states[label] = '失敗'
            else: states[label] = '未実行'
        if self.a.write and 'flash' in completed:
            states['起動確認'] = ('失敗' if rc and failed_step == 'boot-check'
                                   else '成功' if rc == 0 else '未実行')
        if rc and states['状態確認'] == '未実行':
            states['状態確認'] = '失敗' if not completed else '未実行'
        counts = {'tests': 0, 'pass': 0, 'fail': 0}
        failures = []
        for name in ('unit', 'archive'):
            path = self.run / (name + '.log')
            if not path.exists(): continue
            output = path.read_text(errors='replace')
            for key in counts:
                values = re.findall(r'^# ' + key + r'\s+(\d+)\s*$', output, re.M)
                if values: counts[key] += int(values[-1])
            failures.extend({'step': name, 'test': m.group(1)[:160]}
                for m in re.finditer(r'^not ok\s+\d+\s+-\s+(.+)$', output, re.M))
        if self.failed_command == 'cli':
            failures.append({'step': 'cli', 'test': 'CLI回帰テスト失敗'})
        fw_hash = None
        try:
            receipt = json.loads(self.receipt.read_text())
            if receipt.get('sha') == commit:
                fw_hash = receipt.get('artifacts', {}).get('xs_esp32.bin')
        except (OSError, ValueError, TypeError, AttributeError):
            pass
        last_flash = None
        root = pathlib.Path(self.a.log_root).expanduser()
        for path in sorted(root.glob('run-*/flash-record.json'),
                           key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                last_flash = json.loads(path.read_text())
                break
            except (OSError, ValueError, TypeError):
                continue
        def short(value):
            return str(value)[:12] if value else 'unknown'
        lines = ['========== StackChan 最終結果 ==========',
                 '対象        ' + ('PR #' + str(self.a.pr) if self.a.pr else branch),
                 'ブランチ    ' + branch,
                 'コミット    ' + short(commit),
                 '結果        ' + ('成功' if rc == 0 else '失敗 (' + failed_step + ')')]
        for label, state in states.items():
            if label == 'テスト' and counts['tests']:
                state += ' (' + str(counts['pass']) + '/' + str(counts['tests']) +
                         ' 成功、' + str(counts['fail']) + '件失敗)'
            lines.append(label + '    ' + state)
        if fw_hash: lines.append('ビルドSHA256  ' + short(fw_hash))
        if rc:
            lines.append('失敗STEP    ' + failed_step)
            for item in failures[:5]:
                lines.append('失敗テスト  ' + self.redact(item['test']))
            if len(failures) > 5:
                lines.append('その他      ' + str(len(failures)-5) + '件（詳細ログ参照）')
        if last_flash:
            lines.extend(['最終書込    ' + short(last_flash.get('sha')),
                          '実機FW SHA  ' + short(last_flash.get('firmware_sha256')),
                          '前回起動    ' + str(last_flash.get('boot', 'unknown')) + '（ホスト記録）'])
        lines.append('ログ        ' + str(self.run / 'console.log'))
        lines.append('=======================================')
        summary = {'result': 'success' if rc == 0 else 'failed', 'exit_code': rc,
                   'pr': self.a.pr, 'branch': branch, 'commit': commit,
                   'steps': states, 'test_counts': counts, 'failed_tests': failures,
                   'failed_step': failed_step if rc else None,
                   'firmware_sha256': fw_hash, 'last_flash': last_flash,
                   'log': str(self.run / 'console.log')}
        target = self.run / 'summary.json'
        temporary = self.run / 'summary.json.tmp'
        temporary.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(target)
        for line in lines: self.log('INFO', line)

    def cleanup(self):
        self.stop_child()
        dst = self.fw / 'host/app/manifest_archive_private.json'
        if self.manifest_changed:
            if self.manifest_before is None: dst.unlink(missing_ok=True)
            else: dst.write_bytes(self.manifest_before); dst.chmod(0o600)
        self.restore_hub()

USB_RECOVERY_SOURCE = "import pathlib,sys,time,signal\nbus,port,serial=sys.argv[1:]\nif not bus.isdecimal() or not port.isdecimal(): raise SystemExit('Invalid USB path')\nroot=pathlib.Path('/sys/bus/usb/devices');target=root/('usb'+bus)/(bus+'-0:1.0')/('usb'+bus+'-port'+port)\nif (target/'connect_type').read_text().strip()!='hotplug' or (target/'disable').read_text().strip()!='0': raise SystemExit('Unsafe USB port state')\ndevice=root/(bus+'-'+port)\nif device.exists():\n if ((device/'idVendor').read_text().strip(),(device/'idProduct').read_text().strip(),(device/'serial').read_text().strip())!=('303a','1001',serial): raise SystemExit('Another USB device occupies this port')\nfor sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP): signal.signal(sig,lambda signum,frame:sys.exit(128+signum))\ntry:\n (target/'disable').write_text('1\\n');time.sleep(2)\nfinally:\n (target/'disable').write_text('0\\n')\nprint('Selected external port re-enabled')\n"

def main(argv=None):
    p = argparse.ArgumentParser(prog='stackchan.sh', description='StackChan統一操作。指定した処理だけ実行。無指定は--check。書き込みはyes/no確認。')
    for mode in ('check', 'test', 'build', 'write', 'logs', 'all'): p.add_argument('--'+mode, action='store_true')
    p.add_argument('--dtr', choices=('off','on'), default='off', help='音声採取時のDTR状態。onは既存Hubと同じ通常接続設定。RTSは常にoff、パルスなし')
    p.add_argument('--audio', action='store_true', help='--logsと併用。debug/statusで音声の数値ログのみ収集。RST・AI切替・会話本文記録なし')
    p.add_argument('--recover-usb', action='store_true', help='明示した外部USBポートだけを再初期化。root権限が必要。全controllerはリセットしない')
    p.add_argument('--usb-path', help='復旧対象のroot-hub接続経路（例1-1）。内部USBや別機器は拒否')
    p.add_argument('--reset', choices=('manual','usb'), default='manual', help='ROM接続方法。usbは最初の接続確認だけUSB用リセットを実行。失敗時は停止し再送しない')
    p.add_argument('--yes', action='store_true', help='この実行のバックアップ・書き込み・hub一時停止・ログ取得を事前承認。確認入力を省略')
    p.add_argument('--PR', '--pr', dest='pr', type=int, help='PR番号。最新baseとHEADを専用worktreeでローカル統合。GitHubマージはしない')
    p.add_argument('--repo', default=str(DEFAULT_REPO), help='対象worktree（既定はWi-Fi修正を含むPR90）')
    p.add_argument('--sha', help='要求する40桁HEAD。--PR指定時はPRのHEADを照合')
    p.add_argument('--port', help='任意のUSBパス。指定時も本体シリアルと物理ポートを照合')
    p.add_argument('--seconds', type=int, default=90, help='起動ログ取得秒数（1〜300）')
    p.add_argument('--log-root', default=str(HOME / 'work/stackchan-runs'))
    a = p.parse_args(argv)
    if a.recover_usb and not a.usb_path: p.error('--recover-usb requires --usb-path')
    if a.usb_path and not a.recover_usb: p.error('--usb-path requires --recover-usb')
    if a.pr is not None and a.pr <= 0: p.error('--PR must be positive')
    if not 1 <= a.seconds <= 300: p.error('--seconds must be 1..300')
    if a.sha and not re.fullmatch('[0-9a-f]{40}', a.sha): p.error('--sha must be a full lowercase Git SHA')
    if a.all: a.check = a.test = a.build = a.write = True
    if a.dtr != 'off' and not (a.audio and a.logs): p.error('--dtr on requires --logs --audio')
    if a.audio and (not a.logs or a.write or a.recover_usb): p.error('--audio requires --logs and cannot be used with --write/--all/--recover-usb')
    if not any((a.check,a.test,a.build,a.write,a.logs,a.recover_usb)): a.check=True
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
        try: runner.final_summary(rc, failed_step)
        except Exception as e:
            rc=1;runner.log('ERROR','final summary failed: '+str(e))
        runner.log('INFO','EXIT='+str(rc)+' STEP='+failed_step+' LOG='+str(runner.run/'console.log'))
        runner.console.close()
    return rc

if __name__ == '__main__': sys.exit(main())
PY
