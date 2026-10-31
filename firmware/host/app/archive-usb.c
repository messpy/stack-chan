#include "xsmc.h"
#include "esp_system.h"
#include "xsHost.h"
#include "driver/usb_serial_jtag.h"
#include "freertos/FreeRTOS.h"
#include <string.h>

#define ARCHIVE_USB_PACKET_LIMIT 20000
static char line[ARCHIVE_USB_PACKET_LIMIT + 5];
static size_t used;
static int dropping;
static void ensureUSB(xsMachine *the) {
    if (!usb_serial_jtag_is_driver_installed()) {
        usb_serial_jtag_driver_config_t config = {.rx_buffer_size=4096,.tx_buffer_size=4096};
        if (usb_serial_jtag_driver_install(&config) != ESP_OK) xsUnknownError("USB initialization failed");
    }
}
void xs_archive_usb_read(xsMachine *the) {
    ensureUSB(the);
    unsigned char c;
    while (usb_serial_jtag_read_bytes(&c,1,0)==1) {
        if (c=='\n') {
            if (dropping) {dropping=0;used=0;continue;}
            line[used]=0;used=0;
            if (strncmp(line,"@SC ",4)==0) {xsmcSetString(xsResult,line+4);return;}
        } else if(c!='\r' && !dropping) {
            if (used<sizeof(line)-1) line[used++]=c;
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
    psa_status_t result=psa_aead_encrypt(identifier,PSA_ALG_GCM,output+8,12,output,8,input,size,output+20,size+16,&written);
    psa_destroy_key(identifier);
    if(result!=PSA_SUCCESS||written!=size+16)xsUnknownError("Settings encryption failed");
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
    psa_status_t result=psa_aead_decrypt(identifier,PSA_ALG_GCM,source+8,12,source,8,source+20,size-20,output,size-36,&written);
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
