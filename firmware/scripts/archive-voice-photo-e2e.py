#!/usr/bin/env python3
"""kmac VOICEVOX -> ALSA speaker -> StackChan voice/photo E2E over authenticated LAN.

Device read-only by default; --enable-ai asks before changing saved AI mode.
No USB, firmware flashing, raw transcripts or credentials in diagnostic files.
"""
from __future__ import annotations
import argparse
import datetime as dt
import ipaddress
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

DEFAULT_FW = Path('/mnt/data/Development/stackchan/stack-chan-pr55-acceptance/firmware')
DEFAULT_SPEAK = Path('/home/kmac/work/camera-voicevox/speak.py')

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError('Device redirect refused')

def device_ip(value: str) -> str:
    ip = ipaddress.IPv4Address(value)
    if not any(ip in ipaddress.IPv4Network(block) for block in
               ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')):
        raise ValueError('Device IP must be a private RFC1918 IPv4 address')
    return str(ip)

def clean_number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None

def clean_tag(value):
    if not isinstance(value, str): return None
    value = value[:45]
    return value if value and all(c.isascii() and (c.isalnum() or c in '-_') for c in value) else 'other'

def safe_status(raw: dict) -> dict:
    if not isinstance(raw, dict): raise ValueError('Status reply is not an object')
    chat = raw.get('chat') if isinstance(raw.get('chat'), dict) else {}
    audio = chat.get('audio') if isinstance(chat.get('audio'), dict) else {}
    photo = raw.get('photo') if isinstance(raw.get('photo'), dict) else {}
    return {
        'chat': {
            'enabled': chat.get('enabled') is True,
            'recognitionMode': chat.get('recognitionMode') is True,
            'state': clean_tag(chat.get('state')),
            'provider': clean_tag(chat.get('provider')),
            'audio': {key: clean_number(audio.get(key)) for key in
                      ('inputEvents','lastInputAt','inputPeak','recognizedEvents','lastTranscriptAt')},
        },
        'photo': {
            'phase': clean_tag(photo.get('phase')),
            'startedAt': clean_number(photo.get('startedAt')),
            'elapsedMs': clean_number(photo.get('elapsedMs')),
            'saved': photo.get('saved') is True,
            'errorStage': clean_tag(photo.get('errorStage')),
            'errorReasonClass': clean_tag(photo.get('errorReasonClass')),
            'jpegBytes': clean_number(photo.get('jpegBytes')),
        },
    }

class Device:
    def __init__(self, ip: str, token: str):
        self.url = f'http://{device_ip(ip)}:8082'
        self.token = token
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, route: str, payload: dict | None = None) -> dict:
        if route not in ('/status', '/rpc'): raise ValueError('Unsupported route')
        body = None if payload is None else json.dumps(payload, separators=(',',':')).encode()
        req = Request(self.url + route, data=body, method='GET' if body is None else 'POST',
                      headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json',
                               **({'Content-Type':'application/json'} if body is not None else {})})
        with self.opener.open(req, timeout=5) as response:
            data = response.read(65537)
            if response.status != 200 or len(data)>65536:
                raise ValueError('Invalid device response')
        result = json.loads(data)
        if not isinstance(result, dict) or 'error' in result:
            raise ValueError('Device returned an error (details omitted)')
        return result

    def status(self):
        return safe_status(self.request('/status'))

    def start_ai(self):
        self.request('/rpc', {'op':'/chat/start','args':{}})

def delta(before: dict, after: dict, name: str):
    a = before['chat']['audio'].get(name)
    b = after['chat']['audio'].get(name)
    return b-a if a is not None and b is not None and b>=a else None

def verdict(before: dict, after: dict):
    old = before['photo']['startedAt'] or 0
    new = after['photo']['startedAt']
    is_new = new is not None and new>old
    photo = after['photo']
    if is_new and photo['saved'] and (photo['jpegBytes'] or 0)>0:
        return 'PASS', '新しいJPEGのSD保存を報告（画像内容は未検証）'
    if is_new and photo['phase']=='error':
        return 'FAIL', f"カメラ失敗 stage={photo['errorStage']} class={photo['errorReasonClass']}"
    if is_new:
        return 'UNVERIFIED', f"撮影開始は確認、結果未確定 phase={photo['phase']}"
    recognized = delta(before, after, 'recognizedEvents')
    inputs = delta(before, after, 'inputEvents')
    if recognized is None:
        return 'UNVERIFIED', 'ASRカウンターが取得できません'
    if recognized==0:
        if inputs==0: return 'NO_INPUT', '入力イベント・ASR確定とも増加なし：音声セッションとマイクを確認'
        return 'NO_ASR', f'入力イベント+{inputs}、ASR確定0：距離・音量・VAD/クラウドを確認'
    return 'NO_PHOTO', f'ASR確定+{recognized}、撮影開始なし：認識文字列・命令判定を確認'

def save(path: Path, obj: dict):
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd,'w',encoding='utf-8') as handle:
        json.dump(obj,handle,ensure_ascii=False,indent=2)
        handle.write('\n')

