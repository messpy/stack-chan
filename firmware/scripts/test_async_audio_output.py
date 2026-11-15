"""Compile the production native queue/drain routines against a host I2S sink.
Function extraction allows the same C to run without XS/ESP-IDF; no source
literal assertions. Two concurrent consumers exercise the actual transaction.
"""
from pathlib import Path
import subprocess,tempfile,unittest
SOURCE=Path(__file__).parents[1]/'host/modules/audio/async-output/stackchan-async-output.c'
def function(source,name):
    import re
    match=re.search(r'^.*\b'+name+r'\([^;{}]*\)\n\{',source,re.M)
    if not match: raise ValueError(name)
    start=match.start()
    opening=source.index('{',start); depth=1;end=opening+1
    while depth:
        depth+=(source[end]=='{')-(source[end]=='}');end+=1
    return source[start:end]
class AudioOutput(unittest.TestCase):
 def test_concurrent_pcm_and_short_writes(self):
    source=SOURCE.read_text()
    code=r'''
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdlib.h>
#include <assert.h>
#include <pthread.h>
#include <sched.h>
typedef int esp_err_t;
typedef unsigned xsUnsignedValue;
#define ESP_OK 0
#define ESP_FAIL -1
#define portMAX_DELAY 0
#define c_memcpy memcpy
#define xSemaphoreTake(m,t) pthread_mutex_lock(m)
#define xSemaphoreGive(m) pthread_mutex_unlock(m)
typedef int xsSlot;
typedef void xsMachine;
typedef void *i2s_chan_handle_t;
typedef void *TaskHandle_t;
typedef pthread_mutex_t *SemaphoreHandle_t;
typedef struct AudioOutElementRecord *AudioOutElement;
typedef struct AudioOutRecord *AudioOut;
'''+source[source.index('struct AudioOutElementRecord {'):source.index('};',source.index('struct AudioOutElementRecord {'))+2]+'\n'+source[source.index('struct AudioOutRecord {'):source.index('};',source.index('struct AudioOutRecord {'))+2]+r'''
static uint8_t received[65536]; static size_t written; static int shortWrite;
static esp_err_t i2s_channel_write(void *h,void *src,size_t n,size_t *used,int timeout){
  sched_yield(); *used=shortWrite?n-2:n; memcpy(received+written,src,*used);written+=*used;return ESP_OK;
}
static esp_err_t i2s_channel_preload_data(void *h,void *src,size_t n,size_t *used){return i2s_channel_write(h,src,n,used,0);}
static esp_err_t scAudioOutWrite(AudioOut,void *,xsUnsignedValue);
'''+function(source,'drainQueue')+'\n'+function(source,'scAudioOutWrite')+r'''
static void *consumer(void *p){for(int i=0;i<100;i++)drainQueue(p);return NULL;}
int main(void){
 for(int volume=64;volume<=256;volume*=2){
  int16_t pcm[16368]; for(int i=0;i<16368;i++)pcm[i]=(i*71)%30000-15000;
  struct AudioOutElementRecord e={.data=pcm,.bytesAvailable=sizeof(pcm)};
  pthread_mutex_t mutex=PTHREAD_MUTEX_INITIALIZER;uint8_t staging[4092];
  struct AudioOutRecord output={.queueMutex=&mutex,.elements=&e,.bytesWritable=sizeof(pcm),.dma_buf_size=4092,.volumeFixed=volume,.started=1,.stagingBuffer=staging};
  written=0; pthread_t a,b;pthread_create(&a,NULL,consumer,&output);pthread_create(&b,NULL,consumer,&output);pthread_join(a,NULL);pthread_join(b,NULL);
  assert(written==sizeof(pcm));assert(e.position==sizeof(pcm));assert(!e.bytesAvailable);assert(!e.err);
  for(int i=0;i<16368;i++)assert(((int16_t*)received)[i]==(pcm[i]*volume>>8));
  shortWrite=1;written=0;output.bytesWritable=4092;assert(scAudioOutWrite((AudioOut)&output,pcm,4092)==ESP_FAIL);shortWrite=0;
  // A failed element cannot allow later PCM through on the next pump.
  e.position=0;e.bytesAvailable=4092;e.err=0;output.bytesWritable=8192;output.fault=0;written=0;shortWrite=1;
  struct AudioOutElementRecord next={.data=pcm,.bytesAvailable=4092};e.next=&next;
  drainQueue((AudioOut)&output);assert(output.fault==ESP_FAIL);assert(next.bytesAvailable==0);assert(next.err==ESP_FAIL);assert(written==4090);shortWrite=0;
  pthread_mutex_destroy(&mutex);
 }
 return 0;
}
'''
    with tempfile.TemporaryDirectory() as d:
      p=Path(d);(p/'test.c').write_text(code)
      subprocess.run(['cc','-std=c11','-pthread','-fsanitize=undefined','-g',str(p/'test.c'),'-o',str(p/'test')],check=True)
      subprocess.run([str(p/'test')],check=True,timeout=20)
if __name__=='__main__':unittest.main()
