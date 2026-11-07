#!/usr/bin/env python3
"""Offline decision regression tests for Issue #33 kmac VOICEVOX photo E2E."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

path = Path(__file__).with_name('archive-voice-photo-e2e.py')
spec = importlib.util.spec_from_file_location('stackchan_voice_photo_e2e', path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def status(*, mic=0, asr=0, started=None, phase='idle', saved=False, size=None, stage=None):
    return mod.safe_status({
        'chat': {'enabled':True,'state':'listening',
                 'audio': {'inputEvents':mic,'recognizedEvents':asr}},
        'photo': {'startedAt':started,'phase':phase,'saved':saved,
                  'jpegBytes':size,'errorStage':stage}
    })

class VoicePhotoE2ETests(unittest.TestCase):
    def setUp(self):
        self.before=status(mic=5,asr=2,started=100,phase='complete',saved=True,size=512)
    def test_new_photo(self):
        self.assertEqual(mod.verdict(self.before,status(mic=15,asr=3,started=150,phase='complete',saved=True,size=600))[0],'PASS')
    def test_old_photo_not_false_pass(self):
        self.assertEqual(mod.verdict(self.before,status(mic=15,asr=2,started=100,phase='complete',saved=True,size=600))[0],'NO_ASR')
    def test_no_input(self):
        self.assertEqual(mod.verdict(self.before,status(mic=5,asr=2,started=100))[0],'NO_INPUT')
    def test_input_not_recognized(self):
        self.assertEqual(mod.verdict(self.before,status(mic=15,asr=2,started=100))[0],'NO_ASR')
    def test_asr_without_camera(self):
        self.assertEqual(mod.verdict(self.before,status(mic=15,asr=3,started=100))[0],'NO_PHOTO')
    def test_camera_error(self):
        result,reason=mod.verdict(self.before,status(mic=15,asr=3,started=150,phase='error',stage='camera-start'))
        self.assertEqual(result,'FAIL')
        self.assertIn('camera-start',reason)
    def test_status_does_not_expose_text(self):
        obj=mod.safe_status({'chat': {'enabled':True,'state':'listening','detail':'PRIVATE',
                          'audio': {'recognizedEvents':1,'secret':'PRIVATE'}},
                          'photo':{'phase':'error','image':'PRIVATE'}})
        self.assertNotIn('PRIVATE',str(obj))
    def test_pipeline_epoch_ms_and_secrets(self):
        at = 1794010000000
        item = mod.safe_pipeline({
            'schema': 1,
            'audio': {'input': 'running', 'worker': 'running',
                      'uploadEnabled': True, 'lastInputAt': at,
                      'lastSentAt': at - 150, 'lastASRAt': 0,
                      'lastError': 'none', 'reconnectCount': 12,
                      'rawTranscript': 'PRIVATE'},
            'heap': {'internalFree': 37803, 'key': 'SECRET'}
        })
        self.assertEqual(item['lastInputAt'], at)
        self.assertEqual(item['lastSentAt'], at - 150)
        self.assertEqual(item['reconnectCount'], 12)
        self.assertTrue(item['uploadEnabled'])
        self.assertNotIn('PRIVATE', str(item))
        self.assertNotIn('SECRET', str(item))

    def test_pipeline_rejects_invalid_timestamps(self):
        item = mod.safe_pipeline({
            'schema': 1,
            'audio': {'lastInputAt': -1, 'lastSentAt': True,
                      'lastASRAt': 10**15}
        })
        self.assertIsNone(item['lastInputAt'])
        self.assertIsNone(item['lastSentAt'])
        self.assertIsNone(item['lastASRAt'])

    def test_read_only_lan_retry_then_success(self):
        class Reply:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, size): return b'{"chat":{}}'
        dev = mod.Device('192.168.2.102', 'TOKEN_PRIVATE')
        fake = Mock()
        fake.open.side_effect = [URLError(TimeoutError()), Reply()]
        dev.opener = fake
        with patch.object(mod.time,'sleep') as sleeper:
            result = dev.request('/status')
        self.assertEqual(result, {'chat': {}})
        self.assertEqual(fake.open.call_count, 2)
        sleeper.assert_called_once()

    def test_lan_401_auth_failure_no_retry(self):
        dev = mod.Device('192.168.2.102', 'TOKEN_PRIVATE')
        fake = Mock()
        fake.open.side_effect = HTTPError('http://192.168.2.102:8082/status', 401,
                                          'Unauthorized', {}, None)
        dev.opener = fake
        with patch.object(mod.time,'sleep') as sleeper:
            with self.assertRaises(mod.DeviceConnectionError) as ctx:
                dev.request('/status')
        self.assertIn('401',str(ctx.exception))
        self.assertNotIn('TOKEN_PRIVATE',str(ctx.exception))
        fake.open.assert_called_once()
        sleeper.assert_not_called()

    def test_lan_post_does_not_retry(self):
        dev = mod.Device('192.168.2.102', 'TOKEN_PRIVATE')
        fake = Mock()
        fake.open.side_effect = URLError(ConnectionRefusedError())
        dev.opener = fake
        with patch.object(mod.time,'sleep') as sleeper:
            with self.assertRaises(mod.DeviceConnectionError):
                dev.request('/rpc', {'op':'/chat/start','args':{}})
        fake.open.assert_called_once()
        sleeper.assert_not_called()

    def test_lan_get_retry_exhaustion(self):
        dev = mod.Device('192.168.2.102', 'TOKEN_PRIVATE')
        fake = Mock()
        fake.open.side_effect = URLError(ConnectionRefusedError())
        dev.opener = fake
        with patch.object(mod.time,'sleep') as sleeper:
            with self.assertRaises(mod.DeviceConnectionError) as ctx:
                dev.request('/diagnostics')
        self.assertIn('attempts=4',str(ctx.exception))
        self.assertEqual(fake.open.call_count, 4)
        self.assertEqual(sleeper.call_count, 3)

    def test_private_ipv4_only(self):
        self.assertEqual(mod.device_ip('192.168.2.102'),'192.168.2.102')
        for ip in ('8.8.8.8','127.0.0.1','169.254.4.5'):
            with self.assertRaises(ValueError): mod.device_ip(ip)

if __name__=='__main__':
    unittest.main()
