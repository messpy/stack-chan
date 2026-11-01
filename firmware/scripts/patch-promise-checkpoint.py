#!/usr/bin/env python3
"""Apply the ESP32 Promise queue deadlock fix, preserving SDK licensing."""
import os
from pathlib import Path
import sys

MARKER = 'STACKCHAN_PROMISE_CHECKPOINT'
OLD = '''void fxQueuePromiseJobs(txMachine* the)
{
\tmodMessagePostToMachine(the, NULL, 0, doRunPromiseJobs, NULL);
}'''
NEW = '''void fxQueuePromiseJobs(txMachine* the)
{
#if ESP32
\t/* STACKCHAN_PROMISE_CHECKPOINT: Promise jobs belong to this VM. Posting
\t * them to its own full queue deadlocks the consumer. The message-service
\t * checkpoint below runs them after callbacks return, without dropping jobs. */
\t(void)the;
#else
\tmodMessagePostToMachine(the, NULL, 0, doRunPromiseJobs, NULL);
#endif
}'''


def patch_source(source):
    if MARKER in source:
        return source
    if source.count(OLD) != 1:
        raise RuntimeError('SDK Promise implementation changed; review the patch before building')
    start = source.index('void modMessageService(xsMachine *the, int maxDelayMS)')
    end = source.index('\n#ifndef MODDEF_TASK_QUEUELENGTH', start)
    section = source[start:end]
    entry = '\tmodMessageRecord msg;\n'
    tail = '\tmodWatchDogReset();\n}'
    if section.count(entry) != 1 or section.count(tail) != 1:
        raise RuntimeError('SDK message loop changed; review the patch before building')
    section = section.replace(entry, entry + '''\tif ((mxPendingJobs.kind == XS_REFERENCE_KIND) && mxPendingJobs.value.reference->next)
\t\tmaxDelayMS = 0; /* Never sleep while this VM has pending microtasks. */
''', 1)
    section = section.replace(tail, '''\tif ((mxPendingJobs.kind == XS_REFERENCE_KIND) && mxPendingJobs.value.reference->next)
\t\tfxRunPromiseJobs(the);
''' + tail, 1)
    return (source[:start] + section + source[end:]).replace(OLD, NEW, 1)


def apply(sdk):
    target = Path(sdk) / 'xs/platforms/esp/xsHost.c'
    before = target.read_text()
    after = patch_source(before)
    if after != before:
        target.write_text(after)
    print('SDK Promise checkpoint: ready')


if __name__ == '__main__':
    sdk = os.environ.get('MODDABLE')
    if not sdk:
        raise SystemExit('MODDABLE is not set; load the SDK environment first')
    apply(sdk)