def status_line(stage: str, obj: dict, first: dict | None = None):
    c,p = obj['chat'],obj['photo']
    a = c['audio']
    d = '' if first is None else f" delta_input={delta(first,obj,'inputEvents')} delta_asr={delta(first,obj,'recognizedEvents')}"
    print(f"[CHECK] {stage}: enabled={c['enabled']} recognition={c['recognitionMode']} state={c['state']} input={a['inputEvents']} asr={a['recognizedEvents']}{d}",flush=True)
    print(f"[CHECK] {stage}: photo={p['phase']} saved={p['saved']} stage={p['errorStage']} class={p['errorReasonClass']}",flush=True)

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ip',default='192.168.2.102')
    parser.add_argument('--firmware',type=Path,default=DEFAULT_FW)
    parser.add_argument('--config',type=Path)
    parser.add_argument('--speak-script',type=Path,default=DEFAULT_SPEAK)
    parser.add_argument('--alsa-device',default='plughw:1,0')
    parser.add_argument('--text',default='写真を撮って')
    parser.add_argument('--wait',type=int,default=20)
    parser.add_argument('--enable-ai',action='store_true',help='Ask before enabling AI mode via LAN')
    parser.add_argument('--status-only',action='store_true')
    parser.add_argument('--output-dir',type=Path,default=Path.home()/'stackchan-voice-photo-tests')
    args = parser.parse_args(argv)
    step = 'PREFLIGHT'
    try:
        device_ip(args.ip)
        if not 4<=args.wait<=60: raise ValueError('--wait must be 4..60')
        config = args.config or args.firmware/'host/app/manifest_archive_private.json'
        token = json.loads(config.read_text(encoding='utf-8')).get('config',{}).get('archiveToken')
        if not isinstance(token,str) or len(token)<16: raise ValueError('Archive token missing')
        if not args.status_only:
            player = args.firmware/'scripts/voicevox-pc-play.py'
            if not player.is_file() or not args.speak_script.is_file():
                raise ValueError('VOICEVOX player / speak.py missing')
            if not shutil.which('aplay'): raise ValueError('aplay not installed')
        step = 'LAN'
        dev=Device(args.ip,token)
        before=dev.status()
        status_line('BEFORE',before)
        if args.status_only: return 0
        if args.enable_ai and not before['chat']['enabled']:
            step='MODE'
            if not sys.stdin.isatty(): raise ValueError('--enable-ai requires a terminal')
            if input('[ACTION] LAN経由でAIモードをONにしますか？ (yes/no): ').strip()!='yes':
                raise ValueError('User declined mode change')
            dev.start_ai()
            for _ in range(12):
                time.sleep(2)
                before=dev.status()
                if before['chat']['enabled'] and before['chat']['state']=='listening':
                    break
            status_line('AFTER_AI_ON',before)
        if not (before['chat']['enabled'] or before['chat']['recognitionMode']):
            print('[WARN] 会話と文字起こしが両方OFF。設定を変えずに終了',flush=True)
            return 2
        if before['chat']['state']!='listening':
            print('[WARN] listeningではありません。再生せず終了 state='+str(before['chat']['state']),flush=True)
            return 2
        step = 'PLAY'
        args.output_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
        out = args.output_dir/('trial-'+dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        out.mkdir(mode=0o700,exist_ok=False)
        save(out/'before.json',before)
        print('[ACTION] STEP=VOICEVOX ALSA経由で「'+args.text[:50]+'」を再生',flush=True)
        play=subprocess.run([sys.executable,str(player),'--speak-script',str(args.speak_script),
                            '--player','aplay','--alsa-device',args.alsa_device,args.text],
                            timeout=130,check=False)
        if play.returncode:
            print(f'[ERROR] VOICEVOX再生失敗 exit={play.returncode}',flush=True)
            return 1
        step='POLL'
        latest=before
        end=time.monotonic()+args.wait
        while time.monotonic()<end:
            time.sleep(2)
            try:
                latest=dev.status()
            except (OSError,ValueError,HTTPError,URLError,TimeoutError) as exc:
                print('[WARN] STEP=POLL '+type(exc).__name__+'（再試行）',flush=True)
                continue
            status_line('AFTER',latest,before)
            p=latest['photo']
            if (p['startedAt'] is not None and p['startedAt']>(before['photo']['startedAt'] or 0)
                    and p['phase'] in ('error','complete','saved','analysis-unavailable')):
                break
        save(out/'after.json',latest)
        step='VERDICT'
        result,reason=verdict(before,latest)
        print(f'[CHECK] STEP=VERDICT {result}: {reason}',flush=True)
        print(f'[INFO] 診断保存先={out} （認証情報/音声本文は保存しません）',flush=True)
        print('[INFO] 実際の発話の聞き取りと画像内容・会話復帰は別途確認が必要',flush=True)
        return 0 if result=='PASS' else 1 if result=='FAIL' else 2
    except (OSError,ValueError,HTTPError,URLError,TimeoutError,subprocess.TimeoutExpired,json.JSONDecodeError) as exc:
        print(f'[FATAL] STEP={step} {type(exc).__name__} （秘密情報は表示しません）',file=sys.stderr)
        return 1

if __name__=='__main__':
    sys.exit(main())
