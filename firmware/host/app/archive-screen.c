#include "xsmc.h"
#include "xsHost.h"
#include "commodettoPixelsOut.h"
#include "esp_heap_caps.h"
#include <string.h>
#include "archive-screen-copy.h"
static PixelsOutDispatchRecord capture_dispatch;
static PixelsOutDispatch original_dispatch;
static void *display_ref;
static unsigned char *live_pixels,*snapshot_pixels;
static int screen_width,screen_height,rect_x,rect_y,rect_w,rect_h,cursor;
static unsigned capture_id,updates,overruns;
static int capture_waiting,capture_ready;
static void capture_begin(void *ref,CommodettoCoordinate x,CommodettoCoordinate y,CommodettoDimension w,CommodettoDimension h){
    rect_x=x;rect_y=y;rect_w=w;rect_h=h;cursor=0;
    original_dispatch->doBegin(ref,x,y,w,h);
}
static void capture_send(PocoPixel *pixels,int byteLength,void *ref){
    int bytes=byteLength<0?-byteLength:byteLength;
    if(live_pixels&&rect_w>0){
        if(cursor+bytes/2>rect_w*rect_h)overruns++;
        sc_screen_copy(live_pixels,screen_width,screen_height,rect_x,rect_y,rect_w,rect_h,&cursor,(const unsigned char *)pixels,bytes);
    }
    original_dispatch->doSend(pixels,byteLength,ref);
}
static void capture_complete(void){
    updates++;
    if(capture_waiting){memcpy(snapshot_pixels,live_pixels,screen_width*screen_height*2);capture_id++;capture_ready=1;capture_waiting=0;}
}
static void capture_end(void *ref){original_dispatch->doEnd(ref);capture_complete();}
void xs_screen_capture_request(xsMachine *the){if(!live_pixels)xsUnknownError("Display mirror unavailable");capture_waiting=1;capture_ready=0;}
void xs_screen_capture_ready(xsMachine *the){xsmcSetBoolean(xsResult,capture_ready);}
void xs_screen_capture_complete(xsMachine *the){capture_complete();}
void xs_screen_capture_install(xsMachine *the){
    if(display_ref){xsmcSetBoolean(xsResult,1);return;}
#if kCommodettoBitmapFormat != kCommodettoBitmapRGB565LE && kCommodettoBitmapFormat != kCommodettoBitmapRGB565BE
    xsUnknownError("Screen capture requires RGB565");
#endif
    int w=xsmcToInteger(xsArg(1)),h=xsmcToInteger(xsArg(2));
    if(w!=320||h!=240)xsRangeError("Unsupported display dimensions");
    void *ref=xsmcGetHostData(xsArg(0));if(!ref)xsUnknownError("Display unavailable");
    live_pixels=heap_caps_calloc(w*h,2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    snapshot_pixels=heap_caps_malloc(w*h*2,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
    if(!live_pixels||!snapshot_pixels){heap_caps_free(live_pixels);heap_caps_free(snapshot_pixels);live_pixels=snapshot_pixels=NULL;xsUnknownError("Screen capture memory unavailable");}
    screen_width=w;screen_height=h;display_ref=ref;
    original_dispatch=*(PixelsOutDispatch *)ref;
    memcpy(&capture_dispatch,original_dispatch,sizeof(capture_dispatch));
    capture_dispatch.doBegin=capture_begin;capture_dispatch.doSend=capture_send;capture_dispatch.doEnd=capture_end;
    *(PixelsOutDispatch *)ref=&capture_dispatch;
    xsmcSetBoolean(xsResult,1);
}
void xs_screen_capture_region(xsMachine *the){
    rect_x=xsmcToInteger(xsArg(0));rect_y=xsmcToInteger(xsArg(1));rect_w=xsmcToInteger(xsArg(2));rect_h=xsmcToInteger(xsArg(3));cursor=0;
}
void xs_screen_capture_begin(xsMachine *the){
    xsmcVars(1);
    if(!capture_ready)xsUnknownError("Display has not completed the requested redraw");
    xsmcSetNewObject(xsResult);
#define SC_PROP(name,value) xsmcSetInteger(xsVar(0),value);xsmcSet(xsResult,xsID(name),xsVar(0))
    SC_PROP("width",screen_width);SC_PROP("height",screen_height);SC_PROP("bytes",screen_width*screen_height*2);SC_PROP("id",capture_id);SC_PROP("updates",updates);SC_PROP("overruns",overruns);
    xsmcSetBoolean(xsVar(0),kCommodettoBitmapFormat==kCommodettoBitmapRGB565LE);xsmcSet(xsResult,xsID("littleEndian"),xsVar(0));
#undef SC_PROP
}
void xs_screen_capture_read(xsMachine *the){
    int id=xsmcToInteger(xsArg(0)),offset=xsmcToInteger(xsArg(1)),length=xsmcToInteger(xsArg(2));
    if(!snapshot_pixels||!capture_ready||(unsigned)id!=capture_id)xsUnknownError("Screenshot replaced; retry capture");
    if(offset<0||length<1||length>8192||offset+length>screen_width*screen_height*2)xsRangeError("Invalid screenshot range");
    xsmcSetArrayBuffer(xsResult,snapshot_pixels+offset,length);
}
