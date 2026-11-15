#include "xs.h"
#include "xsmc.h"
#include "driver/rmt_tx.h"
#include "driver/rmt_rx.h"
#include "driver/rmt_encoder.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include <string.h>
// Only the external CoreS3 Port A pair. Never touch camera, USB, servo or power pins.
static int valid_pin(int pin) { return pin == 1 || pin == 2; }
static rmt_channel_handle_t receiver;
static QueueHandle_t received;
static rmt_symbol_word_t symbols[512];
static bool on_receive(rmt_channel_handle_t channel, const rmt_rx_done_event_data_t *event, void *arg) {
    BaseType_t wake = pdFALSE;
    size_t count = event->num_symbols;
    xQueueSendFromISR(received, &count, &wake);
    return wake == pdTRUE;
}
static void close_receiver(void) {
    if (receiver) { rmt_disable(receiver); rmt_del_channel(receiver); receiver = NULL; }
    if (received) { vQueueDelete(received); received = NULL; }
}
void xs_archive_ir_close(xsMachine *the) { close_receiver(); }
void xs_archive_ir_receive_start(xsMachine *the) {
    int pin = xsmcToInteger(xsArg(0));
    if (!valid_pin(pin)) xsRangeError("IR requires external Port A GPIO 1/2");
    close_receiver();
    received = xQueueCreate(1, sizeof(size_t));
    if (!received) xsUnknownError("IR memory unavailable");
    rmt_rx_channel_config_t cfg = {.gpio_num=pin,.clk_src=RMT_CLK_SRC_DEFAULT,.resolution_hz=1000000,.mem_block_symbols=512,.flags.with_dma=1};
    rmt_rx_event_callbacks_t callbacks = {.on_recv_done=on_receive};
    rmt_receive_config_t timing = {.signal_range_min_ns=100000,.signal_range_max_ns=15000000};
    if (rmt_new_rx_channel(&cfg,&receiver) != ESP_OK || rmt_rx_register_event_callbacks(receiver,&callbacks,NULL) != ESP_OK || rmt_enable(receiver) != ESP_OK || rmt_receive(receiver,symbols,sizeof(symbols),&timing) != ESP_OK) {
        close_receiver(); xsUnknownError("IR receiver unavailable");
    }
}
void xs_archive_ir_receive_poll(xsMachine *the) {
    size_t count=0;
    if (!receiver || !received || xQueueReceive(received,&count,0) != pdTRUE) { xsmcSetNull(xsResult); return; }
    if (count < 2 || count >= 512) { close_receiver(); xsUnknownError("IR signal too short or long"); }
    uint16_t durations[1024]; size_t n=0;
    // A demodulating receiver idles high; start at the first low mark.
    bool started=false;
    for (size_t i=0;i<count;i++) {
        if (!started && symbols[i].duration0 && symbols[i].level0==0) started=true;
        if (started && symbols[i].duration0) durations[n++]=symbols[i].duration0;
        if (!started && symbols[i].duration1 && symbols[i].level1==0) started=true;
        if (started && symbols[i].duration1) durations[n++]=symbols[i].duration1;
    }
    close_receiver();
    if (n<3) xsUnknownError("IR signal invalid");
    xsmcSetArrayBuffer(xsResult,durations,n*sizeof(uint16_t));
}
void xs_archive_ir_transmit(xsMachine *the) {
    int pin=xsmcToInteger(xsArg(0)),carrier=xsmcToInteger(xsArg(2));
    void *data; xsUnsignedValue bytes;
    xsmcGetBufferReadable(xsArg(1),&data,&bytes);
    if (!valid_pin(pin)||carrier<30000||carrier>56000||bytes<6||bytes>2048||bytes%2||receiver) xsRangeError("Invalid IR transmission");
    uint16_t *durations=data; size_t n=bytes/2; uint32_t total=0;
    rmt_symbol_word_t tx[512]; memset(tx,0,sizeof(tx));
    for (size_t i=0;i<n;i++) {
        uint16_t d; memcpy(&d,durations+i,2);
        if (d<100||d>15000) xsRangeError("Invalid IR pulse");
        total+=d;
        if(i&1){tx[i/2].duration1=d;tx[i/2].level1=0;}else{tx[i/2].duration0=d;tx[i/2].level0=1;}
    }
    if(total>250000) xsRangeError("IR frame too long");
    rmt_channel_handle_t channel=NULL; rmt_encoder_handle_t encoder=NULL;
    rmt_tx_channel_config_t cfg={.gpio_num=pin,.clk_src=RMT_CLK_SRC_DEFAULT,.resolution_hz=1000000,.mem_block_symbols=64,.trans_queue_depth=1};
    rmt_carrier_config_t wave={.frequency_hz=carrier,.duty_cycle=.33};
    rmt_copy_encoder_config_t copy={}; rmt_transmit_config_t send={.loop_count=0};
    esp_err_t result=rmt_new_tx_channel(&cfg,&channel);
    if(result==ESP_OK)result=rmt_apply_carrier(channel,&wave);
    if(result==ESP_OK)result=rmt_new_copy_encoder(&copy,&encoder);
    bool enabled=false;
    if(result==ESP_OK){result=rmt_enable(channel);enabled=result==ESP_OK;}
    if(result==ESP_OK)result=rmt_transmit(channel,encoder,tx,((n+1)/2)*sizeof(tx[0]),&send);
    if(result==ESP_OK)result=rmt_tx_wait_all_done(channel,500);
    if(enabled)rmt_disable(channel);
    if(encoder)rmt_del_encoder(encoder);
    if(channel)rmt_del_channel(channel);
    if(result!=ESP_OK)xsUnknownError("IR transmit failed");
    xsmcSetBoolean(xsResult,1);
}
