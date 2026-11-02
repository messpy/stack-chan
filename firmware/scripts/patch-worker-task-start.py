#!/usr/bin/env python3
"""Do not wait for a worker task that FreeRTOS could not allocate."""
import os
from pathlib import Path
MARKER='STACKCHAN_WORKER_TASK_START'
def patch_source(source):
    if MARKER in source:return source
    anchor='\t// FreeRTOS Task Creation. If we are specifying a core, use that, otherwise use the FreeRTOS xTaskCreate.'
    start=source.index(anchor);end=source.index('\n\tmodMachineTaskWait(the);',start)
    section=source[start:end]
    section=section.replace(anchor,'\t/* '+MARKER+': allocation failure must propagate, never wait forever. */\n\tBaseType_t taskCreated;\n'+anchor)
    section=section.replace('\t\txTaskCreatePinnedToCore(', '\t\ttaskCreated = xTaskCreatePinnedToCore(').replace('\t\txTaskCreate(', '\t\ttaskCreated = xTaskCreate(')
    section+='\n\tif (pdPASS != taskCreated)\n\t\txsUnknownError("unable to allocate worker task stack");\n'
    return source[:start]+section+source[end:]
if __name__=='__main__':
    p=Path(os.environ['MODDABLE'])/'modules/base/worker/modWorker.c'
    old=p.read_text();new=patch_source(old)
    if old!=new:p.write_text(new)
    print('SDK worker task allocation guard: ready')
