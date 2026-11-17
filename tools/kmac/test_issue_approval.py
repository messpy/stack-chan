import copy
import importlib.util
import json
import multiprocessing
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import stackchan_issue_auth as auth


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


agent = load('issue_agent', 'stackchan-issue-agent.py')
shell = load('shell_agent', 'stackchan-issue-shell-agent.py')


def competing_worker(root, ready, done):
    agent.RUNS = Path(root)
    agent.STATE_PATH = Path(root) / 'state.json'
    agent.LOCK_PATH = Path(root) / 'lock'
    ready.wait(5)
    try:
        fd = agent.get_lock()
    except SystemExit:
        done.put('locked')
        return
    try:
        state = agent.load_state()
        agent.enqueue(state, [])
        done.put(state['queue'][0]['status'])
    finally:
        os.close(fd)


class ApprovalTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.paths = patch.multiple(agent, RUNS=Path(self.tmp.name),
                                    STATE_PATH=Path(self.tmp.name)/'state.json',
                                    LOCK_PATH=Path(self.tmp.name)/'lock')
        self.paths.start()
        self.addCleanup(self.paths.stop)
        self.state = {'seen_until': 10, 'request_ids': ['existing'], 'queue': [
            {'comment_id': 9, 'request_id': 'existing', 'action': 'all', 'pr': 102,
             'status': 'approval_required', 'approval_nonce': 'a'*32}]}
        self.now = datetime.now(timezone.utc).replace(microsecond=0)
        self.payload = {'request_id': 'existing', 'action': 'all', 'pr': 102, 'nonce': 'a'*32,
                        'expires_at': (self.now+timedelta(minutes=5)).isoformat()}
        self.comment = {'id': 11, 'user': {'login': 'messpy', 'id': auth.OWNER_ID, 'type': 'User'},
                        'author_association': 'OWNER',
                        'issue_url': 'https://api.github.com/repos/messpy/stack-chan/issues/111',
                        'created_at': self.now.isoformat(), 'updated_at': self.now.isoformat()}
        self.refresh_body()
        self.fetch = patch.object(auth.subprocess, 'run', side_effect=self.response)
        self.mock_fetch = self.fetch.start()
        self.addCleanup(self.fetch.stop)

    def refresh_body(self):
        self.comment['body'] = agent.APPROVAL_PREFIX + json.dumps(self.payload)

    def response(self, *args, **kwargs):
        return subprocess.CompletedProcess(args, 0, json.dumps(self.comment), '')

    def enqueue(self, comments=None):
        agent.enqueue(self.state, [self.comment] if comments is None else comments)

    def test_valid_persists_once_and_does_not_execute(self):
        with patch.object(agent, 'execute') as execute:
            self.enqueue()
            execute.assert_not_called()
        state = agent.load_state()
        self.assertEqual(state['queue'][0]['status'], 'queued')
        self.assertEqual(state['queue'][0]['approval_comment_id'], 11)
        self.assertEqual(state['approval_comment_ids'], [11])
        self.assertEqual(state['request_ids'], ['existing'])

    def test_unauthorized_missing_or_changed_identity(self):
        for field, value in [('login', 'attacker'), ('id', 99), ('id', True), ('type', 'Bot')]:
            with self.subTest(field=field, value=value):
                user = self.comment['user'].copy()
                self.comment['user'][field] = value
                self.assertIsNone(agent.parse_approval(self.comment))
                self.comment['user'] = user
        del self.comment['user']['id']
        self.assertIsNone(agent.parse_approval(self.comment))

    def test_expired_future_overlong_and_timezone(self):
        for expiry in [self.now-timedelta(seconds=1), self.now+timedelta(minutes=16)]:
            self.payload['expires_at'] = expiry.isoformat()
            self.refresh_body()
            self.assertIsNone(agent.parse_approval(self.comment))
        self.payload['expires_at'] = '2026-11-12T12:00:00'
        self.refresh_body()
        self.assertIsNone(agent.parse_approval(self.comment))
        self.comment['created_at'] = self.comment['updated_at'] = (self.now+timedelta(days=1)).isoformat()
        self.assertIsNone(agent.parse_approval(self.comment))

    def test_replay_and_second_comment_do_not_reapprove(self):
        self.enqueue()
        self.enqueue()
        self.comment['id'] = 12
        self.enqueue()
        self.assertEqual(self.state['approval_comment_ids'], [11])
        self.state['queue'][0]['status'] = 'completed'
        self.comment['id'] = 13
        self.enqueue()
        self.assertEqual(self.state['queue'][0]['status'], 'completed')

    def test_wrong_request_pr_action_or_unknown_fields(self):
        original = self.payload.copy()
        for key, value in [('request_id', 'other'), ('pr', 103), ('pr', True),
                           ('action', 'build'), ('nonce', 'b'*32), ('command', 'whoami')]:
            with self.subTest(key=key):
                self.payload = {**original, key: value}
                self.refresh_body()
                self.assertFalse(agent.apply_approval(self.state, self.comment, {'existing'}))
        self.assertEqual(self.state['queue'][0]['status'], 'approval_required')

    def test_malformed_approval(self):
        for body in ['{}', '[]', 'null', '{', json.dumps(self.payload)[:-1]+',"pr":102}']:
            self.comment['body'] = agent.APPROVAL_PREFIX+body
            self.assertIsNone(agent.parse_approval(self.comment))

    def test_lookup_failure_fails_closed(self):
        for error in [subprocess.CalledProcessError(1, 'gh'), subprocess.TimeoutExpired('gh', 60),
                      FileNotFoundError()]:
            self.mock_fetch.side_effect = error
            self.enqueue()
            self.assertEqual(self.state['queue'][0]['status'], 'approval_required')
            self.state['seen_until'] = 10

    def test_edited_wrong_issue_and_mismatched_fresh_comment(self):
        for field, value in [('updated_at', (self.now+timedelta(seconds=1)).isoformat()),
                             ('issue_url', 'https://api.github.com/repos/messpy/stack-chan/issues/110'),
                             ('author_association', 'CONTRIBUTOR')]:
            fresh = {**self.comment, field: value}
            self.mock_fetch.side_effect = None
            self.mock_fetch.return_value = subprocess.CompletedProcess([], 0, json.dumps(fresh), '')
            self.assertIsNone(agent.parse_approval(self.comment))
        fresh = {**self.comment, 'id': 12}
        self.mock_fetch.return_value.stdout = json.dumps(fresh)
        self.assertIsNone(agent.parse_approval(self.comment))

    def test_same_poll_request_cannot_be_approved(self):
        self.state = {'seen_until': 8, 'request_ids': [], 'queue': []}
        command = {**self.comment, 'id': 9, 'body': agent.COMMAND_PREFIX+json.dumps(
            {'request_id': 'existing', 'action': 'all', 'pr': 102})}
        with patch.object(agent, 'verified_comment', side_effect=lambda c: c):
            self.enqueue([command, self.comment])
        self.assertEqual(self.state['queue'][0]['status'], 'approval_required')

    def test_duplicate_existing_request_is_never_enqueued(self):
        command = {**self.comment, 'body': agent.COMMAND_PREFIX+json.dumps(
            {'request_id': 'existing', 'action': 'all', 'pr': 102})}
        with patch.object(agent, 'verified_comment', return_value=command):
            self.enqueue([command])
        self.assertEqual(len(self.state['queue']), 1)
        self.assertEqual(self.state['queue'][0]['status'], 'approval_required')

    def test_expiry_at_dispatch_prevents_reporter(self):
        self.enqueue()
        task = self.state['queue'][0]
        task['approval_expires_at'] = (self.now-timedelta(seconds=1)).isoformat()
        with patch.object(agent.subprocess, 'Popen') as popen:
            agent.execute(self.state, task)
            popen.assert_not_called()
        self.assertEqual(agent.load_state()['queue'][0]['status'], 'approval_required')

    def test_local_interactive_approval_preserved(self):
        agent.save_state(self.state)
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='yes'):
            agent.approve('existing')
        self.assertEqual(agent.load_state()['queue'][0]['status'], 'queued')
        self.assertNotIn('approval_comment_id', agent.load_state()['queue'][0])

    def test_lock_blocks_competing_process_without_state_change(self):
        agent.save_state(self.state)
        fd = agent.get_lock()
        try:
            ctx = multiprocessing.get_context('spawn')
            ready, done = ctx.Event(), ctx.Queue()
            worker = ctx.Process(target=competing_worker, args=(self.tmp.name, ready, done))
            worker.start()
            ready.set()
            self.assertEqual(done.get(timeout=10), 'locked')
            worker.join(10)
            self.assertEqual(worker.exitcode, 0)
            self.assertEqual(agent.load_state(), self.state)
        finally:
            os.close(fd)
        # Sequential contender sees durable approval and cannot replay it.
        self.enqueue()
        fd = agent.get_lock()
        try:
            loaded = agent.load_state()
            agent.enqueue(loaded, [self.comment])
            self.assertEqual(loaded['approval_comment_ids'], [11])
        finally:
            os.close(fd)

    def test_valid_build_requires_matching_approval(self):
        self.state['queue'][0]['action'] = 'build'
        self.payload['action'] = 'build'
        self.refresh_body()
        self.enqueue()
        self.assertEqual(agent.load_state()['queue'][0]['status'], 'queued')

    def test_local_build_approval_preserved(self):
        self.state['queue'][0]['action'] = 'build'
        agent.save_state(self.state)
        with patch.object(agent.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='yes'):
            agent.approve('existing')
        self.assertEqual(agent.load_state()['queue'][0]['status'], 'queued')

    def test_dispatch_rechecks_comment_and_calls_only_fixed_reporter(self):
        self.enqueue()
        with patch.object(agent.subprocess, 'Popen') as popen:
            popen.return_value.wait.return_value = 0
            agent.execute(self.state, self.state['queue'][0])
            self.assertEqual(popen.call_args.args[0], ['bash', str(agent.REPORTER), '--all'])
        self.assertEqual(self.state['queue'][0]['status'], 'completed')

    def test_edit_after_approval_revokes_without_execution(self):
        self.enqueue()
        self.comment['body'] += ' '
        with patch.object(agent.subprocess, 'Popen') as popen:
            agent.execute(self.state, self.state['queue'][0])
            popen.assert_not_called()
        self.assertEqual(self.state['queue'][0]['status'], 'approval_required')
        self.assertNotEqual(self.state['queue'][0]['approval_nonce'], 'a'*32)

    def test_pending_build_migration_and_diagnostics_continue(self):
        self.state['queue'][0].update(action='build', status='queued')
        self.enqueue([])
        self.assertEqual(self.state['queue'][0]['status'], 'approval_required')
        self.state['queue'].append(dict(comment_id=10, request_id='diagnostic', action='check',
                                       pr=102, status='queued'))
        agent.save_state(self.state)
        with patch.object(agent, 'fetch_comments', return_value=[]), patch.object(agent, 'execute') as execute:
            agent.poll()
            self.assertEqual(execute.call_args.args[1]['action'], 'check')

    def test_legacy_pending_requests_migrate_without_approval(self):
        self.state['queue'][0].pop('approval_nonce')
        self.enqueue([])
        task = agent.load_state()['queue'][0]
        self.assertEqual(task['status'], 'approval_required')
        self.assertEqual(len(task['approval_nonce']), 32)
        self.assertNotIn('approved_at', task)

    def test_duplicate_state_request_rejected(self):
        self.state['queue'].append(copy.deepcopy(self.state['queue'][0]))
        self.enqueue()
        self.assertTrue(all(t['status'] == 'approval_required' for t in self.state['queue']))

    def test_shell_fails_closed_before_command_execution(self):
        comment = {**self.comment, 'body': shell.MARKER + json.dumps({
            'request_id': 'shell_test', 'host': shell.HOST, 'cwd': str(shell.PROJECT),
            'command': 'printf test'})}
        with patch.object(shell.socket, 'gethostname', return_value=shell.HOST), \
             patch.object(shell.os, 'geteuid', return_value=1000), \
             patch.object(shell.shutil, 'which', return_value='/usr/bin/gh'), \
             patch.multiple(shell, STATE_DIR=Path(self.tmp.name), LOCK=Path(self.tmp.name)/'shell.lock'), \
             patch.object(shell, 'load_comments', return_value=[comment]), \
             patch.object(shell, 'get_cursor', return_value=10), \
             patch.object(shell, 'save_state'), patch.object(shell, 'verified_comment', return_value=None), \
             patch.object(shell, 'execute') as execute:
            self.assertEqual(shell.once(), 0)
            execute.assert_not_called()

    def test_shell_consumer_ignores_approval_marker(self):
        self.assertIsNone(shell.validate(self.comment))


