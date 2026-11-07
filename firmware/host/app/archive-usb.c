#include "xsmc.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "xsHost.h"
#include "driver/usb_serial_jtag.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <string.h>
#include "archive-vault-crypto.h"

#define ARCHIVE_USB_PACKET_LIMIT 20000
// The full 20 KiB authenticated USB RPC frame formerly occupied internal BSS
// even with no USB host attached. Keep this long-lived receive buffer in PSRAM;
// DMA-capable driver RX/TX rings remain in the memory chosen by ESP-IDF.
#define ARCHIVE_USB_LINE_BYTES (ARCHIVE_USB_PACKET_LIMIT + 5)
static char *line;
static size_t used;
static int dropping;
static void ensureUSBReceiveBuffer(xsMachine *the) {
    if (line) return;
    line = heap_caps_malloc(ARCHIVE_USB_LINE_BYTES, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!line) xsUnknownError("USB receive PSRAM unavailable");
}
static void ensureUSB(xsMachine *the) {
    if (!usb_serial_jtag_is_driver_installed()) {
        usb_serial_jtag_driver_config_t config = {.rx_buffer_size=4096,.tx_buffer_size=4096};
        if (usb_serial_jtag_driver_install(&config) != ESP_OK) xsUnknownError("USB initialization failed");
    }
}
void xs_archive_usb_read(xsMachine *the) {
    ensureUSB(the);
    ensureUSBReceiveBuffer(the);
    unsigned char c;
    while (usb_serial_jtag_read_bytes(&c,1,0)==1) {
        if (c=='\n') {
            if (dropping) {dropping=0;used=0;continue;}
            line[used]=0;used=0;
            if (strncmp(line,"@SC ",4)==0) {xsmcSetString(xsResult,line+4);return;}
        } else if(c!='\r' && !dropping) {
            if (used<ARCHIVE_USB_LINE_BYTES-1) line[used++]=c;
            else {dropping=1;used=0;}
        }
    }
}
void xs_archive_usb_write(xsMachine *the) {
    ensureUSB(the);
    const char *text=xsmcToString(xsArg(0));
    size_t length=strlen(text);
    if (length>ARCHIVE_USB_PACKET_LIMIT) xsRangeError("USB packet too large");
    usb_serial_jtag_write_bytes("\n@SC ",5,pdMS_TO_TICKS(2000));
    while(length) {
        int sent=usb_serial_jtag_write_bytes(text,length>1024?1024:length,pdMS_TO_TICKS(2000));
        if(sent<=0)xsUnknownError("USB write timeout");
        text+=sent;length-=sent;
    }
    usb_serial_jtag_write_bytes("\n",1,pdMS_TO_TICKS(2000));
}

void xs_archive_usb_reboot(xsMachine *the) { usb_serial_jtag_wait_tx_done(pdMS_TO_TICKS(200)); esp_restart(); }

// Independent of the XS event loop: recover from a stuck synchronous camera/JPEG/SD call.
// Only the active still-photo path may arm this guard. 60s is well above normal capture time.
#define SC_PHOTO_WATCHDOG_US 60000000LL
static esp_timer_handle_t sc_photo_watchdog_timer;
static void sc_photo_watchdog_fire(void *arg) {
    (void)arg;
    esp_restart();
}
void xs_archive_photo_watchdog(xsMachine *the) {
    const bool enable = xsmcToBoolean(xsArg(0));
    if (!enable) {
        if (sc_photo_watchdog_timer)
            (void)esp_timer_stop(sc_photo_watchdog_timer);
        return;
    }
    if (!sc_photo_watchdog_timer) {
        const esp_timer_create_args_t args = {
            .callback = sc_photo_watchdog_fire,
            .dispatch_method = ESP_TIMER_TASK,
            .name = "sc_photo_guard"
        };
        esp_err_t error = esp_timer_create(&args, &sc_photo_watchdog_timer);
        if (error != ESP_OK) xsUnknownError("Camera recovery watchdog unavailable");
    }
    // Stopping a not-yet-running timer returns ESP_ERR_INVALID_STATE, which is safe.
    (void)esp_timer_stop(sc_photo_watchdog_timer);
    if (esp_timer_start_once(sc_photo_watchdog_timer, SC_PHOTO_WATCHDOG_US) != ESP_OK)
        xsUnknownError("Camera recovery watchdog start failed");
}


