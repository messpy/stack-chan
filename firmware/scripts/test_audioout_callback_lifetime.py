import importlib.util,os,subprocess,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('patch',Path(__file__).with_name('patch-audioout-callback-lifetime.py'));patch=importlib.util.module_from_spec(spec);spec.loader.exec_module(patch)
def function(source,signature):
 start=source.index(signature+'\n{');brace=source.index('{',start);end=brace+1;depth=1
 while depth:
  if source[end]=='{':depth+=1
  elif source[end]=='}':depth-=1
  end+=1
 return source[start:end]
class CallbackLifetimeTests(unittest.TestCase):
 def test_queued_close_callback_close_requeue_and_failure(self):
  source=(Path(os.environ['MODDABLE'])/'modules/pins/i2s/audioout.c').read_text();source=patch.patch_source(source);self.assertEqual(patch.patch_source(source),source)
  start=source.index('/* STACKCHAN_AUDIOOUT_CALLBACK_LIFETIME');end=source.index('static void downUseCount',start)
  snippets=source[start:end]+function(source,'static void downUseCount(modAudioOut out)')+'\n'+function(source,'void deliverCallbacks(void *the, void *refcon, uint8_t *message, uint16_t messageLength)')+'\n'+function(source[source.index('void deliverCallbacks(void *the, void *refcon, uint8_t *message, uint16_t messageLength)\n{'):],'void queueCallback(modAudioOut out, xsIntegerValue id, xsIntegerValue stream)')
  harness=r'''
#include <assert.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#define ESP32 1
#define MODDEF_AUDIOOUT_QUEUELENGTH 8
#define kStateClosing 2
#define kStateTerminated 3
typedef int xsIntegerValue;typedef struct {int x;} xsMachine;typedef struct {int id,stream;}modAudioOutPendingCallbackRecord;
typedef struct Record {int8_t useCount;int state,built,obj,pendingCallbackCount,freed,mutexAlive;xsMachine *the;modAudioOutPendingCallbackRecord pendingCallbacks[8];} Record,*modAudioOut;
static xsMachine machine;static int destroys,forgets,begins,ends,callbacks,mode,failPost,queued;static void *messages[16];static int xsResult,fakeVar;
static void xs_audioout_destructor(void *data){modAudioOut out=data;assert(!out->freed);out->freed=1;destroys++;}
static void userCallback(modAudioOut out);
#define xsForget(obj) do {assert(the==&machine);forgets++;}while(0)
#define xsBeginHost(arg) do {assert(!out->freed);assert(out->state<kStateClosing);begins++;}while(0)
#define xsEndHost(arg) do {assert(!out->freed);ends++;}while(0)
#define xsmcVars(n) ((void)0)
#define xsVar(n) fakeVar
#define xsmcSetInteger(slot,value) ((slot)=(value))
#define xsTry if(1)
#define xsCatch else
#define xsmcGet(slot,obj,id) ((slot)=0)
#define xsmcGetIndex(slot,obj,id) ((void)(id),(slot)=0)
#define xsmcTypeOf(value) 0
#define xsUndefinedType 0
#define xsmcIsCallable(value) 0
#define xsCallFunction1(a,b,c) userCallback(out)
#define xsCall1(a,b,c) userCallback(out)
#define c_memmove __builtin_memmove
static void doLock(modAudioOut out){assert(!out->freed&&out->mutexAlive);}
static void doUnlock(modAudioOut out){assert(!out->freed&&out->mutexAlive);}
static void modLog(const char *text){(void)text;}
static int modMessagePostToMachine(void *the,void *msg,int len,void(*callback)(void*,void*,uint8_t*,uint16_t),void *data){(void)the;(void)msg;(void)len;(void)callback;if(failPost)return -1;messages[queued++]=data;return 0;}
SNIPPETS
static void closeOwner(modAudioOut out){out->state=kStateTerminated;out->mutexAlive=0;downUseCount(out);}
static void userCallback(modAudioOut out){callbacks++;if(mode==1){mode=0;closeOwner(out);}else if(mode==2){mode=0;queueCallback(out,99,0);}}
static Record fresh(void){destroys=forgets=begins=ends=callbacks=mode=failPost=queued=0;Record r={.useCount=1,.built=1,.mutexAlive=1,.the=&machine};return r;}
static void drain(void){for(int i=0;i<queued;i++)deliverCallbacks(&machine,messages[i],NULL,0);queued=0;}
int main(void){
 Record r=fresh();queueCallback(&r,1,0);assert(r.useCount==2);closeOwner(&r);assert(!r.freed);drain();assert(r.freed&&destroys==1&&forgets==1&&begins==0&&callbacks==0);
 r=fresh();queueCallback(&r,1,0);queueCallback(&r,2,0);assert(queued==1&&r.useCount==2);drain();assert(callbacks==2&&r.useCount==1&&!r.freed&&begins==ends);closeOwner(&r);assert(destroys==1);
 r=fresh();queueCallback(&r,1,0);queueCallback(&r,2,0);mode=1;drain();assert(callbacks==1&&destroys==1&&forgets==1&&begins==ends);
 r=fresh();queueCallback(&r,1,0);mode=2;drain();assert(callbacks==2&&r.useCount==1&&!r.freed);closeOwner(&r);assert(destroys==1);
 r=fresh();failPost=1;queueCallback(&r,1,0);assert(queued==0&&r.useCount==1&&r.pendingCallbackCount==0);closeOwner(&r);assert(destroys==1);
 puts("queued close, callback close, requeue and post failure passed");return 0;
}
'''.replace('SNIPPETS',snippets)
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);(p/'test.c').write_text(harness);subprocess.run(['cc','-Wall','-Wextra','-Werror','-Wno-unused-parameter','-fsanitize=undefined',str(p/'test.c'),'-o',str(p/'test')],check=True);subprocess.run([str(p/'test')],check=True)
if __name__=='__main__':unittest.main()
