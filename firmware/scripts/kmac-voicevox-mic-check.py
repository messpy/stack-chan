#!/usr/bin/env python3
"""Play an existing VOICEVOX WAV while StackChan records 5 seconds of its microphone.

Requires explicit yes: /audio writes a WAV to the StackChan SD card and briefly
pauses AI chat. Downloads only the new recorded WAV over authenticated LAN;
never sends credentials to public hosts, never flashes or modifies firmware.
"""
from __future__ import annotations
import argparse
from array import array
import io
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
import wave
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

DEFAULT_FW = Path('/mnt/data/Development/stackchan/stack-chan-pr55-acceptance/firmware')
DEFAULT_VOICE = Path('/home/kmac/work/camera-voicevox/audio')

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError('Redirect refused')

def private_ip(ip):
    value = ipaddress.IPv4Address(ip)
    if not any(value in ipaddress.IPv4Network(network) for network in
               ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16')):
        raise ValueError('RFC1918 private IP required')
    return str(value)

def latest_voice(folder):
    wavs = [item for item in folder.glob('*.wav') if item.is_file() and not item.is_symlink()]
    if not wavs:
        raise ValueError('No saved VOICEVOX WAV found')
    return max(wavs, key=lambda item: item.stat().st_mtime_ns)

def wav_stats(content):
    with wave.open(io.BytesIO(content), 'rb') as reader:
        channels, sample_width, rate, frames = (reader.getnchannels(),
            reader.getsampwidth(),reader.getframerate(),reader.getnframes())
        if channels not in (1,2) or sample_width != 2 or frames<=0 or rate<=0:
            raise ValueError('Unsupported or empty microphone WAV')
        pcm = reader.readframes(frames)
    samples=array('h')
    samples.frombytes(pcm)
    if sys.byteorder != 'little':
        samples.byteswap()
    count=len(samples)
    energy=sum(int(s)*int(s) for s in samples)
    peak=max((abs(s) for s in samples),default=0)
    rms=math.sqrt(energy/count) if count else 0.0
    dbfs=20*math.log10(rms/32768) if rms else None
    return {'seconds':round(frames/rate,2),'rate':rate,'channels':channels,
            'peak':peak,'rms':round(rms,1),
            'dbfs':round(dbfs,1) if dbfs is not None else None}

class Device:
    def __init__(self, ip, token):
        self.base='http://'+private_ip(ip)+':8082'
        self.token=token
        self.opener=build_opener(ProxyHandler({}),NoRedirect())
    def request(self, path, data=None, max_bytes=65536):
        if path not in ('/status','/rpc') and not re.fullmatch(r'/media\\?name=audio-[0-9]+-[0-9]+\\.wav',path):
            raise ValueError('Invalid device endpoint')
        body=None if data is None else json.dumps(data,separators=(',',':')).encode()
        req=Request(self.base+path,data=body,method='POST' if body is not None else 'GET',
            headers={'Authorization':'Bearer '+self.token,
                     **({'Content-Type':'application/json'} if body is not None else {})})
        with self.opener.open(req,timeout=12) as response:
            if response.status!=200:
                raise ValueError('Device returned non-200')
            raw=response.read(max_bytes+1)
        if len(raw)>max_bytes:
            raise ValueError('Device response too large')
        return raw
    def status(self):
        raw=json.loads(self.request('/status'))
        if not isinstance(raw,dict) or 'error' in raw:
            raise ValueError('Invalid status reply')
        c=raw.get('chat') if isinstance(raw.get('chat'),dict) else {}
        return {'enabled':c.get('enabled') is True,'state':str(c.get('state','unknown'))[:30]}
    def record(self):
        raw=json.loads(self.request('/rpc',{'op':'/audio','args':{}}))
        if not isinstance(raw,dict) or 'error' in raw:
            raise ValueError('Device could not record microphone')
        name=raw.get('name')
        if not isinstance(name,str) or not re.fullmatch(r'audio-[0-9]+-[0-9]+\\.wav',name):
            raise ValueError('Invalid microphone recording filename')
        return name
    def download(self,name):
        if not re.fullmatch(r'audio-[0-9]+-[0-9]+\\.wav',name):
            raise ValueError('Invalid recording name')
        return self.request('/media?name='+quote(name),max_bytes=2*1024*1024)

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ip',default='192.168.2.102')
    parser.add_argument('--firmware',type=Path,default=DEFAULT_FW)
    parser.add_argument('--config',type=Path)
    parser.add_argument('--wav',type=Path,help='VOICEVOX WAV to play; default newest generated WAV')
    parser.add_argument('--voice-dir',type=Path,default=DEFAULT_VOICE)
    parser.add_argument('--alsa-device',default='plughw:1,0')
    parser.add_argument('--output-dir',type=Path,default=Path.home()/'stackchan-mic-captures')
    args=parser.parse_args(argv)
    step='PREFLIGHT'
    try:
        private_ip(args.ip)
        config=args.config or args.firmware/'host/app/manifest_archive_private.json'
        token=json.loads(config.read_text(encoding='utf-8')).get('config',{}).get('archiveToken')
        if not isinstance(token,str) or len(token)<16:
            raise ValueError('Private Archive token unavailable')
        wav=args.wav or latest_voice(args.voice_dir)
        with wav.open('rb') as f:
            if f.read(4)!=b'RIFF': raise ValueError('VOICEVOX source is not WAV')
        if not shutil.which('aplay'): raise ValueError('aplay missing')
        device=Device(args.ip,token)
        state=device.status()
        print('[CHECK] LAN status='+state['state']+' ai='+str(state['enabled']),flush=True)
        if not sys.stdin.isatty():
            raise ValueError('Terminal required for recording approval')
        print('[WARN] This records 5 seconds to the StackChan SD card and briefly pauses AI chat.',flush=True)
        if input('[ACTION] Record StackChan microphone and play VOICEVOX? (yes/no): ').strip()!='yes':
            print('[INFO] Cancelled',flush=True)
            return 2
        # The recording HTTP call blocks for approximately 5 s. Launch it
        # first, then play an already-synthesized WAV to avoid TTS latency.
        step='CAPTURE'
        result={}
        def capture():
            try: result['name']=device.record()
            except Exception as exc: result['error']=type(exc).__name__
        thread=threading.Thread(target=capture,daemon=True)
        thread.start()
        time.sleep(0.9)
        print('[ACTION] Playing VOICEVOX via ALSA',flush=True)
        play=subprocess.run(['aplay','-D',args.alsa_device,str(wav)],
                            stdin=subprocess.DEVNULL,timeout=12,check=False)
        if play.returncode:
            print('[WARN] PC ALSA playback failed exit='+str(play.returncode),flush=True)
        thread.join(timeout=13)
        if thread.is_alive():
            raise TimeoutError('StackChan record response timeout')
        if 'name' not in result:
            raise ValueError('StackChan recording failed ('+str(result.get('error','unknown'))+')')
        step='DOWNLOAD'
        data=device.download(result['name'])
        if not data.startswith(b'RIFF'):
            raise ValueError('Recorded file is not WAV')
        stats=wav_stats(data)
        args.output_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
        save=args.output_dir/result['name']
        fd=os.open(str(save),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as target: target.write(data)
        print('[CHECK] StackChan microphone recording: '+json.dumps(stats,ensure_ascii=False),flush=True)
        print('[INFO] PC copy='+str(save)+' (0600; may include private room audio)',flush=True)
        after=device.status()
        print('[CHECK] Chat after recording state='+after['state']+' ai='+str(after['enabled']),flush=True)
        print('[ACTION] Replay what StackChan microphone actually captured',flush=True)
        replay=subprocess.run(['aplay','-D',args.alsa_device,str(save)],
                              stdin=subprocess.DEVNULL,timeout=15,check=False)
        if replay.returncode:
            print('[WARN] Recorded WAV playback exit='+str(replay.returncode),flush=True)
        print('[INFO] Judge whether VOICEVOX was audible in the recorded WAV.',flush=True)
        return 0 if play.returncode==0 and replay.returncode==0 else 2
    except (OSError,ValueError,HTTPError,URLError,TimeoutError,subprocess.TimeoutExpired,
            json.JSONDecodeError,wave.Error) as exc:
        print('[FATAL] STEP='+step+' '+type(exc).__name__+' (no credentials printed)',file=sys.stderr)
        return 1

if __name__=='__main__':
    sys.exit(main())