void xs_archive_rgb24(xsMachine *the) {
    void *data; xsUnsignedValue length;
    xsmcGetBufferReadable(xsArg(0), &data, &length);
    int w=xsmcToInteger(xsArg(1)), h=xsmcToInteger(xsArg(2));
    int little=xsmcToBoolean(xsArg(3));
    if(w<1 || h<1 || w>640 || h>480 || length<(unsigned)(w*h*2))xsRangeError("Invalid RGB frame");
    int stride=(w*3+3)&~3;
    xsmcSetArrayBuffer(xsResult,NULL,stride*h);
    unsigned char *out=xsmcToArrayBuffer(xsResult), *src=data;
    memset(out,0,stride*h);
    for(int y=0;y<h;y++)for(int x=0;x<w;x++){
        int i=(y*w+x)*2;
        unsigned v=little?(src[i]|(src[i+1]<<8)):((src[i]<<8)|src[i+1]);
        int p=(h-1-y)*stride+x*3;
        out[p]=((v&31)*255+15)/31;
        out[p+1]=(((v>>5)&63)*255+31)/63;
        out[p+2]=(((v>>11)&31)*255+15)/31;
    }
}

#include "nvs_flash/include/nvs.h"
#include "esp_random.h"
#include "psa/crypto.h"

static void archive_vault_key(xsMachine *the, unsigned char key[32]) {
    nvs_handle_t handle;
    if (nvs_open("scfgkey", NVS_READWRITE, &handle) != ESP_OK) xsUnknownError("Settings key unavailable");
    size_t size = 32;
    esp_err_t error = nvs_get_blob(handle, "key", key, &size);
    if (error == ESP_ERR_NVS_NOT_FOUND) {
        esp_fill_random(key, 32);
        error = nvs_set_blob(handle, "key", key, 32);
        if (error == ESP_OK) error = nvs_commit(handle);
        size = 32;
    }
    nvs_close(handle);
    if (error != ESP_OK || size != 32) { memset(key,0,32); xsUnknownError("Settings key unavailable"); }
}

void xs_archive_random(xsMachine *the) {
    unsigned char data[16]; esp_fill_random(data,sizeof(data));
    xsmcSetArrayBuffer(xsResult,data,sizeof(data));
}

static psa_key_id_t archive_import_vault_key(xsMachine *the) {
    if (psa_crypto_init()!=PSA_SUCCESS) xsUnknownError("Settings crypto unavailable");
    unsigned char key[32]; archive_vault_key(the,key);
    psa_key_attributes_t attributes=PSA_KEY_ATTRIBUTES_INIT;
    psa_set_key_usage_flags(&attributes,PSA_KEY_USAGE_ENCRYPT|PSA_KEY_USAGE_DECRYPT);
    psa_set_key_algorithm(&attributes,PSA_ALG_GCM);
    psa_set_key_type(&attributes,PSA_KEY_TYPE_AES);
    psa_set_key_bits(&attributes,256);
    psa_key_id_t identifier=0;
    psa_status_t result=psa_import_key(&attributes,key,sizeof(key),&identifier);
    volatile unsigned char *wipe=key;
    for(size_t i=0;i<sizeof(key);i++)wipe[i]=0;
    psa_reset_key_attributes(&attributes);
    if(result!=PSA_SUCCESS)xsUnknownError("Settings crypto key unavailable");
    return identifier;
}

void xs_archive_seal(xsMachine *the) {
    void *input; xsUnsignedValue size;
    xsmcGetBufferReadable(xsArg(0),&input,&size);
    if(size>65536)xsRangeError("Settings too large");
    xsmcSetArrayBuffer(xsResult,NULL,size+36);
    xsmcGetBufferReadable(xsArg(0),&input,&size);
    unsigned char *output=xsmcToArrayBuffer(xsResult);
    memcpy(output,"SCFGDB01",8);esp_fill_random(output+8,12);
    psa_key_id_t identifier=archive_import_vault_key(the);
    size_t written=0;
    psa_status_t result=sc_vault_encrypt(identifier,output+8,output,8,input,size,output+20,size+16,&written);
    psa_destroy_key(identifier);
    if(result!=PSA_SUCCESS||written!=size+16)xsUnknownError("Settings encryption failed (PSA code=%d)",(int)result);
}

void xs_archive_open(xsMachine *the) {
    void *input;xsUnsignedValue size;
    xsmcGetBufferReadable(xsArg(0),&input,&size);
    if(size<36||size>65572||memcmp(input,"SCFGDB01",8))xsUnknownError("Invalid encrypted settings");
    xsmcSetArrayBuffer(xsResult,NULL,size-36);
    xsmcGetBufferReadable(xsArg(0),&input,&size);
    unsigned char *source=input,*output=xsmcToArrayBuffer(xsResult);
    psa_key_id_t identifier=archive_import_vault_key(the);
    size_t written=0;
    psa_status_t result=sc_vault_decrypt(identifier,source+8,source,8,source+20,size-20,output,size-36,&written);
    psa_destroy_key(identifier);
    if(result!=PSA_SUCCESS||written!=size-36){memset(output,0,size-36);xsUnknownError("Settings authentication failed");}
}