class ShellQueueTests(unittest.TestCase):
    def test_authenticated_request_reserved_before_execution_and_duplicate_skipped(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            with patch.multiple(shell, PROJECT=root, STATE_DIR=root, STATE=root/'state.json',
                                LOCK=root/'lock'), \
                    patch.object(shell.socket, 'gethostname', return_value='kmac'), \
                    patch.object(shell.os, 'geteuid', return_value=1000), \
                    patch.object(shell.shutil, 'which', return_value='/usr/bin/gh'):
                shell.save_state(1)
                def command(cid):
                    return {'id': cid, 'user': {'login': shell.OWNER},
                            'body': shell.MARKER+json.dumps({'request_id': 'one',
                             'host': 'kmac', 'cwd': str(root), 'command': 'printf test'})}
                def executed(*args):
                    self.assertIn('one', shell.get_request_ids())
                    raise OSError('simulated crash')
                with patch.object(shell, 'load_comments', return_value=[command(2), command(3)]), \
                        patch.object(shell, 'verified_comment', return_value={}), \
                        patch.object(shell, 'execute', side_effect=executed) as execute:
                    self.assertEqual(shell.once(), 0)
                    self.assertEqual(execute.call_count, 1)
                    self.assertEqual(shell.get_cursor(), 3)

    def test_legacy_cursor_migration_and_auth_failure_do_not_execute(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            with patch.multiple(shell, PROJECT=root, STATE_DIR=root, STATE=root/'state.json',
                                LOCK=root/'lock'), \
                    patch.object(shell.socket, 'gethostname', return_value='kmac'), \
                    patch.object(shell.os, 'geteuid', return_value=1000), \
                    patch.object(shell.shutil, 'which', return_value='/usr/bin/gh'):
                shell.STATE.write_text(json.dumps({'last_comment_id': 1}))
                def command(cid):
                    return {'id': cid, 'user': {'login': shell.OWNER},
                            'body': shell.MARKER+json.dumps({'request_id': 'legacy',
                             'host': 'kmac', 'cwd': str(root), 'command': 'printf test'})}
                with patch.object(shell, 'load_comments', return_value=[command(1), command(2)]), \
                        patch.object(shell, 'verified_comment', return_value=None), \
                        patch.object(shell, 'execute') as execute:
                    self.assertEqual(shell.once(), 0)
                    execute.assert_not_called()
                    self.assertIn('legacy', shell.get_request_ids())



if __name__ == '__main__':
    unittest.main()
