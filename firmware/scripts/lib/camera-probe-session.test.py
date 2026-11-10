#!/usr/bin/env python3
"""Offline fault injection for durable photo supervision and USB identity."""
import argparse
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

session = load('probe_session', ROOT/'camera-probe-session.py')
# Load protocol functions with a stub serial dependency, no device access.
serial = types.ModuleType('serial')
serial.SerialException = OSError
with patch.dict(sys.modules, serial=serial):
    probe = load('camera_probe', ROOT/'stackchan-camera-probe.py')

class SessionTests(unittest.TestCase):
    def device(self, **kw):
        return dict(vid=0x303a, pid=0x1001, serial='same', location='1-1', device='/dev/ttyACM0', **kw)

    def test_renumbering_preserves_identity(self):
        old=self.device();new={**old,'device':'/dev/ttyACM1'}
        self.assertTrue(session.same_device(old,new))
        for change in ({'serial':'other'}, {'vid':1}, {'pid':1}):
            self.assertFalse(session.same_device(old,{**new,**change}))

    def test_serialless_requires_matching_physical_port(self):
        old={**self.device(),'serial':None}
        self.assertTrue(session.same_device(old,{**old,'device':'/dev/ttyACM2'}))
        self.assertFalse(session.same_device(old,{**old,'location':'1-2'}))
        self.assertFalse(session.same_device({**old,'location':None},{**old,'location':None}))

    def test_failure_creates_private_log_before_usb_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            def failed_discover(_):
                self.assertEqual(len(list(Path(tmp).glob('dist/camera-logs/*.log'))),1)
                raise RuntimeError('USB unavailable')
            with patch.object(session,'FW',Path(tmp)), patch.object(session,'discover',failed_discover), \
                 patch.object(session.subprocess,'run',return_value=types.SimpleNamespace(stdout='abc\n',returncode=0)), \
                 contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(session.launch(argparse.Namespace(port=None)),1)
            log=next(Path(tmp).glob('dist/camera-logs/*.log'))
            self.assertEqual(log.stat().st_mode & 0o777,0o600)
            self.assertIn('FAILED=RuntimeError',log.read_text())
            self.assertIn('GIT_SHA=abc',log.read_text())

    def test_service_restore_only_if_previously_active_and_worker_detaches(self):
        for state in ['active','inactive','failed']:
            commands=[]
            def run(cmd,**kwargs):
                commands.append(cmd)
                return types.SimpleNamespace(stdout='abc\n',returncode=0)
            with tempfile.TemporaryDirectory() as tmp, patch.object(session,'FW',Path(tmp)), \
                 patch.object(session,'discover',return_value=self.device()), \
                 patch.object(session,'service_state',return_value=state), \
                 patch.object(session.subprocess,'run',side_effect=run),contextlib.redirect_stdout(io.StringIO()):
                args=argparse.Namespace(port=None,service='stackchan-hub.service',approved_once=True,allow_ai_on=False)
                self.assertEqual(session.launch(args),0)
                self.assertEqual(session.launch(args),0)
                self.assertEqual(len(list(Path(tmp).glob('dist/camera-logs/*.log'))),2)
            cmd=commands[-1]
            self.assertEqual(cmd[0],'systemd-run')
            self.assertNotIn('--scope',cmd)
            self.assertEqual(any('ExecStopPost=' in c for c in cmd),state=='active')
            self.assertIn('--property=RuntimeMaxSec=150',cmd)

    def test_request_timeout_sends_once_and_records_last_stage(self):
        class Port:
            writes=[]
            def write(self,data):self.writes.append(data)
            def flush(self):pass
            def readline(self,*args):return b'@SC {"event":"debug","lines":["[photo] stage=FRAME_RELEASE_BEGIN"]}\n'
        port=Port();clock=iter([0,0,0,100])
        with patch.object(probe.time,'monotonic',side_effect=lambda:next(clock)),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(TimeoutError,'lastStage=FRAME_RELEASE_BEGIN'):
                probe.request(port,'SECRET',1,'/photo',{},timeout=1)
        self.assertEqual(len(port.writes),1)

    def test_reconnect_uses_diagnostics_only(self):
        class Port:
            def __enter__(self):return self
            def __exit__(self,*args):pass
        with patch.object(probe.session,'discover',return_value=self.device()), \
             patch.object(probe.serial,'Serial',return_value=Port(),create=True), \
             patch.object(probe,'request',return_value={'result':{'usbOperation':{'active':False}}}) as request, \
             contextlib.redirect_stdout(io.StringIO()):
            probe.recover(self.device(),'SECRET',2)
            self.assertEqual(request.call_args.args[3],'/debug/status')
            self.assertEqual(request.call_count,1)

if __name__=='__main__':unittest.main()