#include "img_converters.h"
#include <stdlib.h>
void xs_archive_jpeg(xsMachine *the) {
 void *data;xsUnsignedValue size;xsmcGetBufferReadable(xsArg(0),&data,&size);
 int width=xsmcToInteger(xsArg(1)),height=xsmcToInteger(xsArg(2));
 if(width<1||height<1||width>320||height>240||size<(size_t)width*height*2)xsRangeError("Invalid camera frame");
 uint8_t *jpeg=NULL;size_t length=0;bool little=xsmcToBoolean(xsArg(3));
 jpgSetRgb565BE(!little);
 bool ok=fmt2jpg(data,(size_t)width*height*2,width,height,PIXFORMAT_RGB565,80,&jpeg,&length);
 jpgSetRgb565BE(true);
 if(!ok||!jpeg||!length){free(jpeg);xsUnknownError("JPEG encoding failed");}
 xsTry {xsmcSetArrayBuffer(xsResult,jpeg,length);} xsCatch {free(jpeg);xsThrow(xsException);}
 free(jpeg);
}

void xs_archive_usb_connected(xsMachine *the) {
    xsmcSetBoolean(xsResult, usb_serial_jtag_is_connected());
}

#include "esp_log.h"
#include <stdarg.h>
#include <stdio.h>
#define SC_LOG_SLOTS 128
#define SC_LOG_SIZE 2048
static char (*sc_logs)[SC_LOG_SIZE];
static unsigned sc_log_head,sc_log_count,sc_log_dropped,sc_log_truncated,sc_log_usb_dropped;
static portMUX_TYPE sc_log_mux=portMUX_INITIALIZER_UNLOCKED;
static void sc_log_push(const char *text) {
    if(!sc_logs)return;
    size_t n=strlen(text);
    portENTER_CRITICAL(&sc_log_mux);
    if(sc_log_count==SC_LOG_SLOTS){sc_log_head=(sc_log_head+1)%SC_LOG_SLOTS;sc_log_count--;sc_log_dropped++;}
    unsigned slot=(sc_log_head+sc_log_count)%SC_LOG_SLOTS;
    if(n>=SC_LOG_SIZE){n=SC_LOG_SIZE-1;while(n>0&&(((unsigned char)text[n]&0xc0)==0x80))n--;sc_log_truncated++;}
    memcpy(sc_logs[slot],text,n);sc_logs[slot][n]=0;sc_log_count++;
    portEXIT_CRITICAL(&sc_log_mux);
}
static int sc_log_printf(const char *format,va_list args) {
    char text[SC_LOG_SIZE];int n=vsnprintf(text,sizeof(text),format,args);
    if(n>=SC_LOG_SIZE){portENTER_CRITICAL(&sc_log_mux);sc_log_truncated++;portEXIT_CRITICAL(&sc_log_mux);}
    sc_log_push(text);return n;
}
void xs_archive_log_init(xsMachine *the) {
    if(!sc_logs){
        sc_logs=heap_caps_calloc(SC_LOG_SLOTS,SC_LOG_SIZE,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT);
        if(!sc_logs)xsUnknownError("Debug log memory unavailable");
        esp_log_set_vprintf(sc_log_printf);
        char text[80];snprintf(text,sizeof(text),"[boot] reset_reason=%d log_buffer=128\n",(int)esp_reset_reason());sc_log_push(text);
    }
}
void xs_archive_log_push(xsMachine *the) {sc_log_push(xsmcToString(xsArg(0)));}
void xs_archive_log_pop(xsMachine *the) {
    char text[SC_LOG_SIZE];int found=0;
    portENTER_CRITICAL(&sc_log_mux);
    if(sc_logs&&sc_log_count){memcpy(text,sc_logs[sc_log_head],sizeof(text));sc_log_head=(sc_log_head+1)%SC_LOG_SLOTS;sc_log_count--;found=1;}
    portEXIT_CRITICAL(&sc_log_mux);
    if(found)xsmcSetString(xsResult,text);
}
void xs_archive_log_status(xsMachine *the) {
    xsmcVars(1);
    unsigned queued,dropped,truncated,usbDropped;
    portENTER_CRITICAL(&sc_log_mux);queued=sc_log_count;dropped=sc_log_dropped;truncated=sc_log_truncated;usbDropped=sc_log_usb_dropped;portEXIT_CRITICAL(&sc_log_mux);
    xsmcSetNewObject(xsResult);
    xsmcSetInteger(xsVar(0),queued);xsmcSet(xsResult,xsID("queued"),xsVar(0));
    xsmcSetInteger(xsVar(0),dropped);xsmcSet(xsResult,xsID("dropped"),xsVar(0));
    xsmcSetInteger(xsVar(0),truncated);xsmcSet(xsResult,xsID("truncated"),xsVar(0));
    xsmcSetInteger(xsVar(0),usbDropped);xsmcSet(xsResult,xsID("usbRetries"),xsVar(0));
}

