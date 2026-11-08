#!/usr/bin/env python3
"""Run the actual patched SDK camera loop under deterministic RTOS/driver stubs.
No board access. MODDABLE must point at the SDK used for the firmware build.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SDK = Path(os.environ['MODDABLE'])
SOURCE = (SDK / 'modules/io/imagein/camera/esp32/camera.c').read_text()
LOOP = SOURCE[SOURCE.index('static void cameraLoop(void *pvParameter)'):SOURCE.index('\nstatic int formatToCamFormat', SOURCE.index('static void cameraLoop(void *pvParameter)'))]
# Header mirrors the external RTOS/driver ABI subset used by cameraLoop.
HEADER = r'''
#include <stdint.h>
#include <stdbool.h>
#include <stdlib.h>
#include <assert.h>
#include <stdio.h>
#define ESP_OK 0
#define portMAX_DELAY 999
#define pdTRUE 1
#define C_NULL NULL
#define kCameraFrameCount 2
#define kCommodettoBitmapGray16 4
#define PocoMakePixelGray16(r,g,b) 0
#define kStateInitializing 1
#define kStateIdle 2
#define kStateRunning 3
#define kStateStopping 4
#define kStateClosing 5
#define kStateTerminated 6
#define kCameraStateFree 0
#define kCameraStatePreparing 1
#define kCameraStateReady 2
#define kCameraStateClient 3
typedef struct {int width,height,len; unsigned char *buf;} camera_fb_t;
typedef struct {uint32_t id,dataLength;int state;camera_fb_t *fb;void *data;} Frame;
typedef Frame *CameraFrame;
typedef struct {int initErr,mutex,state,width,height,swap16,imageType,calling;uint32_t frameID;void *task,*onReadable,*the;Frame frames[2];} CameraRecord;
typedef CameraRecord *Camera;
static int camera_config, captures, pending, stopped, scenario;
static Camera current;
static unsigned char pixels[8];
static camera_fb_t fb={2,2,8,pixels};
static int esp_camera_init(void *p){return scenario==3?1:0;}
static void xSemaphoreTake(int m,int delay){}
static void xSemaphoreGive(int m){}
static camera_fb_t *esp_camera_fb_get(void){
  if(++captures>4)exit(91); /* Regression: running loop never consumes close. */
  pending = scenario==1?kStateStopping:kStateClosing;
  return scenario==4?NULL:&fb;
}
static void esp_camera_fb_return(camera_fb_t *f){}
static int xTaskNotifyWait(int a,int b,uint32_t *out,int delay){
  if(pending){*out=pending;pending=0;return pdTRUE;}
  if(delay==portMAX_DELAY){
    assert(current->state==kStateIdle);
    stopped++;
    *out=kStateClosing;
    return pdTRUE;
  }
  return 0;
}
static void modMessagePostToMachine(void *a,void*b,int c,void*d,void*e){}
static void deliverCallbacks(void){}
static void esp_camera_deinit(void){}
static void vTaskDelete(void *p){}
'''
MAIN = r'''
int main(int argc,char **argv){
 scenario=atoi(argv[1]);
 CameraRecord c={0};current=&c;c.task=(void*)1;c.state=kStateRunning;c.width=2;
 /* Start notification places the real loop into continuous capture. */
 pending=kStateRunning;
 cameraLoop(&c);
 assert(c.state==kStateTerminated && c.task==NULL);
 assert(captures==(scenario==3?0:1));
 assert(stopped==(scenario==1?1:0));
 return 0;
}
'''


class NativeLoopTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.binary = Path(cls.temp.name) / 'loop'
        source = Path(cls.temp.name) / 'loop.c'
        source.write_text(HEADER + LOOP + MAIN)
        subprocess.run(['/usr/bin/cc', '-std=c11', str(source), '-o', str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_stop_is_consumed_during_continuous_capture(self):
        subprocess.run([str(self.binary), '1'], check=True, timeout=2)

    def test_close_is_consumed_during_continuous_capture(self):
        subprocess.run([str(self.binary), '2'], check=True, timeout=2)

    def test_driver_timeout_still_services_close(self):
        subprocess.run([str(self.binary), '4'], check=True, timeout=2)

    def test_init_failure_terminates_without_capture(self):
        subprocess.run([str(self.binary), '3'], check=True, timeout=2)


if __name__ == '__main__':
    unittest.main()
