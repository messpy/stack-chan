#!/usr/bin/env python3
"""Offline tests for authenticated StackChan mic loopback (no real network/audio)."""
import importlib.util
import io
import json
from pathlib import Path
import struct
from urllib.error import HTTPError, URLError
import unittest
from unittest.mock import Mock

src=Path(__file__).with_name('kmac-voicevox-mic-check.py')
spec=importlib.util.spec_from_file_location('stackchan_mic_check',src)
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

class Reply:
    status=200
    def __init__(self,raw): self.raw=raw
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def read(self,n): return self.raw

class MicCheckTests(unittest.TestCase):
    def test_valid_media_name_and_rpc(self):
        client=app.Device('192.168.2.102','PRIVATE')
        mock=Mock()
        mock.open.side_effect=[
            Reply(b'{"name":"audio-1794010000000-3.wav","bytes":160044}'),
            Reply(b'RIFF'+b'0'*96),
        ]
        client.opener=mock
        name=client.record()
        self.assertEqual(name,'audio-1794010000000-3.wav')
        self.assertEqual(client.download(name)[:4],b'RIFF')
        self.assertEqual(mock.open.call_count,2)

    def test_reject_unexpected_media_route_and_filename(self):
        client=app.Device('192.168.2.102','PRIVATE')
        with self.assertRaises(ValueError):
            client.request('/media?name=../../private.json')
        with self.assertRaises(ValueError):
            client.download('../../private.json')
        with self.assertRaises(ValueError):
            client.request('/status?token=PRIVATE')

    def test_record_rejects_unexpected_reply(self):
        client=app.Device('192.168.2.102','PRIVATE')
        mock=Mock()
        mock.open.return_value=Reply(b'{"error":"no audio"}')
        client.opener=mock
        with self.assertRaises(ValueError):
            client.record()

    def test_wav_stats_for_silent_pcm(self):
        import wave
        out=io.BytesIO()
        with wave.open(out,'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(b'\x00\x00'*16000)
        summary=app.wav_stats(out.getvalue())
        self.assertEqual(summary['seconds'],1)
        self.assertEqual(summary['rms'],0)
        self.assertIsNone(summary['dbfs'])

    def test_http_503_busy_is_categorized_without_raw_message(self):
        private='camera busy: privateKey=DO-NOT-SHOW'
        err=HTTPError('http://192.168.2.102:8082/rpc',503,
                      'unavailable',{},io.BytesIO(json.dumps({'error':private}).encode()))
        value=app.classify_capture_error(err)
        self.assertEqual(value,'http-503-busy')
        self.assertNotIn('DO-NOT-SHOW',value)

    def test_record_rpc_busy_is_safe(self):
        client=app.Device('192.168.2.102','PRIVATE')
        fake=Mock()
        fake.open.return_value=Reply(b'{"error":"Another capture is in progress"}')
        client.opener=fake
        with self.assertRaises(ValueError) as ctx:
            client.record()
        self.assertEqual(app.classify_capture_error(ctx.exception),'record-rpc-busy')

    def test_transport_failure_category(self):
        self.assertEqual(app.classify_capture_error(URLError('unreachable')),
                         'network-unavailable')

    def test_private_ips(self):
        self.assertEqual(app.private_ip('192.168.2.102'),'192.168.2.102')
        for ip in ('8.8.8.8','127.0.0.1','169.254.1.5'):
            with self.assertRaises(ValueError): app.private_ip(ip)

if __name__=='__main__':
    unittest.main()
