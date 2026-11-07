#!/usr/bin/env python3
"""Offline decision regression tests for Issue #33 kmac VOICEVOX photo E2E."""
import importlib.util
from pathlib import Path
import unittest

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
    def test_private_ipv4_only(self):
        self.assertEqual(mod.device_ip('192.168.2.102'),'192.168.2.102')
        for ip in ('8.8.8.8','127.0.0.1','169.254.4.5'):
            with self.assertRaises(ValueError): mod.device_ip(ip)

if __name__=='__main__':
    unittest.main()
