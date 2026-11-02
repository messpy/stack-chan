import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('queue_patch', Path(__file__).with_name('patch-self-message-queue.py'))
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)
spec2 = importlib.util.spec_from_file_location('promise_test', Path(__file__).with_name('test_promise_checkpoint.py'))
helper = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(helper)


class SelfQueueTests(unittest.TestCase):
    def test_full_queue_preserves_order_and_releases_memory(self):
        source = (Path(os.environ['MODDABLE']) / 'xs/platforms/esp/xsHost.c').read_text()
        source = patch.patch_source(source)
        self.assertEqual(patch.patch_source(source), source)
        header = (Path(os.environ['MODDABLE']) / 'xs/platforms/esp/xsPlatform.h').read_text()
        self.assertEqual(patch.patch_header(header), header)
        post = helper.function(source, 'int modMessagePostToMachine(xsMachine *the,')
        service = helper.function(source, 'void modMessageService(xsMachine *the, int maxDelayMS)')
        cleanup = helper.function(source, 'void modMachineTaskUninit(xsMachine *the)')
        harness = r'''
#include <assert.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#define ESP32 1
#define portBASE_TYPE int
#define pdTRUE 1
#define pdMS_TO_TICKS(x) (x)
#define MODDEF_TASK_QUEUEWAIT 999
#define XS_REFERENCE_KIND 1
#define c_memmove memmove
typedef struct {void *msgQueue,*task,*selfQueueHead,*selfQueueTail;uint32_t messageReadCount;} xsMachine;
typedef void (*modMessageDeliver)(void*,void*,uint8_t*,uint16_t);
typedef struct {char *message;modMessageDeliver callback;void *refcon;uint16_t length;uint8_t embeddedMessage;} modMessageRecord;
struct Jobs {void *next;};
static struct Jobs jobs;
static struct {int kind;union {struct Jobs *reference;} value;} pending={.kind=1,.value.reference=&jobs};
#define mxPendingJobs pending
static modMessageRecord queue[2];static unsigned queued,head;
static uintptr_t currentTask=1;static int allocated,failAllocation;
static char delivered[32];static int received;
void *modTaskGetCurrent(void){return (void*)currentTask;}
void *c_malloc(size_t n){if(failAllocation){failAllocation=0;return NULL;}void *p=malloc(n);if(p)allocated++;return p;}
void c_free(void *p){if(p){allocated--;free(p);}}
unsigned uxQueueMessagesWaiting(void *q){return queued;}
int xQueueSendToBack(void *q,modMessageRecord *m,int delay){if(queued==2){assert(delay==0);return 0;}queue[(head+queued)%2]=*m;queued++;return 1;}
int xQueueReceive(void *q,modMessageRecord *m,int delay){if(!queued)return 0;*m=queue[head];head=(head+1)%2;queued--;return 1;}
void vQueueDelete(void *q){}
uint32_t modMilliseconds(void){static uint32_t tick;return tick++;}
void modWatchDogReset(void){}
void fxRunPromiseJobs(xsMachine *the){jobs.next=NULL;}
void callback(void *m,void *ref,uint8_t *data,uint16_t length){delivered[received++]=(char)(uintptr_t)ref;if(length)assert(data[0]=='x');}
'''
        harness += patch.HELPERS + '\n' + post + '\n' + service + '\n' + cleanup + r'''
int main(void){
 xsMachine m={.msgQueue=(void*)1,.task=(void*)1};
 assert(modMessagePostToMachine(&m,NULL,0,callback,(void*)'A')==0);
 assert(modMessagePostToMachine(&m,NULL,0,callback,(void*)'B')==0);
 char payload[20];memset(payload,'x',sizeof(payload));
 assert(modMessagePostToMachine(&m,(uint8_t*)payload,20,callback,(void*)'C')==0);
 assert(modMessagePostToMachine(&m,(uint8_t*)payload,1,callback,(void*)'D')==0);
 assert(received==0);assert(allocated==3); /* C's copied payload + two overflow nodes. */
 modMessageService(&m,0);assert(received==1&&delivered[0]=='A');
 currentTask=2;assert(modMessagePostToMachine(&m,NULL,0,callback,(void*)'E')==0);currentTask=1;
 modMessageService(&m,0);assert(received==4);assert(!memcmp(delivered,"ABCD",4));assert(allocated==0);
 modMessageService(&m,0);assert(received==5&&delivered[4]=='E');
 /* Wraparound of the receive counter cannot strand an overflow event. */
 m.messageReadCount=UINT32_MAX-1;received=0;
 modMessagePostToMachine(&m,NULL,0,callback,(void*)'A');modMessagePostToMachine(&m,NULL,0,callback,(void*)'B');modMessagePostToMachine(&m,NULL,0,callback,(void*)'C');
 modMessageService(&m,0);modMessageService(&m,0);assert(received==3);assert(!memcmp(delivered,"ABC",3));
 /* Allocation failure reports failure, never a wait or an unowned payload. */
 modMessagePostToMachine(&m,NULL,0,callback,(void*)'A');modMessagePostToMachine(&m,NULL,0,callback,(void*)'B');failAllocation=1;
 assert(modMessagePostToMachine(&m,NULL,0,callback,(void*)'F')==-1);
 modMessagePostToMachine(&m,(uint8_t*)payload,20,callback,(void*)'C');assert(allocated==2);
 modMachineTaskUninit(&m);assert(allocated==0);assert(!m.selfQueueHead&&!m.selfQueueTail);
 return 0;
}
'''
        with tempfile.TemporaryDirectory() as directory:
            c, exe = Path(directory) / 'test.c', Path(directory) / 'test'
            c.write_text(harness)
            subprocess.run(['cc', '-std=c99', str(c), '-o', str(exe)], check=True)
            subprocess.run([str(exe)], check=True, timeout=5)


if __name__ == '__main__':
    unittest.main()
