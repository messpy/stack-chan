import importlib.util,os,subprocess,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('patch',Path(__file__).with_name('patch-worker-task-start.py'));patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)
class WorkerStartTest(unittest.TestCase):
 def test_creation_failure_never_waits(self):
  source=(Path(os.environ['MODDABLE'])/'modules/base/worker/modWorker.c').read_text();source=patch.patch_source(source);self.assertEqual(patch.patch_source(source),source)
  start=source.index('\t/* STACKCHAN_WORKER_TASK_START');end=source.index('\n#elif __ZEPHYR__',start);block=source[start:end]
  code=r'''
#include <assert.h>
#include <setjmp.h>
#include <stdint.h>
typedef int BaseType_t;typedef uint8_t StackType_t;
#define pdPASS 1
#define kStack 6000
static int succeed,waits,pinned;static jmp_buf fail;
static void workerLoop(void *p){(void)p;}
static int xTaskCreate(void (*fn)(void *),const char *name,int size,void *worker,int priority,void **task){(void)fn;(void)name;(void)size;(void)worker;(void)priority;(void)task;return succeed;}
static int xTaskCreatePinnedToCore(void (*fn)(void *),const char *name,int size,void *worker,int priority,void **task,int core){(void)core;pinned++;return xTaskCreate(fn,name,size,worker,priority,task);}
#define xsUnknownError(message) longjmp(fail,1)
static void modMachineTaskWait(void *the){(void)the;waits++;}
static void run(int core){
 struct {struct {int nativeStackSize;} creation;const char *module;void *task;} record={{24000},"test",0},*worker=&record;
 void *the=0;int priority=4;
BLOCK
}
int main(void){for(int core=-1;core<=1;core++){succeed=0;waits=0;if(!setjmp(fail)){run(core);assert(0);}assert(waits==0);succeed=1;run(core);assert(waits==1);}assert(pinned==4);return 0;}
'''.replace('BLOCK',block)
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'test.c').write_text(code);subprocess.run(['cc','-Wall','-Wextra','-Werror',str(p/'test.c'),'-o',str(p/'test')],check=True);subprocess.run([str(p/'test')],check=True)
if __name__=='__main__':unittest.main()
