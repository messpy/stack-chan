import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('checkpoint', Path(__file__).with_name('patch-promise-checkpoint.py'))
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


def function(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


class PromiseCheckpointTests(unittest.TestCase):
    def test_full_queue_does_not_block_or_drop_promise_jobs(self):
        sdk = Path(os.environ['MODDABLE'])
        source = (sdk / 'xs/platforms/esp/xsHost.c').read_text()
        source = patch.patch_source(source)
        self.assertEqual(patch.patch_source(source), source)
        service = function(source, 'void modMessageService(xsMachine *the, int maxDelayMS)')
        schedule = function(source, 'void fxQueuePromiseJobs(txMachine* the)')
        harness = r'''
#include <assert.h>
#include <stdint.h>
#include <stddef.h>
#define ESP32 1
#define portBASE_TYPE int
#define pdMS_TO_TICKS(x) (x)
#define XS_REFERENCE_KIND 1
typedef struct {void *msgQueue;} xsMachine;
typedef xsMachine txMachine;
typedef void (*modMessageDeliver)(void*,void*,uint8_t*,uint16_t);
typedef struct {char *message;modMessageDeliver callback;void *refcon;uint16_t length;uint8_t embeddedMessage;} modMessageRecord;
struct Jobs {void *next;};
struct {int kind;union {struct Jobs *reference;} value;} pending;
#define mxPendingJobs pending
static struct Jobs jobs;
static int queued,sendCalls,ran,events,lastWait=-1,appendNext;
static uint32_t clockTick;
uint32_t modMilliseconds(void){return clockTick++;}
unsigned uxQueueMessagesWaiting(void *q){return queued;}
void modWatchDogReset(void){}
void c_free(void *p){}
void callback(void *m,void *r,uint8_t *d,uint16_t n){events++;}
int xQueueReceive(void *q,modMessageRecord *m,int delay){lastWait=delay;if(!queued)return 0;queued--;*m=(modMessageRecord){.callback=callback};return 1;}
int modMessagePostToMachine(txMachine *m,void *d,int n,modMessageDeliver cb,void *r){sendCalls++;assert(queued<10);queued++;return 0;}
void fxRunPromiseJobs(txMachine *the){ran++;jobs.next=appendNext?(void*)1:NULL;appendNext=0;}
'''
        harness += schedule + '\n' + service + r'''
int main(void){
 xsMachine machine={0};pending.kind=XS_REFERENCE_KIND;pending.value.reference=&jobs;
 queued=10;jobs.next=(void*)1;
 fxQueuePromiseJobs(&machine);assert(sendCalls==0); /* Must return even with a full queue. */
 modMessageService(&machine,500);assert(ran==1);assert(jobs.next==NULL);assert(events>0);
 queued=0;jobs.next=(void*)1;appendNext=1;
 modMessageService(&machine,500);assert(lastWait==0);assert(ran==2);assert(jobs.next!=NULL);
 modMessageService(&machine,500);assert(ran==3);assert(jobs.next==NULL);
 queued=0;modMessageService(&machine,123);assert(lastWait==123);assert(ran==3);
 return 0;
}
'''
        with tempfile.TemporaryDirectory() as directory:
            c = Path(directory) / 'test.c'
            exe = Path(directory) / 'test'
            c.write_text(harness)
            subprocess.run(['cc', '-std=c99', str(c), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True, timeout=5)


if __name__ == '__main__':
    unittest.main()
