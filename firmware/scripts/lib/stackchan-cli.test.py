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

    def kernel_filter(self, tool, text='usb connected\nordinary event\n', journal_rc=0, search_rc=None):
        # Execute the actual nested bash with an isolated PATH, not an outer-shell function.
        import os, shutil
        bindir=self.root/'bin';bindir.mkdir(exist_ok=True)
        journal=bindir/'journalctl'
        journal.write_text('#!/bin/sh\nprintf %s '+m.shlex.quote(text)+'\nexit '+str(journal_rc)+'\n')
        journal.chmod(0o700)
        if tool == 'rg-fixture':
            # Test the rg branch's shell/exit-code contract without requiring
            # optional ripgrep on the host. This is not a real-rg integration.
            executable=shutil.which('grep')
            self.assertIsNotNone(executable,'grep is required on this Linux host')
            fake=bindir/'rg'
            fake.write_text('#!/bin/sh\nexec '+m.shlex.quote(executable)+' -E "$@"\n')
            fake.chmod(0o700)
        elif tool:
            if search_rc is None:
                executable=shutil.which(tool)
                self.assertIsNotNone(executable,tool+' is required for this regression test')
                (bindir/tool).symlink_to(executable)
            else:
                fake=bindir/tool;fake.write_text('#!/bin/sh\nwhile IFS= read -r line; do :; done\nexit '+str(search_rc)+'\n');fake.chmod(0o700)
        return m.subprocess.run(['/bin/bash','-c',m.KERNEL_USB_SOURCE],env={**os.environ,'PATH':str(bindir)},text=True,capture_output=True)

    def test_kernel_filter_rg_and_grep_match(self):
        for tool in ('rg-fixture','grep'):
            with self.subTest(tool=tool):
                self.setUpFilterDir()
                result=self.kernel_filter(tool,'ordinary event\nUSB connected\ncdc_acm ttyACM0\n')
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertEqual(result.stdout,'USB connected\ncdc_acm ttyACM0\n')

    def setUpFilterDir(self):
        import shutil
        shutil.rmtree(self.root/'bin',ignore_errors=True)

    def test_kernel_filter_no_matches_is_success(self):
        for tool in ('rg-fixture','grep'):
            with self.subTest(tool=tool):
                self.setUpFilterDir();result=self.kernel_filter(tool,'ordinary event\n')
                self.assertEqual(result.returncode,0,result.stderr)
                self.assertIn('No matching',result.stdout)

    def test_kernel_journal_error_is_not_hidden_by_search(self):
        for tool in ('rg-fixture','grep'):
            for text in ('usb partial\n','ordinary event\n'):
                with self.subTest(tool=tool,text=text):
                    self.setUpFilterDir();result=self.kernel_filter(tool,text,journal_rc=7)
                    self.assertEqual(result.returncode,7);self.assertIn('journalctl failed',result.stderr)

    def test_optional_real_ripgrep_integration(self):
        import shutil
        if not shutil.which('rg'):
            self.skipTest('optional real-ripgrep integration: rg not installed; portable shell and grep tests still run')
        result=self.kernel_filter('rg','ordinary event\nUSB connected\n')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout,'USB connected\n')

    def test_kernel_filter_error_and_missing_tools_are_failures(self):
        for tool in ('rg','grep'):
            with self.subTest(tool=tool):
                self.setUpFilterDir();result=self.kernel_filter(tool,search_rc=2)
                self.assertEqual(result.returncode,2);self.assertIn('search failed',result.stderr)
        self.setUpFilterDir();result=self.kernel_filter(None)
        self.assertEqual(result.returncode,127);self.assertIn('Neither rg nor grep',result.stderr)

    def test_empty_kernel_search_continues_to_capture(self):
        import os
        self.kernel_filter('grep','ordinary event\n')
        (self.root/'bin/bash').symlink_to('/bin/bash')
        self.r.env={**os.environ,'PATH':str(self.root/'bin')}
        with patch.object(self.r,'confirm'), patch.object(self.r,'identity',return_value={'port':'fake'}), \
             patch.object(self.r,'own_usb',return_value=contextlib.nullcontext()), patch.object(self.r,'unoccupied'), \
             patch.object(self.r,'capture') as capture:
            self.r.logs()
        capture.assert_called_once_with({'port':'fake'})
        self.assertIn('No matching',(self.r.run/'kernel-usb.log').read_text())

    def test_kernel_execution_error_stops_before_usb_access(self):
        import os
        self.kernel_filter('grep',journal_rc=7)
        (self.root/'bin/bash').symlink_to('/bin/bash')
        self.r.env={**os.environ,'PATH':str(self.root/'bin')}
        with patch.object(self.r,'identity') as identity, patch.object(self.r,'capture') as capture:
            with self.assertRaisesRegex(RuntimeError,'kernel-usb'):self.r.logs()
        identity.assert_not_called();capture.assert_not_called()

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

    def flash_history(self, name, record=None, success=True, attempt=True):
        run=self.r.run.parent/name;run.mkdir()
        text='[CHECK] HOST=test SHA='+('a'*40)+' REPO='+str(self.root/'missing')+'\n'
        if success:text+='[INFO] PASS STEP=flash LOG='+str(run/'flash.log')+'\n'
        (run/'console.log').write_text(text)
        if attempt:(run/'flash.command.txt').write_text('esptool write-flash\n')
        if record is not None:(run/'flash-record.json').write_text(json.dumps(record))
        return run

    def test_last_flash_ignores_later_failed_test_and_preserves_branch_snapshot(self):
        record=dict(sha='a'*40,branch='original-branch',serial=m.SERIAL,firmware_sha256='b'*64,boot='startup-confirmed')
        self.flash_history('run-20260101-010000-success',record)
        self.flash_history('run-20260102-010000-test-failed',success=False,attempt=False)
        self.assertEqual(self.r.report_last_flash(),record)

    def test_unfinished_flash_warns_that_last_success_is_not_current_device_proof(self):
        record=dict(sha='a'*40,branch='original',firmware_sha256='b'*64)
        self.flash_history('run-20260101-010000-success',record)
        self.flash_history('run-20260102-010000-interrupted',success=False)
        output=[];self.r.log=lambda level,line:output.append((level,line))
        self.assertEqual(self.r.report_last_flash(),record)
        self.assertTrue(any(level=='WARN' and '実機内容は不明' in line for level,line in output))

    def test_missing_and_malformed_records_do_not_invent_a_firmware_hash(self):
        self.assertIsNone(self.r.report_last_flash())
        self.flash_history('run-20260101-010000-old-success')
        record=self.r.report_last_flash()
        self.assertEqual(record['sha'],'a'*40)
        self.assertEqual(record['branch'],'unknown')
        self.assertEqual(record['firmware_sha256'],'unknown')

    def test_flash_record_atomic_update_keeps_flash_success_separate_from_boot(self):
        record=dict(sha='a'*40,branch='reviewed',firmware_sha256='b'*64,boot='not-verified')
        self.r.save_flash_record(record)
        self.assertEqual(json.loads((self.r.run/'flash-record.json').read_text()),record)
        record['boot']='startup-confirmed';self.r.save_flash_record(record)
        self.assertEqual(json.loads((self.r.run/'flash-record.json').read_text())['boot'],'startup-confirmed')
        self.assertFalse((self.r.run/'flash-record.tmp').exists())

    def test_flash_snapshot_keeps_exact_source_and_app_hash_without_secrets(self):
        self.r.head='a'*40;self.r.receipt.parent.mkdir(parents=True)
        self.r.receipt.write_text(json.dumps(dict(artifacts={'xs_esp32.bin':'b'*64},private='PRIVATE_FINGERPRINT')))
        self.r.query=lambda argv:'reviewed-branch'
        record=self.r.flash_record_snapshot({'serial':m.SERIAL})
        self.assertEqual(record['sha'],self.r.head)
        self.assertEqual(record['branch'],'reviewed-branch')
        self.assertEqual(record['firmware_sha256'],'b'*64)
        self.assertEqual(record['boot'],'not-verified')
        self.assertNotIn('PRIVATE_FINGERPRINT',json.dumps(record))

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
            return original(os.dup(slave) if name == '/dev/tty' else name, mode, *args, **kwargs)
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

    def test_usb_reset_only_changes_initial_connection_command(self):
        self.args.reset='usb'
        base=['python','-m','esptool','--before','no-reset','--after','no-reset','--connect-attempts','1']
        connect=self.r.connection_command(base)
        self.assertEqual(connect[connect.index('--before')+1],'usb-reset')
        self.assertEqual(base[base.index('--before')+1],'no-reset')
        self.assertEqual(connect[connect.index('--after')+1],'no-reset')
        self.assertEqual(connect[connect.index('--connect-attempts')+1],'1')

    def test_manual_mode_does_not_toggle_reset(self):
        self.args.reset='manual'
        base=['esptool','--before','no-reset','--after','no-reset']
        self.assertEqual(self.r.connection_command(base),base)

    def test_structured_startup_packets_are_decoded_without_private_text(self):
        packet=dict(event='startup',phase='context',error='TypeError',reason='memory',site='compose.js:123',
                    sequence=2,stage=3,previousValid=1,previousSequence=1,previousStage=2,previousError=0,resetReason=1,
                    internalFree=100,internalLargest=80,psramFree=200,message='secret-password')
        result=m.safe_line('@SC '+json.dumps(packet))
        self.assertIn('[main] startup failed phase=context error=TypeError',result)
        self.assertIn('previousStage=2',result)
        self.assertNotIn('secret-password',result)
        packet.update(phase='ready',error='none',reason='none',site='')
        self.assertIn('[main] app behaviors ready',m.safe_line('@SC '+json.dumps(packet)))
        packet['phase']='secret-password'
        self.assertIsNone(m.safe_line('@SC '+json.dumps(packet)))

    def fake_usb_root(self, kind='hotplug'):
        root=self.root/'sysfs';port=root/'usb1/1-0:1.0/usb1-port1';port.mkdir(parents=True)
        (port/'connect_type').write_text(kind);(port/'disable').write_text('0')
        original=pathlib.Path
        def path(value,*args):
            return root if str(value)=='/sys/bus/usb/devices' else original(value,*args)
        return root,port,path

    def test_recovery_refuses_internal_port(self):
        self.args.usb_path='1-1';root,port,path=self.fake_usb_root('hardwired')
        with patch.object(m.pathlib,'Path',side_effect=path),self.assertRaisesRegex(RuntimeError,'internal'):
            self.r.recovery_port()
        self.assertEqual((port/'disable').read_text(),'0')

    def test_recovery_refuses_other_device(self):
        self.args.usb_path='1-1';root,port,path=self.fake_usb_root()
        d=root/'1-1';d.mkdir()
        for k,v in dict(idVendor='05ac',idProduct='0291',serial='keyboard').items():(d/k).write_text(v)
        with patch.object(m.pathlib,'Path',side_effect=path),self.assertRaisesRegex(RuntimeError,'another device'):
            self.r.recovery_port()

    def test_recovery_stops_before_service_change_if_privilege_denied(self):
        calls=[];self.r.recovery_port=lambda:('1','1');self.r.confirm=lambda _:None
        def command(name,*args,**kwargs):calls.append(name);raise RuntimeError('sudo denied')
        self.r.cmd=command
        with self.assertRaisesRegex(RuntimeError,'sudo denied'):self.r.recover_usb()
        self.assertEqual(calls,['recovery-privilege'])

    def test_recovery_reenables_port_after_interruption(self):
        import sys,time,signal
        root,port,path=self.fake_usb_root()
        with patch.object(m.pathlib,'Path',side_effect=path),patch.object(sys,'argv',['helper','1','1',m.SERIAL]), \
             patch.object(time,'sleep',side_effect=KeyboardInterrupt),patch.object(signal,'signal'),self.assertRaises(KeyboardInterrupt):
            exec(m.USB_RECOVERY_SOURCE,{'__name__':'test'})
        self.assertEqual((port/'disable').read_text().strip(),'0')

    def test_cli_only_commit_reuses_identical_firmware_inputs(self):
        self.layout();self.r.head='b'*40
        self.r.query=lambda argv:'' if 'status' in argv else self.r.head
        self.r.fingerprint=lambda:dict(sha=self.r.head,sdk='sdk',idf='idf',private='config')
        self.r.firmware_identity=lambda ref:'same firmware'
        receipt=dict(self.r.fingerprint(),sha='a'*40,artifacts={v:m.sha(self.r.bin/v) for v in m.FILES.values()})
        self.r.receipt.write_text(json.dumps(receipt));self.r.verify_receipt()
        self.r.firmware_identity=lambda ref:ref
        with self.assertRaisesRegex(RuntimeError,'source/SDK'):self.r.verify_receipt()

    def test_cli_only_commit_cannot_bypass_sdk_change(self):
        self.layout();self.r.head='b'*40;self.r.query=lambda argv:'' if 'status' in argv else self.r.head
        self.r.fingerprint=lambda:dict(sha=self.r.head,sdk='new SDK',idf='idf',private='config')
        self.r.firmware_identity=lambda ref:'same firmware'
        self.r.receipt.write_text(json.dumps(dict(sha='a'*40,sdk='old SDK',idf='idf',private='config')))
        with self.assertRaisesRegex(RuntimeError,'source/SDK'):self.r.verify_receipt()

    def test_sudo_keeps_login_session_but_has_own_killable_process_group(self):
        import os
        executable=self.root/'sudo'
        executable.write_text('#!/usr/bin/python3\nimport os,json\nprint(json.dumps(dict(sid=os.getsid(0),pgid=os.getpgrp())))\n')
        executable.chmod(0o700)
        log=self.r.cmd('sudo-session',[executable])
        result=json.loads(log.read_text())
        self.assertEqual(result['sid'],os.getsid(0))
        self.assertNotEqual(result['pgid'],os.getpgrp())
        # The former implementation creates a different login session and loses tty-scoped sudo cache.
        previous=m.subprocess.check_output([str(executable)],start_new_session=True,text=True)
        self.assertNotEqual(json.loads(previous)['sid'],os.getsid(0))

    def test_startup_component_packet_preserves_frozen_failure_memory(self):
        packet=dict(event='startup',phase='context',error='Error',reason='memory',site='',component='imu',componentState='failed',
                    sequence=2,stage=3,previousValid=1,previousSequence=1,previousStage=2,previousError=0,resetReason=1,
                    internalFree=100,internalLargest=80,psramFree=200,componentCode=9,previousComponent=4)
        line=m.safe_line('@SC '+json.dumps(packet))
        self.assertIn('component=imu state=failed',line);self.assertIn('previousComponent=4',line)
        packet['component']='private-token'
        self.assertIsNone(m.safe_line('@SC '+json.dumps(packet)))

    def test_behavior_components_and_xs_extensionless_sites(self):
        for component in ('dock-context','experimental-miniapps','context-behaviors','archive-import','archive-start','mod-shortcut','archive-offline','default-setup'):
            packet=dict(event='startup',phase='behavior',error='ReferenceError',reason='unclassified',site='lan-archive:219',component=component,componentState='failed',
                        sequence=2,stage=4,previousValid=1,previousSequence=1,previousStage=4,previousError=4,resetReason=1,
                        internalFree=165543,internalLargest=90112,psramFree=6864956)
            line=m.safe_line('@SC '+json.dumps(packet))
            self.assertIsNotNone(line);self.assertIn('component='+component,line);self.assertIn('site=lan-archive:219',line)
            packet['site']='https://private-host/token'
            self.assertIsNone(m.safe_line('@SC '+json.dumps(packet)))

    def test_network_boot_evidence_and_private_field_rejection(self):
        packet=dict(event='startup',phase='ready',error='none',reason='none',site='',sequence=3,stage=5,
                    previousValid=1,previousSequence=2,previousStage=4,previousError=4,resetReason=11,
                    internalFree=143123,internalLargest=69632,psramFree=6697308)
        for status,offline,reason in [('connected','not-selected','connected'),('skipped','selected','offline-selected'),
                                     ('skipped','not-selected','usb-only'),('failed','not-selected','timeout'),('skipped','automatic','automatic-offline')]:
            packet.update(bootNetwork=status,bootOffline=offline,bootNetworkReason=reason,ssid='secret-ssid',password='secret-password')
            line=m.safe_line('@SC '+json.dumps(packet))
            self.assertIn('bootNetwork='+status,line);self.assertIn('bootOffline='+offline,line)
            self.assertIn('bootNetworkReason='+reason,line);self.assertNotIn('secret-',line)
        for key in ('bootNetwork','bootOffline','bootNetworkReason'):
            bad=dict(packet);bad[key]='secret-password'
            self.assertIsNone(m.safe_line('@SC '+json.dumps(bad)))

    def audio_filter(self):
        import re
        ns={'re':re};exec(m.AUDIO_SAFE_SOURCE,ns);return ns

    def test_audio_filter_omits_content_and_reassembles_only_bounded_scalar_lines(self):
        ns=self.audio_filter();safe=ns['safe_audio_line']
        good='[audio-state] event=tts-start ms=123 session=2 turn=2 drainTurn=1 state=6 previousState=6 pending=0'
        self.assertEqual(safe(good),good)
        for bad in (good+' token=SECRET',good.replace('state=6','state=SECRET'),
                    '[asr] input=SECRET conversation','[llm] text=SECRET',good+' event=SECRET'):
            self.assertIsNone(safe(bad))
        collect=ns['audio_packet_lines']
        lines,partial=collect({'event':'debug','lines':[good[:30]]},'');self.assertEqual(lines,[])
        lines,partial=collect({'event':'debug','lines':[good[30:]+'\n[asr] SECRET\n']},partial)
        self.assertEqual(lines,[good]);self.assertEqual(partial,'')
        lines,partial=collect({'event':'debug','lines':['SECRET'*1000]},'')
        self.assertEqual(partial,'');self.assertNotIn('SECRET',''.join(lines))
        self.assertIsNotNone(safe('[opus] packets=4 pcm=1920B encode_avg=2us load=0.2%'))
        self.assertIsNotNone(safe('[playback] native queue starvation count=2'))
        self.assertIsNotNone(safe('[heap] internalFree=123 internalLargest=64 psramFree=456'))
        self.assertIsNone(safe('[heap] internalFree=SECRET'))

    def test_transcript_final_counts_are_kept_but_content_is_rejected(self):
        safe=self.audio_filter()["safe_audio_line"]
        for line in ("[asr] final chars=12","[llm] output_final chars=34"):
            self.assertEqual(safe(line),line)
            self.assertIsNone(safe(line+" text=SECRET"))
        self.assertIsNone(safe("[asr] final chars=SECRET"))

    def test_audio_path_counts_require_known_stages_and_numeric_complete_fields(self):
        safe=self.audio_filter()['safe_audio_line']
        lines=('[audio-path] stage=decode ms=1 turn=2 fragments=3 skipped=0 decoded=3 failures=0 pcmBytes=2880',
               '[audio-path] stage=output ms=1 turn=2 submittedBytes=2880 completedBytes=2880 completedChunks=1 failures=0 pending=0 completed=1 volume=400')
        for line in lines:
            self.assertEqual(safe(line),line)
            self.assertIsNone(safe(line+' text=SECRET'))
            self.assertIsNone(safe(line.replace('ms=1','ms=SECRET')))
            self.assertIsNone(safe(line.replace('stage=','stage=unknown')))

    def run_audio_capture(self, mode='normal'):
        import sys
        clock=[0.0];requests=[];frames=[];opens=[]
        class SerialError(Exception):pass
        class SerialTimeoutException(SerialError):pass
        fake_time=types.ModuleType('time')
        def monotonic():clock[0]+=.05;return clock[0]
        fake_time.monotonic=monotonic;fake_time.sleep=lambda n:clock.__setitem__(0,clock[0]+n)
        fake_time.strftime=lambda _:'2000-01-01T00:00:00+0000'
        class Serial:
            def __init__(self,**kwargs):self.dtr=True;self.rts=True;self.port=None;self.kwargs=kwargs
            def __enter__(serial):
                if mode=='open-error':raise OSError(71,'SECRET open error')
                self.assertEqual(serial.dtr,mode=='dtr-on');self.assertFalse(serial.rts);self.assertTrue(serial.kwargs['exclusive'])
                opens.append(serial.port);return serial
            def __exit__(self,*args):pass
            def write(serial,raw):
                if mode=='write-error':raise OSError(110,'SECRET write error')
                if mode=='write-timeout':raise SerialTimeoutException('SECRET write timeout')
                request=json.loads(raw.decode()[4:]);requests.append(request)
                if mode=='timeout':return len(raw)
                packet={'id':request['id'],'result':{'queued':1,'dropped':0,'truncated':0,'usbRetries':0,'SECRET':'not logged'}}
                if mode=='reject':packet={'id':request['id'],'error':'SECRET response'}
                frames.append(('@SC '+json.dumps(packet)+'\n').encode())
                frames.append(('@SC '+json.dumps({'event':'debug','lines':['[audio-state] event=tts-start ms=1 session=1 state=6\n[llm] SECRET conversation\n']})+'\n').encode())
                return len(raw)
            def readline(serial,_size):
                if mode=='read-error':raise OSError(5,'SECRET read error')
                return frames.pop(0) if frames else b''
        serial=types.ModuleType('serial');serial.Serial=Serial;serial.SerialException=SerialError
        tools=types.ModuleType('serial.tools');ports=types.ModuleType('serial.tools.list_ports')
        device=types.SimpleNamespace(vid=0x303a,pid=0x1001,serial_number='test-device',location='1-1',device='verified-port')
        ports.comports=lambda:[device] if mode!='mismatch' else [types.SimpleNamespace(**{**device.__dict__,'serial_number':'other-device'})]
        tools.list_ports=ports;serial.tools=tools
        config=self.root/'capture-config.json';config.write_text(json.dumps({'config':{'archiveToken':'SECRET_TOKEN'}}))
        expected=dict(vid=device.vid,pid=device.pid,serial=device.serial_number,location=device.location)
        argv=['helper',json.dumps(expected),'10' if mode=='timeout' else '3',str(config),m.AUDIO_SAFE_SOURCE,'on' if mode=='dtr-on' else 'off']
        out=io.StringIO();failure=None
        with patch.dict(sys.modules,{'serial':serial,'serial.tools':tools,'serial.tools.list_ports':ports,'time':fake_time}), \
             patch.object(sys,'argv',argv),contextlib.redirect_stdout(out):
            try:exec(compile(m.AUDIO_CAPTURE_SOURCE,'audio-capture','exec'),{})
            except SystemExit as error:failure=error.code
        return requests,opens,out.getvalue(),failure

    def test_audio_capture_uses_only_authenticated_debug_status_and_never_saves_secrets(self):
        requests,opens,output,failure=self.run_audio_capture()
        self.assertIsNone(failure);self.assertEqual(opens,['verified-port']);self.assertTrue(requests)
        self.assertTrue(all(r['op']=='/debug/status' and r['args']=={} for r in requests))
        self.assertNotIn('SECRET',output);self.assertIn('event=tts-start',output)
        self.assertIn('[audio-status]',output)

    def test_audio_capture_refuses_other_device_and_bounds_unresponsive_vm(self):
        requests,opens,output,failure=self.run_audio_capture('mismatch')
        self.assertFalse(requests);self.assertFalse(opens);self.assertIsNotNone(failure)
        requests,opens,output,failure=self.run_audio_capture('timeout')
        self.assertEqual(len(requests),1);self.assertEqual(failure,1);self.assertIn('timed out',output)
        requests,opens,output,failure=self.run_audio_capture('reject')
        self.assertIsNotNone(failure);self.assertNotIn('SECRET',str(failure)+output)

    def test_audio_io_errors_are_not_mislabeled_disconnect_or_reopened(self):
        for stage,number in (('open',71),('write',110),('read',5)):
            with self.subTest(stage=stage):
                requests,opens,output,failure=self.run_audio_capture(stage+'-error')
                self.assertIsNotNone(failure);self.assertIn('remains enumerated',str(failure))
                kind='TimeoutError' if number==110 else 'OSError'
                self.assertIn('stage='+stage+' type='+kind+' errno='+str(number),output)
                self.assertNotIn('USB disconnected',output);self.assertNotIn('SECRET',output+str(failure))
                self.assertLessEqual(len(opens),1);self.assertLessEqual(len(requests),1)

    def test_audio_write_timeout_is_reported_without_replay_or_private_message(self):
        requests,opens,output,failure=self.run_audio_capture('write-timeout')
        self.assertIsNotNone(failure);self.assertEqual(len(opens),1);self.assertFalse(requests)
        self.assertIn('stage=write type=SerialTimeoutException errno=0',output)
        self.assertNotIn('SECRET',output+str(failure))

    def test_explicit_hub_dtr_profile_is_set_before_open_without_rts_pulse(self):
        requests,opens,output,failure=self.run_audio_capture('dtr-on')
        self.assertIsNone(failure);self.assertEqual(opens,['verified-port'])
        self.assertIn('dtr=on rts=off',output)
        self.assertTrue(all(r['op']=='/debug/status' for r in requests))
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):m.main(['--dtr','on'])

    def test_audio_logs_mode_preserves_identity_and_service_ownership(self):
        self.args.audio=True;calls=[]
        self.r.cmd=lambda name,*a,**k:calls.append(name)
        self.r.confirm=lambda *a:None
        self.r.identity=lambda:(calls.append('identity') or {'port':'verified'})
        @contextlib.contextmanager
        def own():
            calls.append('own');yield;calls.append('restore')
        self.r.own_usb=own;self.r.unoccupied=lambda _:calls.append('unoccupied')
        self.r.capture_audio=lambda _:calls.append('audio');self.r.capture=lambda _:calls.append('boot')
        self.r.logs()
        self.assertEqual(calls,['kernel-usb','identity','own','unoccupied','audio','restore'])

    def test_audio_flag_cannot_trigger_write_or_usb_recovery(self):
        for args in (['--audio'],['--audio','--logs','--write'],['--audio','--logs','--all'],
                     ['--audio','--logs','--recover-usb','--usb-path','1-1']):
            with self.subTest(args=args),contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):m.main(args)

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

    def test_selected_worktree_cli_suite_is_used(self):
        calls = []
        self.r.cmd = lambda name, argv, *args, **kwargs: calls.append((name, argv))
        self.r.test()
        self.assertEqual(calls[0][0], 'cli')
        self.assertEqual(pathlib.Path(calls[0][1][1]),
                         self.r.fw / 'scripts/lib/stackchan-cli.test.py')

    def test_usb_snapshot_uses_device_python_environment(self):
        devices = [dict(port='/dev/ttyACM0', vid=0x303a, pid=0x1001,
                        serial=m.SERIAL, location='1-1')]
        calls = []
        def fake_run(argv, **kwargs):
            calls.append(argv)
            if argv[0] == str(m.DEVICE_PYTHON):
                return types.SimpleNamespace(returncode=0, stdout=json.dumps(devices))
            return types.SimpleNamespace(returncode=1)
        with patch.object(m.subprocess, 'run', side_effect=fake_run), \
             patch.object(m.os, 'access', return_value=True):
            snapshot = self.r.usb_snapshot('preflight')
        self.assertEqual(snapshot['category'], 'port-available')
        self.assertEqual(calls[0][0], str(m.DEVICE_PYTHON))
        self.assertEqual(calls[0][1], '-c')
        self.assertIn('from serial.tools import list_ports', calls[0][2])
        self.assertIn('\n', calls[0][2])
        self.assertEqual(calls[1], ['fuser', '/dev/ttyACM0'])

    def test_usb_snapshot_reports_failed_helper_without_masking(self):
        with patch.object(m.subprocess, 'run',
                          return_value=types.SimpleNamespace(returncode=1, stdout='')):
            snapshot = self.r.usb_snapshot('failure-flash')
        self.assertEqual(snapshot['category'], 'diagnostic-unavailable')
        self.assertTrue((self.r.run / 'usb-failure-flash.json').is_file())

    def test_flash_timeout_diagnosis_runs_and_original_timeout_is_preserved(self):
        with patch.object(self.r, 'flash_failure_diagnosis') as diagnosis:
            with self.assertRaises(m.subprocess.TimeoutExpired):
                self.r.cmd('flash', ['python3', '-c', 'import time;time.sleep(10)'],
                           timeout=.05)
        diagnosis.assert_called_once()
        self.assertEqual(self.r.failed_command, 'flash')
        self.assertIsNone(self.r.child)
        self.assertTrue((self.r.run / 'flash.log').exists())

    def test_failure_diagnosis_exception_cannot_override_flash_failure(self):
        with patch.object(self.r, '_flash_failure_diagnosis',
                          side_effect=OSError('injected diagnostic failure')):
            with self.assertRaisesRegex(RuntimeError, 'command failed: flash'):
                self.r.cmd('flash', ['python3', '-c', 'import sys;sys.exit(7)'])
        self.assertEqual(self.r.failed_command, 'flash')

    def test_build_preserves_private_platform_and_retired_modules_are_removed(self):
        fw = self.r.fw
        app = fw / 'host/app'
        app.mkdir(parents=True, exist_ok=True)
        old = {'modules': {'archive-camera-handoff': {'obsolete': True},
                           'private-only': {'enabled': True}},
               'platforms': {'esp32/m5stackchan_cores3': {'private': True}}}
        example = {'modules': {'archive-live': {'url': 'live.js'}},
                   'platforms': {'esp32/m5stack_cores3': {'public': True}}}
        private = self.root / 'private-input.json'
        private.write_text(json.dumps(old))
        (app / 'manifest_archive.example.json').write_text(json.dumps(example))
        previous = app / 'manifest_archive_private.json'
        previous.write_text('previous-private-output')
        for filename in m.FILES.values():
            artifact = self.r.bin / filename
            artifact.parent.mkdir(parents=True, exist_ok=True)
            artifact.write_bytes(b'test')
        self.r.cmd = lambda *args, **kwargs: None
        self.r.validate_layout = lambda: None
        self.r.fingerprint = lambda: {'sha': 'a' * 40}
        with patch.object(m, 'PRIVATE', private):
            self.r.build()
        actual = json.loads(previous.read_text())
        self.assertNotIn('archive-camera-handoff', actual['modules'])
        self.assertIn('private-only', actual['modules'])
        self.assertIn('archive-live', actual['modules'])
        self.assertTrue(actual['platforms']['esp32/m5stackchan_cores3']['private'])
        self.assertTrue(actual['platforms']['esp32/m5stack_cores3']['public'])
        self.r.cleanup()
        self.assertEqual(previous.read_text(), 'previous-private-output')

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
