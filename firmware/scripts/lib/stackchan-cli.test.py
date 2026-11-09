"""Behavioral tests for the unified CLI. No SDK build or hardware access."""
import contextlib
import io
import json
import pathlib
import struct
import tempfile
import types
import unittest
from unittest.mock import patch

script = pathlib.Path(__file__).resolve().parents[1] / 'stackchan.sh'
source = script.read_text().split("<<'PY'\n", 1)[1].rsplit('\nPY\n', 1)[0]
m = types.ModuleType('stackchan_cli')
exec(compile(source, str(script), 'exec'), m.__dict__)

class CLITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.args = types.SimpleNamespace(repo=str(self.root),log_root=str(self.root/'logs'),sha=None,port=None,seconds=1,
                                          test=False,build=False,write=False,logs=False)
        with contextlib.redirect_stdout(io.StringIO()): self.r = m.Runner(self.args)
        self.r.log = lambda *args: None
        self.addCleanup(self.r.console.close)

    def test_all_selects_fixed_order(self):
        calls=[]
        with patch.object(m.Runner,'execute',lambda r:calls.extend(k for k in ('check','test','build','write') if getattr(r.a,k))), \
             patch.object(m.Runner,'cleanup'), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(['--all','--log-root',str(self.root/'modes')]),0)
        self.assertEqual(calls,['check','test','build','write'])

    def test_default_only_checks(self):
        selected=[]
        with patch.object(m.Runner,'execute',lambda r:selected.extend([r.a.check,r.a.test,r.a.build,r.a.write,r.a.logs])), \
             patch.object(m.Runner,'cleanup'), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(['--log-root',str(self.root/'default')]),0)
        self.assertEqual(selected,[True,False,False,False,False])

    def test_build_failure_never_writes(self):
        self.args.test=self.args.build=self.args.write=True
        calls=[]
        self.r.check=lambda:calls.append('check')
        self.r.setup_env=lambda:None
        self.r.test=lambda:calls.append('test')
        def failure(): calls.append('build');raise RuntimeError('injected build failure')
        self.r.build=failure
        self.r.write=lambda:calls.append('write')
        with patch.dict(m.os.environ,{'TMUX':'test'}),self.assertRaisesRegex(RuntimeError,'injected'): self.r.execute()
        self.assertEqual(calls,['check','test','build'])
        self.r.lock.close()

    def test_failure_reports_exit_and_keeps_log(self):
        with self.assertRaisesRegex(RuntimeError,'command failed'):
            self.r.cmd('injected',['python3','-c','import sys;print("diagnostic");sys.exit(7)'])
        self.assertIn('diagnostic',(self.r.run/'injected.log').read_text())

    def test_timeout_stops_child(self):
        with self.assertRaises(m.subprocess.TimeoutExpired):
            self.r.cmd('timeout',['python3','-c','import time;time.sleep(10)'],timeout=.05)
        self.assertIsNone(self.r.child)

    def service(self,state,fail=False):
        calls=[]
        def cmd(name,argv,*args,**kw):
            calls.append(name)
            if name=='hub-state':
                p=self.root/'state';p.write_text(state);return p
            if name=='hub-restore' and fail:raise RuntimeError('restore failed')
        self.r.cmd=cmd;self.r.confirm=lambda _:None
        return calls

    def test_inactive_service_stays_inactive(self):
        calls=self.service('inactive')
        with self.r.own_usb():pass
        self.assertEqual(calls,['hub-state'])

    def test_active_service_restored_after_device_error(self):
        calls=self.service('active')
        with self.assertRaisesRegex(RuntimeError,'device'):
            with self.r.own_usb():raise RuntimeError('device error')
        self.assertEqual(calls,['hub-state','hub-stop','hub-restore'])
        self.assertFalse(self.r.restore_service)

    def test_unknown_service_state_rejects_usb(self):
        calls=self.service('activating')
        with self.assertRaisesRegex(RuntimeError,'not stable'):
            with self.r.own_usb():self.fail('USB operation must not start')
        self.assertEqual(calls,['hub-state'])

    def test_restore_failure_remains_retryable(self):
        self.service('active',fail=True)
        self.r.restore_service=True;self.r.step='flash'
        with self.assertRaisesRegex(RuntimeError,'restore'):self.r.restore_hub()
        self.assertTrue(self.r.restore_service)
        self.assertEqual(self.r.step,'flash')

    def test_identity_change_rejected(self):
        expected=dict(vid=0x303a,pid=0x1001,serial='same',location='1-1',port='/dev/ttyACM0')
        self.r.identity=lambda:dict(expected,location='1-2')
        with self.assertRaisesRegex(RuntimeError,'identity changed'):self.r.same_device(expected)

    def test_port_rename_with_same_identity_accepted(self):
        expected=dict(vid=0x303a,pid=0x1001,serial='same',location='1-1',port='/dev/ttyACM0')
        self.r.identity=lambda:dict(expected,port='/dev/ttyACM1')
        self.assertEqual(self.r.same_device(expected)['port'],'/dev/ttyACM1')

    def test_private_manifest_restored(self):
        p=self.r.fw/'host/app/manifest_archive_private.json';p.parent.mkdir(parents=True)
        p.write_text('generated')
        self.r.manifest_before=b'preserved';self.r.manifest_changed=True
        self.r.cleanup()
        self.assertEqual(p.read_bytes(),b'preserved')

    def test_capture_filters_private_values(self):
        for line in ['SSID=secret','[direct-chat] transcript=secret','password=secret','[main] startup detail: secret']:
            self.assertNotIn('secret',m.safe_line(line) or '')
        self.assertEqual(m.safe_line('[main] startup failed phase=context error=TypeError'),
                         '[main] startup failed phase=context error=TypeError')

    def test_boot_failure_is_not_accepted_as_flash_success(self):
        (self.r.run/'boot-stages.log').write_text('[main] app behaviors ready\n[main] startup failed phase=behavior error=Error\n')
        with self.assertRaisesRegex(RuntimeError,'not verified'):self.r.validate_boot()

    def test_boot_ready_marker_is_required(self):
        (self.r.run/'boot-stages.log').write_text('')
        with self.assertRaisesRegex(RuntimeError,'not verified'):self.r.validate_boot()
        (self.r.run/'boot-stages.log').write_text('[main] app behaviors ready\n')
        self.r.validate_boot()

    def terminal_confirmation(self, answer):
        import builtins, os, pty
        master, slave = pty.openpty()
        self.addCleanup(os.close, master); self.addCleanup(os.close, slave)
        path = os.ttyname(slave)
        original = builtins.open
        def opened(name, mode='r', *args, **kwargs):
            return original(path if name == '/dev/tty' else name, mode, *args, **kwargs)
        os.write(master, answer)
        with patch('builtins.open', opened): self.r.confirm('test confirmation')

    def test_yes_confirmation_on_real_nonseekable_terminal(self):
        self.terminal_confirmation(b'yes\n')
        self.assertEqual(self.r.step,'approval')

    def test_no_confirmation_stops(self):
        with self.assertRaisesRegex(RuntimeError,'cancelled'): self.terminal_confirmation(b'no\n')

    def test_terminal_eof_stops(self):
        with self.assertRaisesRegex(RuntimeError,'cancelled'): self.terminal_confirmation(b'\x04')

    def test_explicit_yes_does_not_open_terminal(self):
        self.args.yes=True
        with patch('builtins.open',side_effect=AssertionError('must not ask')):
            self.r.confirm('flash approval')
        self.assertEqual(self.r.step,'approval')

    def test_yes_flag_is_forwarded_to_runner(self):
        captured=[]
        with patch.object(m.Runner,'execute',lambda r:captured.append(r.a.yes)),patch.object(m.Runner,'cleanup'),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(m.main(['--yes','--check','--log-root',str(self.root/'yes-mode')]),0)
        self.assertEqual(captured,[True])

    def test_missing_usb_is_failure_even_when_hub_result_success(self):
        self.r.identity=lambda:(_ for _ in ()).throw(RuntimeError('USB missing'))
        result=types.SimpleNamespace(returncode=0,stdout='Result=success\nActiveState=inactive\n')
        with patch.object(m.subprocess,'run',return_value=result),self.assertRaisesRegex(RuntimeError,'USB missing'):
            self.r.check_usb()
        self.assertTrue((self.r.run/'usb-kernel.log').exists())

    def test_hub_labels_do_not_imply_usb_success(self):
        lines=[];self.r.log=lambda level,line:lines.append(line)
        self.r.identity=lambda:dict(port='/dev/ttyACM0')
        result=types.SimpleNamespace(returncode=0,stdout='Result=success\nActiveState=inactive\n')
        with patch.object(m.subprocess,'run',return_value=result):self.r.check_usb()
        self.assertIn('HUB.Result=success',lines)
        self.assertNotIn('Result=success',lines)

    def test_unknown_hub_state_is_incomplete_preflight(self):
        self.r.identity=lambda:dict(port='/dev/ttyACM0')
        with patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(returncode=1,stdout='')),self.assertRaisesRegex(RuntimeError,'preflight incomplete'):
            self.r.check_usb()

    def layout(self):
        self.r.bin.mkdir(parents=True)
        p=self.r.fw/'dist/tmp/esp32/m5stackchan_cores3/release/stack-chan-host/xsProj-esp32s3/build/flasher_args.json'
        p.parent.mkdir(parents=True)
        p.write_text(json.dumps(dict(extra_esptool_args=dict(chip='esp32s3'),flash_settings=dict(flash_mode='dio',flash_size='16MB',flash_freq='80m'),flash_files=m.FILES)))
        for name in m.FILES.values():(self.r.bin/name).write_bytes(b'valid')
        (self.r.bin/'partition-table.bin').write_bytes(struct.pack('<HBBII16sI',0x50aa,1,2,0x9000,0x6000,b'nvs',0))

    def test_layout_protects_nvs(self):
        self.layout();self.r.validate_layout()
        (self.r.bin/'bootloader.bin').write_bytes(b'x'*0xa000)
        with self.assertRaisesRegex(RuntimeError,'overlap NVS'):self.r.validate_layout()

    def test_modified_artifact_rejected(self):
        self.layout();self.r.head='a'*40
        self.r.query=lambda argv:'' if 'status' in argv else self.r.head
        self.r.fingerprint=lambda:dict(sha=self.r.head,sdk='sdk',idf='idf',private='config')
        receipt=dict(self.r.fingerprint(),artifacts={v:m.sha(self.r.bin/v) for v in m.FILES.values()})
        self.r.receipt.write_text(json.dumps(receipt))
        self.r.verify_receipt()
        (self.r.bin/'xs_esp32.bin').write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError,'hash mismatch'):self.r.verify_receipt()

    def test_write_requires_tmux_before_usb(self):
        with patch.dict(m.os.environ,{},clear=True),self.assertRaisesRegex(RuntimeError,'tmux'):
            self.r.write()