void xs_archive_debug_write(xsMachine *the) {
    const char *text=xsmcToString(xsArg(0));size_t length=strlen(text);
    if(length>3500){sc_log_usb_dropped++;xsmcSetBoolean(xsResult,0);return;}
    ensureUSB(the);
    char packet[3510];memcpy(packet,"\n@SC ",5);memcpy(packet+5,text,length);packet[length+5]='\n';
    int sent=usb_serial_jtag_write_bytes(packet,length+6,0);
    if(sent!=(int)length+6)sc_log_usb_dropped++;
    xsmcSetBoolean(xsResult,sent==(int)length+6);
}

// Small scalar-only RAM snapshot; no allocation contents or keys are exposed.
void xs_archive_heap_status(xsMachine *the) {
    xsmcVars(1);
    xsmcSetNewObject(xsResult);
    const uint32_t internal=MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT;
    const uint32_t external=MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT;
#define SC_HEAP_FIELD(name,value) xsmcSetInteger(xsVar(0),(int)(value));xsmcSet(xsResult,xsID(name),xsVar(0))
    SC_HEAP_FIELD("nativeStackMinimumFree",uxTaskGetStackHighWaterMark(NULL)*sizeof(StackType_t));
    SC_HEAP_FIELD("internalFree",heap_caps_get_free_size(internal));
    SC_HEAP_FIELD("internalMinimum",heap_caps_get_minimum_free_size(internal));
    SC_HEAP_FIELD("internalLargest",heap_caps_get_largest_free_block(internal));
    SC_HEAP_FIELD("internalTotal",heap_caps_get_total_size(internal));
    SC_HEAP_FIELD("psramFree",heap_caps_get_free_size(external));
    SC_HEAP_FIELD("psramMinimum",heap_caps_get_minimum_free_size(external));
    SC_HEAP_FIELD("psramLargest",heap_caps_get_largest_free_block(external));
    SC_HEAP_FIELD("psramTotal",heap_caps_get_total_size(external));
    SC_HEAP_FIELD("usbRxPSRAMBytes",line ? ARCHIVE_USB_LINE_BYTES : 0);
#undef SC_HEAP_FIELD
}

#include <math.h>
#include "archive-recognition-pcm.h"
void xs_archive_recognition_pcm(xsMachine *the) {
    xsmcVars(2);
    void *input,*output;xsUnsignedValue length,outputLength;
    xsmcGetBufferReadable(xsArg(0),&input,&length);
    int offset=xsmcToInteger(xsArg(1)),size=xsmcToInteger(xsArg(2)),channels=xsmcToInteger(xsArg(3));
    int gain=xsmcArgc>4?xsmcToInteger(xsArg(4)):4;
    if((channels!=1&&channels!=2)||offset<0||size<0||(offset&1)||size%(channels*2)||(uint64_t)offset+(uint64_t)size>length)xsRangeError("Invalid microphone PCM");
    if(gain<1)gain=1;else if(gain>8)gain=8;
    xsmcSetArrayBuffer(xsVar(0),NULL,size/channels);
    // Reacquire pointers after allocation; JS values remain rooted in args/vars.
    xsmcGetBufferReadable(xsArg(0),&input,&length);
    xsmcGetBufferWritable(xsVar(0),&output,&outputLength);
    ScRecognitionPCM stats=sc_recognition_pcm((const int16_t*)((const uint8_t*)input+offset),output,size/(channels*2),channels,gain);
    xsmcSetNewObject(xsResult);xsmcSet(xsResult,xsID("buffer"),xsVar(0));
#define SC_PCM_FIELD(name,value) xsmcSetInteger(xsVar(1),(int)(value));xsmcSet(xsResult,xsID(name),xsVar(1))
    SC_PCM_FIELD("channel",stats.channel);
    SC_PCM_FIELD("frames",stats.frames);
    SC_PCM_FIELD("peak",stats.peak);
    SC_PCM_FIELD("rms",sqrt((double)stats.output_energy/(stats.frames?stats.frames:1))+0.5);
    SC_PCM_FIELD("leftRms",sqrt((double)stats.left_energy/(stats.frames?stats.frames:1))+0.5);
    SC_PCM_FIELD("rightRms",sqrt((double)stats.right_energy/(stats.frames?stats.frames:1))+0.5);
#undef SC_PCM_FIELD
}

void xs_archive_collect_memory(xsMachine *the) { xsCollectGarbage(); }
