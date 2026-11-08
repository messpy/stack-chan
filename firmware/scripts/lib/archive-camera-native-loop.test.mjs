import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {test} from 'node:test'
const exec=promisify(execFile)

test('native worker consumes stop/close while streaming, full, or frame acquisition fails',async()=>{
 const native=await fs.readFile(new URL('../../host/modules/camera/device/native/camera.c',import.meta.url),'utf8')
 // Compile the actual production worker, supplying only RTOS/driver boundaries.
 const start=native.indexOf('static void cameraLoop(void *pvParameter)'),end=native.indexOf('\nstatic int formatToCamFormat',start)
 if(start<0||end<0)throw Error('Native worker boundary unavailable')
 const loop=native.slice(start,end)
 const source=String.raw`
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <assert.h>
#define ESP_OK 0
#define ESP_FAIL -1
#define pdTRUE 1
#define portMAX_DELAY 999
#define kCameraFrameCount 3
#define C_NULL NULL
#define kCommodettoBitmapGray16 7
#define PocoMakePixelGray16(r,g,b) 0
#define kCameraStateFree 0
#define kCameraStatePreparing 1
#define kCameraStateReady 2
enum {kStateInitializing,kStateIdle,kStateRunning,kStateStopping,kStateClosing,kStateTerminated};
typedef struct {unsigned width,height,len;void *buf;} camera_fb_t;
typedef struct {camera_fb_t *fb;void *data;unsigned dataLength,id,state;} Frame;
typedef Frame *CameraFrame;
typedef struct {int initErr;volatile unsigned state;unsigned width,height,frameID;int swap16,imageType,calling,closeRequested,onReadable;void *mutex,*task,*the;Frame frames[3];} Record,*Camera;
static int mode,step,gets,returned,deinitialized,posts;static uint32_t pixels[4];
static camera_fb_t fb={2,2,16,pixels};static int camera_config;
static int esp_camera_init(void*p){return 0;}
static int xSemaphoreTake(void*p,int timeout){return 1;}
static void xSemaphoreGive(void*p){}
static void vTaskDelete(void*p){}
static void vTaskDelay(int ticks){}
static void esp_camera_deinit(void){deinitialized++;}
static void esp_camera_fb_return(camera_fb_t*p){returned++;}
static camera_fb_t *esp_camera_fb_get(void){assert(++gets<8);return mode>=2?NULL:&fb;}
static int xTaskNotifyWait(unsigned a,unsigned b,uint32_t*out,int timeout){
 if(mode==3){assert(timeout==0);return 0;}

 if(step++==0){assert(timeout==portMAX_DELAY);*out=kStateRunning;}
 else if(step==2){assert(timeout==0);*out=kStateStopping;}
 else {assert(timeout==portMAX_DELAY);*out=kStateClosing;}
 return pdTRUE;
}
static void deliverCallbacks(void*a,void*b,uint8_t*c,uint16_t d){}
static void modMessagePostToMachine(void*a,void*b,int c,void*d,void*e){posts++;}
`+loop+String.raw`
int main(void){
 for(mode=0;mode<3;mode++){
  Record c={.width=2,.state=kStateIdle,.task=(void*)1,.onReadable=1};
  step=gets=returned=deinitialized=posts=0;
  if(mode==1)for(int i=0;i<3;i++)c.frames[i].state=kCameraStateReady;
  cameraLoop(&c);
  assert(step==3&&gets==(mode==1?0:1)&&deinitialized==1&&c.state==kStateTerminated);
  assert(posts==(mode==0?1:0));assert(returned==0);
 }
 Record failed={.state=kStateInitializing,.task=(void*)1};mode=3;gets=deinitialized=0;cameraLoop(&failed);assert(failed.initErr==ESP_FAIL&&failed.state==kStateTerminated&&deinitialized==1);
 return 0;
}
`
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stackchan-native-camera-'))
 try{
  await fs.writeFile(path.join(dir,'test.c'),source)
  await exec('cc',['-std=c11','-Werror=implicit-function-declaration',path.join(dir,'test.c'),'-o',path.join(dir,'test')])
  await exec(path.join(dir,'test'),[],{timeout:5000})
 }finally{await fs.rm(dir,{recursive:true,force:true})}
})

test('explicit native close terminates before queued callback drains and frees its record once',async()=>{
 const native=await fs.readFile(new URL('../../host/modules/camera/device/native/camera.c',import.meta.url),'utf8')
 const extract=(from,to)=>{const a=native.indexOf(from),b=native.indexOf(to,a);if(a<0||b<a)throw Error('Native boundary missing');return native.slice(a,b)}
 const callbacks=extract('static void deliverCallbacks(', 'static void cameraLoop(')
 const teardown=extract('void xs_camera_destructor(void *it)', 'void xs_camera_mark(')
 const source=String.raw`
#include <stdint.h>
#include <stddef.h>
#include <assert.h>
typedef void xsMachine;typedef int xsSlot;
#define kCameraFrameCount 3
#define kCameraStateReady 2
#define kStateRunning 2
#define kStateClosing 4
#define kStateTerminated 5
#define eSetValueWithOverwrite 0
#define portMAX_DELAY 99
#define xsThis 0
#define xsReference(x) 0
#define xsInteger(x) 0
#define xsmcGetHostData(x) current
#define xsmcGetHostDataValidate(x,y) current
#define xsmcSetHostData(x,y) (current=NULL)
#define xsmcSetHostDestructor(x,y) ((void)0)
#define xsForget(x) ((void)0)
typedef struct {int state,id;unsigned dataLength;} Frame,*CameraFrame;
typedef struct {int state,calling,closeRequested,object;void *task,*mutex,*onReadable;Frame frames[3];} Record,*Camera;
static Camera current;static int freed,deleted,notified,jsCalls;
static void c_free(void*p){freed++;}
static void vSemaphoreDelete(void*p){deleted++;}
static void xTaskNotify(void*task,int state,int mode){Camera c=task;notified++;c->state=kStateTerminated;c->task=NULL;}
static void modDelayMilliseconds(int ms){assert(0);}
static void xSemaphoreTake(void*p,int n){}
static void xSemaphoreGive(void*p){}
static void xsBeginHost(void*p){}
static void xsEndHost(void*p){}
static void xsCallFunction1(int a,int b,int c){jsCalls++;}
void xs_camera_destructor(void*);
`+callbacks+teardown+String.raw`
int main(void){
 for(int pending=0;pending<2;pending++){
  Record c={.state=kStateRunning,.calling=pending,.mutex=(void*)1};c.task=&c;current=&c;
  freed=deleted=notified=jsCalls=0;
  xs_camera_close(NULL);
  assert(current==NULL&&notified==1&&deleted==1&&c.state==kStateTerminated);
  assert(freed==(pending?0:1));
  if(pending)deliverCallbacks(NULL,&c,NULL,0);
  assert(freed==1&&deleted==1&&jsCalls==0);
 }
 return 0;
}
`
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stackchan-native-close-'))
 try{
  await fs.writeFile(path.join(dir,'test.c'),source)
  await exec('cc',['-std=c11','-Werror=implicit-function-declaration',path.join(dir,'test.c'),'-o',path.join(dir,'test')])
  await exec(path.join(dir,'test'),[],{timeout:5000})
 }finally{await fs.rm(dir,{recursive:true,force:true})}
})