class PRTest(CLITest):
    # Real local Git merges exercise integration without network/SDK/device access.
    def git(self, *args, cwd=None):
        return m.subprocess.check_output(['git', *args], cwd=cwd or self.r.repo, text=True, stderr=m.subprocess.DEVNULL).strip()

    def init_history(self, conflict=False):
        self.args.pr=90
        self.git('init')
        self.git('config','user.name','Test')
        self.git('config','user.email','test@example.invalid')
        (self.root/'AGENTS.md').write_text('test')
        (self.root/'firmware').mkdir()
        (self.root/'firmware/placeholder').write_text('test')
        (self.root/'shared').write_text('base\n')
        self.git('add','AGENTS.md','firmware/placeholder','shared');self.git('commit','-m','base')
        ancestor=self.git('rev-parse','HEAD')
        (self.root/('shared' if conflict else 'feature')).write_text('feature\n')
        self.git('add','shared' if conflict else 'feature');self.git('commit','-m','feature')
        head=self.git('rev-parse','HEAD')
        self.git('checkout','--detach',ancestor)
        (self.root/('shared' if conflict else 'base-update')).write_text('new base\n')
        self.git('add','shared' if conflict else 'base-update');self.git('commit','-m','base update')
        base=self.git('rev-parse','HEAD')
        return dict(number=90,state='open',baseRef='stackchan-super',baseSHA=base,headSHA=head,headRepo='messpy/stack-chan')

    def prepare(self, info):
        self.r.pr_metadata=lambda:info.copy()
        original=self.r.cmd
        calls=[]
        def cmd(name,argv,*args,**kwargs):
            calls.append(name)
            if name=='pr-fetch':return self.root/'unused'
            return original(name,argv,*args,**kwargs)
        self.r.cmd=cmd
        return calls

    def test_integrates_latest_base_and_pr_without_changing_source(self):
        info=self.init_history();self.prepare(info)
        with patch.object(m,'HOME',self.root/'home'):self.r.prepare_pr()
        self.assertEqual(self.git('rev-parse','HEAD',cwd=self.root),info['baseSHA'])
        self.assertEqual(self.git('status','--porcelain','--untracked-files=no',cwd=self.root),'')
        self.assertTrue((self.r.repo/'feature').exists())
        self.assertTrue((self.r.repo/'base-update').exists())
        expected=self.r.repo
        # A separate --write invocation must reuse the same integration/receipt directory.
        self.r.repo=self.root;self.r.fw=self.root/'firmware'
        with patch.object(m,'HOME',self.root/'home'):self.r.prepare_pr()
        self.assertEqual(self.r.repo,expected)

    def test_conflict_stops_before_worktree_or_tests(self):
        info=self.init_history(conflict=True);calls=self.prepare(info)
        with patch.object(m,'HOME',self.root/'home'),self.assertRaisesRegex(RuntimeError,'pr-merge-tree'):
            self.r.prepare_pr()
        self.assertNotIn('pr-worktree',calls)
        self.assertEqual(self.git('rev-parse','HEAD'),info['baseSHA'])

    def test_moved_pr_rejected_before_write(self):
        self.r.pr_info=dict(headSHA='old',baseSHA='same')
        self.r.pr_metadata=lambda:dict(headSHA='new',baseSHA='same')
        with self.assertRaisesRegex(RuntimeError,'changed'):self.r.check_pr_freshness()

    def test_wrong_base_rejected_before_fetch(self):
        self.args.pr=90
        self.r.pr_metadata=lambda:dict(number=90,state='open',baseRef='main',headRepo='messpy/stack-chan')
        with self.assertRaisesRegex(RuntimeError,'targeting'):self.r.prepare_pr()

    def test_requested_pr_sha_mismatch_rejected(self):
        info=self.init_history();self.prepare(info);self.args.sha='f'*40
        with self.assertRaisesRegex(RuntimeError,'HEAD differs'):self.r.prepare_pr()

if __name__=='__main__':
    suite=unittest.TestSuite()
    suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(CLITest))
    suite.addTests(PRTest(name) for name in PRTest.__dict__ if name.startswith('test_'))
    result=unittest.TextTestRunner().run(suite)
    raise SystemExit(not result.wasSuccessful())
