#!/usr/bin/env python3
"""Avoid ESP32 task self-queue waits; retain event order and ownership."""
import os
from pathlib import Path

MARKER = 'STACKCHAN_SELF_MESSAGE_QUEUE'
HELPERS = '''
/* STACKCHAN_SELF_MESSAGE_QUEUE: owner-task posts cannot wait for the owner.
 * Keep overflow events until all earlier queued events have been consumed. */
typedef struct ScSelfMessage {
    modMessageRecord record;
    struct ScSelfMessage *next;
    uint32_t readyAfter;
} ScSelfMessage;
static void scDeliverSelfMessages(xsMachine *the) {
    ScSelfMessage *node;
    while ((node = the->selfQueueHead) && ((int32_t)(the->messageReadCount - node->readyAfter) >= 0)) {
        modMessageRecord msg = node->record;
        the->selfQueueHead = node->next;
        if (!node->next) the->selfQueueTail = NULL;
        c_free(node);
        if (msg.embeddedMessage)
            msg.callback(the, msg.refcon, (uint8_t *)&msg.message, msg.length);
        else {
            msg.callback(the, msg.refcon, (uint8_t *)msg.message, msg.length);
            if (msg.message) c_free(msg.message);
        }
    }
}
'''
SELF_POST = '''
    if (the->task == (void *)modTaskGetCurrent()) {
        if (!the->selfQueueHead && (pdTRUE == xQueueSendToBack(the->msgQueue, &msg, 0)))
            return 0;
        ScSelfMessage *node = c_malloc(sizeof(ScSelfMessage));
        if (!node) {
            if (msg.message && !msg.embeddedMessage) c_free(msg.message);
            return -1;
        }
        node->record = msg;
        node->next = NULL;
        node->readyAfter = the->messageReadCount + uxQueueMessagesWaiting(the->msgQueue);
        if (the->selfQueueTail) ((ScSelfMessage *)the->selfQueueTail)->next = node;
        else the->selfQueueHead = node;
        the->selfQueueTail = node;
        return 0;
    }
'''


def patch_header(source):
    if 'void *selfQueueHead;' in source:
        return source
    anchor = '\t\tvoid *msgQueue; \\\n'
    if source.count(anchor) != 1:
        raise RuntimeError('SDK machine structure changed; review self-queue patch')
    return source.replace(anchor, anchor + '\t\tvoid *selfQueueHead; \\\n\t\tvoid *selfQueueTail; \\\n\t\tuint32_t messageReadCount; \\\n', 1)


def patch_source(source):
    if MARKER in source:
        return source
    anchor = 'int modMessagePostToMachine(xsMachine *the,'
    index = source.index(anchor)
    source = source[:index] + HELPERS + '\n' + source[index:]
    anchor = '\tif (pdTRUE == xQueueSendToBack(the->msgQueue, &msg, MODDEF_TASK_QUEUEWAIT))'
    if source.count(anchor) != 1:
        raise RuntimeError('SDK message sender changed; review self-queue patch')
    source = source.replace(anchor, SELF_POST + '\n' + anchor, 1)
    start = source.index('void modMessageService(xsMachine *the, int maxDelayMS)')
    end = source.index('\n#ifndef MODDEF_TASK_QUEUELENGTH', start)
    section = source[start:end]
    section = section.replace('\tmodMessageRecord msg;\n', '\tmodMessageRecord msg;\n\tscDeliverSelfMessages(the);\n\tif (the->selfQueueHead) maxDelayMS = 0;\n', 1)
    for queue, counter in [('queue', 'if (queue == the->msgQueue) the->messageReadCount++;'), ('the->msgQueue', 'the->messageReadCount++;')]:
        anchor = f'\t\tif (!xQueueReceive({queue}, &msg, '
        index = section.index(anchor)
        stop = section.index('\n\t\tmodWatchDogReset();', index)
        section = section[:stop] + '\n\t\t' + counter + '\n' + section[stop:]
    # Deliver overflow only after each queued callback has returned, never recursively.
    section = section.replace('\n\t\tif ((queue == the->msgQueue) && !--count)', '\n\t\tscDeliverSelfMessages(the);\n\t\tif ((queue == the->msgQueue) && !--count)', 1)
    section = section.replace('\n\t\tif (!--count)', '\n\t\tscDeliverSelfMessages(the);\n\t\tif (!--count)', 1)
    source = source[:start] + section + source[end:]
    source = source.replace('\tthe->task = (void *)modTaskGetCurrent();', '\tthe->selfQueueHead = the->selfQueueTail = NULL;\n\tthe->messageReadCount = 0;\n\tthe->task = (void *)modTaskGetCurrent();', 1)
    start = source.index('void modMachineTaskUninit(xsMachine *the)')
    index = source.index('\n\tif (the->msgQueue)', start)
    cleanup = '''
    while (the->selfQueueHead) {
        ScSelfMessage *node = the->selfQueueHead;
        the->selfQueueHead = node->next;
        if (node->record.message && !node->record.embeddedMessage) c_free(node->record.message);
        c_free(node);
    }
    the->selfQueueTail = NULL;
'''
    return source[:index] + cleanup + source[index:]


def apply(sdk):
    root = Path(sdk) / 'xs/platforms/esp'
    header, source = root / 'xsPlatform.h', root / 'xsHost.c'
    h, s = header.read_text(), source.read_text()
    new_h, new_s = patch_header(h), patch_source(s)
    if new_h != h: header.write_text(new_h)
    if new_s != s: source.write_text(new_s)
    print('SDK self-message queue: ready')


if __name__ == '__main__':
    sdk = os.environ.get('MODDABLE')
    if not sdk: raise SystemExit('MODDABLE is not set')
    apply(sdk)
