/*
 * Copyright (c) 2024-2026 Moddable Tech, Inc.
 *
 *   This file is part of the Moddable SDK Runtime.
 *
 *   The Moddable SDK Runtime is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *  
 *   The Moddable SDK Runtime is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with the Moddable SDK Runtime.  If not, see <http://www.gnu.org/licenses/>.  
 *
 */

#include "xsmc.h"
#include "mc.xs.h"
#include "mc.defines.h"

#include "builtinCommon.h"

#include "driver/i2s_pdm.h"
#include "driver/i2s_std.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
// StackChan: serialize queue ownership across the XS machine and native task.
// Never hold this mutex across an XS callback or while joining the native task.

#ifdef MODDEF_AUDIOOUT_AMPLIFIER_POWER
	#include "modGPIO.h"
#endif

#ifndef MODDEF_AUDIOOUT_I2S_SLOT
	#define MODDEF_AUDIOOUT_I2S_SLOT I2S_STD_SLOT_RIGHT
#endif

#ifndef MODDEF_AUDIOOUT_I2S_MCK_PIN
	#define MODDEF_AUDIOOUT_I2S_MCK_PIN I2S_GPIO_UNUSED
#endif

#ifndef MODDEF_AUDIOOUT_I2S_FORMAT_I2S
	#define MODDEF_AUDIOOUT_I2S_FORMAT_I2S 0
#endif

#include "xsHost.h"

#ifdef MODDEF_AUDIOOUT_I2S_PDM_PIN
	uint8_t gPDMAudioOutBusy = 0;
	uint8_t gPDMAudioInBusy __attribute__((weak)) = 0;
#endif

typedef struct AudioOutElementRecord AudioOutElementRecord;
typedef struct AudioOutElementRecord *AudioOutElement;

struct AudioOutElementRecord {
	AudioOutElement		next;

	xsSlot				*completion;
	xsSlot				*buffer;
	void				*data;		// NULL if relocatable
	
	uint32_t			position;
	uint32_t			bytesAvailable;
	
	esp_err_t			err;
};

typedef struct AudioOutRecord AudioOutRecord;
typedef struct AudioOutRecord *AudioOut;

struct AudioOutRecord {
	SemaphoreHandle_t queueMutex;
	xsSlot				obj;
	uint32_t			total_dma_buf_size;
	uint32_t			dma_buf_size;
	uint32_t			bytesWritable;
	uint8_t				useCount;
	uint8_t				started;
	uint8_t closed;
	esp_err_t fault;
	uint8_t				callbackPending;

	uint16_t			sampleRate;
	uint8_t				numChannels;
	uint8_t				bitsPerSample;

	uint8_t				*stagingBuffer;
	uint32_t			stagingOffset;

	i2s_chan_handle_t	tx_handle;

	xsMachine			*the;
	xsSlot				*onWritable;

	double				volumeDouble;
	int16_t				volumeFixed;
	
	AudioOutElement		elements;
	volatile TaskHandle_t		task;

#ifdef MODDEF_AUDIOOUT_AMPLIFIER_POWER
	modGPIOConfigurationRecord	amplifierPower;
	int						bytesInFlight;
#endif
};

static bool playedBuffer(i2s_chan_handle_t handle, i2s_event_data_t *event, void *user_ctx);
static esp_err_t scAudioOutWrite(AudioOut audioOut, void *buffer, xsUnsignedValue bytes);
static void audiooutDeliver(void *theIn, void *refcon, uint8_t *message, uint16_t messageLength);
static void xs_stackchan_audioout_mark_(xsMachine* the, void* it, xsMarkRoot markRoot);
static void stackchanAudioOutLoop(void *pvParameter);

static const xsHostHooks ICACHE_RODATA_ATTR xsAudioOutHooks = {
	xs_stackchan_audioout_destructor_,
	xs_stackchan_audioout_mark_,
	C_NULL
};

static void audioOutRelease(AudioOut audioOut)
{
	__atomic_store_n(&audioOut->closed, true, __ATOMIC_SEQ_CST);
	if (audioOut->task) {
		xTaskNotify(audioOut->task, 2, eSetValueWithOverwrite);	// end task
		while (audioOut->task)
			modDelayMilliseconds(1);
	}

	if (audioOut->tx_handle) {
		i2s_channel_disable(audioOut->tx_handle);
		i2s_del_channel(audioOut->tx_handle);
		audioOut->tx_handle = NULL;
	}
#ifdef MODDEF_AUDIOOUT_I2S_PDM_PIN
	gPDMAudioOutBusy = 0;
#endif

	while (audioOut->elements) {
		AudioOutElement element = audioOut->elements, next = element->next;
		c_free(element);
		audioOut->elements = next;
	}

	if (audioOut->queueMutex) {
		vSemaphoreDelete(audioOut->queueMutex);
		audioOut->queueMutex = NULL;
	}

	if (audioOut->stagingBuffer) {
		c_free(audioOut->stagingBuffer);
		audioOut->stagingBuffer = NULL;
	}
}

void xs_stackchan_audioout_destructor_(void *data)
{
	AudioOut audioOut = data;
	if (!audioOut) return;
	
	audioOutRelease(audioOut);
	c_free(audioOut);
}

static void constructionFailed(xsMachine *the, AudioOut audioOut, const char *stage, esp_err_t error)
{
	xsForget(audioOut->obj);
	audioOutRelease(audioOut);
	xsmcSetHostData(xsThis, C_NULL);
	xsmcSetHostDestructor(xsThis, C_NULL);
	c_free(audioOut);
	xsUnknownError("audio output %s failed (%d)", stage, (int)error);
}

void xs_stackchan_audioout_constructor_(xsMachine *the)
{
	AudioOut audioOut;
	xsSlot *onWritable;
	esp_err_t err;
	int sampleRate = 0;
	int numChannels = 0;
	int bitsPerSample = 0;

	xsmcVars(1);

	if (xsmcGet(xsVar(0), xsArg(0), xsID_sampleRate))
		sampleRate = xsmcToInteger(xsVar(0));
#ifdef MODDEF_AUDIOOUT_SAMPLERATE
	else
		sampleRate = MODDEF_AUDIOOUT_SAMPLERATE;
#endif
	if ((sampleRate < 8000) || (sampleRate > 48000))
		xsRangeError("invalid sample rate");

	if (xsmcGet(xsVar(0), xsArg(0), xsID_channels))
		numChannels = xsmcToInteger(xsVar(0));
#ifdef MODDEF_AUDIOOUT_NUMCHANNELS
	else
		numChannels = MODDEF_AUDIOOUT_NUMCHANNELS;
#endif
	if ((1 != numChannels) && (2 != numChannels))
		xsRangeError("bad numChannels");

	if (xsmcGet(xsVar(0), xsArg(0), xsID_bitsPerSample))
		bitsPerSample = xsmcToInteger(xsVar(0));
#ifdef MODDEF_AUDIOOUT_BITSPERSAMPLE
	else
		bitsPerSample = MODDEF_AUDIOOUT_BITSPERSAMPLE;
#endif
	if ((8 != bitsPerSample) && (16 != bitsPerSample))
		xsRangeError("bad bitsPerSample");

	if (xsmcGet(xsVar(0), xsArg(0), xsID_audioType)) {
		char *type = xsmcToString(xsVar(0));
		if (c_strcmp(type, "LPCM"))
			xsRangeError("invalid audioType");
	}

	onWritable = builtinGetCallback(the, xsID_onWritable);

	builtinInitializeTarget(the);

	if (kIOFormatBuffer != builtinInitializeFormat(the, kIOFormatBuffer))
		xsRangeError("invalid format");

	audioOut = c_calloc(1, sizeof(AudioOutRecord));
	if (!audioOut)
		xsRangeError("no memory");

	audioOut->queueMutex = xSemaphoreCreateMutex();
	if (!audioOut->queueMutex) { c_free(audioOut); xsUnknownError("no memory for audio queue mutex"); }
	xsmcSetHostData(xsThis, audioOut);

	audioOut->the = the;
	audioOut->obj = xsThis;

	audioOut->useCount = 1;

	audioOut->sampleRate = (uint16_t)sampleRate;
	audioOut->numChannels = (uint8_t)numChannels;
	audioOut->bitsPerSample = (uint8_t)bitsPerSample;

	audioOut->onWritable = onWritable;
	
	audioOut->volumeDouble = 1.0;
	audioOut->volumeFixed = 256;

	xsSetHostHooks(xsThis, (xsHostHooks *)&xsAudioOutHooks);
	xsRemember(audioOut->obj);

    i2s_chan_config_t tx_chan_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_AUTO, I2S_ROLE_MASTER);
    tx_chan_cfg.auto_clear = true;

	// number of DMA buffers and their size in samples (default is 6 and 240)
#ifndef I2S_DMA_BUFFER_MAX_SIZE
	#define I2S_DMA_BUFFER_MAX_SIZE     (4092)
#endif

	tx_chan_cfg.dma_desc_num = 6;
	tx_chan_cfg.dma_frame_num = I2S_DMA_BUFFER_MAX_SIZE / 2;

#ifdef MODDEF_AUDIOOUT_I2S_PDM_PIN
	if (gPDMAudioOutBusy)
		xsUnknownError("already in use");

	if (gPDMAudioInBusy)
		xsUnknownError("pdm already in use by audioin");

	i2s_pdm_tx_config_t tx_cfg = {
		.clk_cfg = I2S_PDM_TX_CLK_DAC_DEFAULT_CONFIG(audioOut->sampleRate),
		.slot_cfg = I2S_PDM_TX_SLOT_DAC_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
		.gpio_cfg = {
			.clk = -1,
			.dout = MODDEF_AUDIOOUT_I2S_PDM_PIN,
			.invert_flags = {
				.clk_inv = false,
			},
		},
	};
#elif MODDEF_AUDIOOUT_I2S_BCK_PIN
	i2s_std_config_t i2s_config = {
		.gpio_cfg = {
			.mclk = MODDEF_AUDIOOUT_I2S_MCK_PIN,
			.bclk = MODDEF_AUDIOOUT_I2S_BCK_PIN,
			.ws = MODDEF_AUDIOOUT_I2S_LR_PIN,
			.dout = MODDEF_AUDIOOUT_I2S_DATAOUT_PIN,
			.din = I2S_GPIO_UNUSED,
			.invert_flags = {
				.mclk_inv = false,
				.bclk_inv = false,
				.ws_inv = false,
			},
		},
	};

	// I2S_STD_CLK_DEFAULT_CONFIG(sampleRate)  (i2s_std.h)
	i2s_config.clk_cfg.sample_rate_hz = audioOut->sampleRate;
	i2s_config.clk_cfg.clk_src = I2S_CLK_SRC_DEFAULT;
	i2s_config.clk_cfg.mclk_multiple = I2S_MCLK_MULTIPLE_256;

	// I2S_STD_MSB_SLOT_DEFAULT_CONFIG(bitwidth, mode) (i2s_std.h)
	int msb_right = true;
#if MODDEF_AUDIOOUT_I2S_BITSPERSAMPLE == 32
	i2s_config.slot_cfg.data_bit_width = I2S_DATA_BIT_WIDTH_16BIT;
	i2s_config.slot_cfg.ws_width = I2S_DATA_BIT_WIDTH_32BIT;
	msb_right = false;
#elif MODDEF_AUDIOOUT_I2S_BITSPERSAMPLE == 16
	i2s_config.slot_cfg.data_bit_width = I2S_DATA_BIT_WIDTH_16BIT;
	i2s_config.slot_cfg.ws_width = I2S_DATA_BIT_WIDTH_16BIT;
#else
	i2s_config.slot_cfg.data_bit_width = I2S_DATA_BIT_WIDTH_8BIT;
	i2s_config.slot_cfg.ws_width = I2S_DATA_BIT_WIDTH_8BIT;
#endif
	i2s_config.slot_cfg.slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO;
#if SOC_I2S_HW_VERSION_1	// esp32/s2
	i2s_config.slot_cfg.msb_right = msb_right;
#else
	i2s_config.slot_cfg.left_align = false;
	i2s_config.slot_cfg.big_endian = false;
	i2s_config.slot_cfg.bit_order_lsb = false;
#endif

#if MODDEF_AUDIOOUT_NUMCHANNELS == 2
	i2s_config.slot_cfg.slot_mode = I2S_SLOT_MODE_STEREO;
	i2s_config.slot_cfg.slot_mask = I2S_STD_SLOT_BOTH;
#else
	i2s_config.slot_cfg.slot_mode = I2S_SLOT_MODE_MONO;
	i2s_config.slot_cfg.slot_mask = MODDEF_AUDIOOUT_I2S_SLOT;
#endif
	i2s_config.slot_cfg.ws_pol = false;
#if MODDEF_AUDIOOUT_I2S_FORMAT_I2S
	i2s_config.slot_cfg.bit_shift = true;
#else
	i2s_config.slot_cfg.bit_shift = false;
#endif


#elif MODDEF_AUDIOOUT_I2S_DAC
	#error DAC audio unimplemented
#else
	#error unknown audio configuration
#endif

	err = i2s_new_channel(&tx_chan_cfg, &audioOut->tx_handle, C_NULL);
	if (ESP_OK != err)
		constructionFailed(the, audioOut, "channel allocation", err);
#if MODDEF_AUDIOOUT_I2S_PDM_PIN
	err = i2s_channel_init_pdm_tx_mode(audioOut->tx_handle, &tx_cfg);
	if (ESP_OK != err)
		constructionFailed(the, audioOut, "PDM initialization", err);
	gPDMAudioOutBusy = 1;
#elif MODDEF_AUDIOOUT_I2S_BCK_PIN
	err = i2s_channel_init_std_mode(audioOut->tx_handle, &i2s_config);
	if (ESP_OK != err)
		constructionFailed(the, audioOut, "I2S initialization", err);
	i2s_channel_reconfig_std_slot(audioOut->tx_handle, &i2s_config.slot_cfg);
	i2s_channel_reconfig_std_clock(audioOut->tx_handle, &i2s_config.clk_cfg);
#elif MODDEF_AUDIOOUT_I2S_DAC
#else
#endif

	i2s_event_callbacks_t cbs = {
		.on_recv = C_NULL,
		.on_recv_q_ovf = C_NULL,
		.on_sent = playedBuffer,
		.on_send_q_ovf = C_NULL,
	};
	i2s_channel_register_event_callback(audioOut->tx_handle, &cbs, audioOut);

	audioOut->dma_buf_size = tx_chan_cfg.dma_frame_num * 2;			//@@ wrong for stereo etc
	audioOut->total_dma_buf_size = audioOut->dma_buf_size * (tx_chan_cfg.dma_desc_num - 1);
	audioOut->bytesWritable = audioOut->total_dma_buf_size;
	audioOut->stagingBuffer = c_malloc(audioOut->dma_buf_size);
	if (!audioOut->stagingBuffer)
		constructionFailed(the, audioOut, "staging allocation", ESP_ERR_NO_MEM);

#if ESP32 && defined(MODDEF_AUDIOOUT_AMPLIFIER_POWER)
	modGPIOInit(&audioOut->amplifierPower, C_NULL, MODDEF_AUDIOOUT_AMPLIFIER_POWER, kModGPIOOutput);
	modGPIOWrite(&audioOut->amplifierPower, 1);		//@@ always on
#endif

	if (!audioOut->callbackPending && audioOut->onWritable) {
		audioOut->callbackPending = true;
		__atomic_add_fetch(&audioOut->useCount, 1, __ATOMIC_SEQ_CST);
		modMessagePostToMachine(audioOut->the, C_NULL, 0, audiooutDeliver, audioOut);
	}
}
 
void xs_stackchan_audioout_close_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostData(xsThis);
	if (audioOut && xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks)) {
		audioOut->closed = true;
		xsForget(audioOut->obj);
		
#if !mxUseGCCAtomics
		uint8_t useCount = --audioOut->useCount;
#else
		uint8_t useCount = __atomic_sub_fetch(&audioOut->useCount, 1, __ATOMIC_SEQ_CST);
#endif
		audioOutRelease(audioOut);
		if (0 == audioOut->useCount)
			xs_stackchan_audioout_destructor_(audioOut);
		xsmcSetHostData(xsThis, C_NULL);
		xsmcSetHostDestructor(xsThis, C_NULL);
	}
}
 
void xs_stackchan_audioout_start_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	esp_err_t err;

	if (audioOut->started)
		return;

	// prime IDF buffers
	size_t ignore = 0;
	i2s_channel_preload_data(audioOut->tx_handle, &ignore, 0, &ignore);

	err = i2s_channel_enable(audioOut->tx_handle);
	if (ESP_OK != err)
		xsUnknownError("can't enable %d", (int)err);

	audioOut->started = true;
	audioOut->bytesWritable = audioOut->total_dma_buf_size;

	if (!audioOut->callbackPending /* && audioOut->onWritable */) {
		audioOut->callbackPending = true;
		__atomic_add_fetch(&audioOut->useCount, 1, __ATOMIC_SEQ_CST);
		modMessagePostToMachine(audioOut->the, C_NULL, 0, audiooutDeliver, audioOut);
	}
}
 
void xs_stackchan_audioout_stop_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);

	if (!audioOut->started)
		return;

	i2s_channel_disable(audioOut->tx_handle);
	audioOut->started = false;
	audioOut->bytesWritable = audioOut->total_dma_buf_size;
	audioOut->stagingOffset = 0;
}
 
void xs_stackchan_audioout_writeSync_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	void *buffer;
	xsUnsignedValue requested;
	esp_err_t err;

	if (audioOut->task) xsUnknownError("cannot mix synchronous and async audio writes");
	xsmcGetBufferReadable(xsArg(0), &buffer, &requested);

	if (requested > (audioOut->bytesWritable - audioOut->stagingOffset))
		xsUnknownError("insufficient space");

	if (requested & 1)							//@@ broken for stereo & 8 bit
		xsUnknownError("full samples only");

	err = scAudioOutWrite(audioOut, buffer, requested);
	if (err)
		xsUnknownError("write failed %d", (int)err);
}
 
 void xs_stackchan_audioout_writeAsync_(xsMachine *the)
 {
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	AudioOutElement element;
	xsSlot *buffer, *completion = C_NULL;
	void *data;
	xsUnsignedValue bytesAvailable;

	if (xsBufferRelocatable == xsmcGetBufferReadable(xsArg(0), &data, &bytesAvailable))
		data = C_NULL;
	else if (!audioOut->task) {
		xTaskCreate(stackchanAudioOutLoop, "audioOut", 1536 + XT_STACK_EXTRA_CLIB, audioOut, 10, (TaskHandle_t *)&audioOut->task);
		if (!audioOut->task)
			xsUnknownError("can't create task");
	}
	
	buffer = xsmcToReference(xsArg(0));
	if (xsmcArgc > 1)
		completion = xsmcToReference(xsArg(1));

	element = c_calloc(1, sizeof(AudioOutElementRecord));
	if (!element)
		xsUnknownError("no memory");
	
	element->completion = completion;
	element->buffer = buffer;
	element->data = data;
	element->bytesAvailable = bytesAvailable;

xSemaphoreTake(audioOut->queueMutex, portMAX_DELAY);

	if (audioOut->elements) {
		AudioOutElement walker = audioOut->elements;
		while (walker->next)
			walker = walker->next;
		walker->next = element;
	}
	else
		audioOut->elements = element;

xSemaphoreGive(audioOut->queueMutex);
}

void xs_stackchan_audioout_get_format_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	builtinGetFormat(the, kIOFormatBuffer);
}
 
void xs_stackchan_audioout_set_format_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	if (kIOFormatBuffer != builtinSetFormat(the))
		xsRangeError("invalid format");
}
 
void xs_stackchan_audioout_get_bitsPerSample_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	xsmcSetInteger(xsResult, audioOut->bitsPerSample);
}
 
void xs_stackchan_audioout_get_numChannels_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	xsmcSetInteger(xsResult, audioOut->numChannels);
}
 
void xs_stackchan_audioout_get_sampleRate_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	xsmcSetInteger(xsResult, audioOut->sampleRate);
}
 
void xs_stackchan_audioout_get_volume_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	xsmcSetNumber(xsResult, audioOut->volumeDouble);
}
 
void xs_stackchan_audioout_set_volume_(xsMachine *the)
{
	AudioOut audioOut = xsmcGetHostDataValidate(xsThis, (void *)&xsAudioOutHooks);
	double volume = xsmcToNumber(xsArg(0));
	if ((volume < 0) || (volume > 1))
		xsRangeError("invalid volume");
	audioOut->volumeDouble = volume;
	__atomic_store_n(&audioOut->volumeFixed, (int16_t)(volume * 256), __ATOMIC_SEQ_CST);
}
 
void xs_stackchan_audioout_mark_(xsMachine* the, void* it, xsMarkRoot markRoot)
{
	AudioOut audioOut = it;
	AudioOutElement walker;

	if (audioOut->onWritable)
		(*markRoot)(the, audioOut->onWritable);

	for (walker = audioOut->elements; C_NULL != walker; walker = walker->next) {
		if (walker->buffer)
			(*markRoot)(the, walker->buffer);
		if (walker->completion)
			(*markRoot)(the, walker->completion);
	}
}

static bool playedBuffer(i2s_chan_handle_t handle, i2s_event_data_t *event, void *user_ctx)
{
	AudioOut audioOut = user_ctx;
	BaseType_t higherPriorityTaskWoken = pdFALSE;
	if (__atomic_load_n(&audioOut->closed, __ATOMIC_SEQ_CST)) return false;

//@@ entire operation on audioOut->bytesWritable should be atomic
	uint32_t previous, next;
	do {
		previous = __atomic_load_n(&audioOut->bytesWritable, __ATOMIC_SEQ_CST);
		next = previous + event->size;
		if (next > audioOut->total_dma_buf_size) next = audioOut->total_dma_buf_size;
	} while (!__atomic_compare_exchange_n(&audioOut->bytesWritable, &previous, next, false, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST));

	if (audioOut->task) {
		xTaskNotifyFromISR(audioOut->task, 1, eSetValueWithOverwrite, &higherPriorityTaskWoken);
		if (higherPriorityTaskWoken) portYIELD_FROM_ISR();
		return false;
	}

	if (!__atomic_exchange_n(&audioOut->callbackPending, true, __ATOMIC_SEQ_CST)) {
		__atomic_add_fetch(&audioOut->useCount, 1, __ATOMIC_SEQ_CST);
		audioOut->callbackPending = true;
		if (0 != modMessagePostToMachineFromISR(audioOut->the, audiooutDeliver, audioOut)) {
			audioOut->callbackPending = false;
			__atomic_sub_fetch(&audioOut->useCount, 1, __ATOMIC_SEQ_CST);
		}
	}
    return false;
}

// Serialize the complete read/write/advance transaction. ISR only supplies credits.
static void drainQueue(AudioOut audioOut)
{
	xSemaphoreTake(audioOut->queueMutex, portMAX_DELAY);
	for (AudioOutElement element = audioOut->elements; element && audioOut->bytesWritable; element = element->next) {
		if (audioOut->fault) { element->err = audioOut->fault; element->bytesAvailable = 0; continue; }
		uint32_t use = audioOut->bytesWritable;
		if (use > element->bytesAvailable) use = element->bytesAvailable;
		if (!use) continue;
		void *data = element->data;
		if (!data) break; // Relocatable data belongs exclusively to the XS thread.
		element->err = scAudioOutWrite(audioOut, (uint8_t *)data + element->position, use);
		element->position += use;
		element->bytesAvailable = element->err ? 0 : element->bytesAvailable - use;
		if (element->err) audioOut->fault = element->err;
	}
	xSemaphoreGive(audioOut->queueMutex);
}

static void audiooutDeliver(void *theIn, void *refcon, uint8_t *message, uint16_t messageLength)
{
	xsMachine *the = (xsMachine *)theIn;
	AudioOut audioOut = (AudioOut)refcon;
	if (audioOut->closed) goto done;
	audioOut->callbackPending = false;
	xsBeginHost(the);
	xsmcVars(1);
	if (audioOut->onWritable) {
		xSemaphoreTake(audioOut->queueMutex, portMAX_DELAY);
		uint32_t writable = audioOut->bytesWritable;
		for (AudioOutElement e = audioOut->elements; e; e = e->next) {
			if (e->bytesAvailable >= writable) { writable = 0; break; }
			writable -= e->bytesAvailable;
		}
		writable = writable > audioOut->stagingOffset ? writable - audioOut->stagingOffset : 0;
		xSemaphoreGive(audioOut->queueMutex);
		if (writable) {
			xsTry {
				xsmcSetInteger(xsResult, writable);
				xsCallFunction1(xsReference(audioOut->onWritable), audioOut->obj, xsResult);
			} xsCatch { }
			if (audioOut->closed) goto abort;
		}
	}
	drainQueue(audioOut);
	xSemaphoreTake(audioOut->queueMutex, portMAX_DELAY);
	for (AudioOutElement e = audioOut->elements; e && audioOut->bytesWritable; e = e->next) {
		if (!e->bytesAvailable) continue;
		if (audioOut->fault) { e->err = audioOut->fault; e->bytesAvailable = 0; continue; }
		if (e->data) break;
		xsUnsignedValue size;
		xsResult = xsReference(e->buffer);
		void *data;
		xsmcGetBufferReadable(xsResult, &data, &size);
		uint32_t use = audioOut->bytesWritable;
		if (use > e->bytesAvailable) use = e->bytesAvailable;
		if (e->position + use > size) { e->err = 1; e->bytesAvailable = 0; continue; }
		e->err = scAudioOutWrite(audioOut, (uint8_t *)data + e->position, use);
		e->position += use;
		e->bytesAvailable = e->err ? 0 : e->bytesAvailable - use;
		if (e->err) audioOut->fault = e->err;
	}
	xSemaphoreGive(audioOut->queueMutex);
	for (;;) {
		xSemaphoreTake(audioOut->queueMutex, portMAX_DELAY);
		AudioOutElement e = audioOut->elements;
		if (!e || e->bytesAvailable) { xSemaphoreGive(audioOut->queueMutex); break; }
		audioOut->elements = e->next;
		xSemaphoreGive(audioOut->queueMutex);
		if (e->completion) {
			xsVar(0) = xsReference(e->completion);
			xsTry {
				if (e->err) { xsmcSetInteger(xsResult, e->err); xsResult = xsNew1(xsGlobal, xsID_Error, xsResult); }
				else xsmcSetNull(xsResult);
				xsCallFunction1(xsVar(0), audioOut->obj, xsResult);
			} xsCatch { }
		}
		c_free(e);
		if (audioOut->closed) goto abort;
	}
abort:
	xsEndHost(the);
done:
	if (0 == __atomic_sub_fetch(&audioOut->useCount, 1, __ATOMIC_SEQ_CST)) c_free(audioOut);
}

esp_err_t scAudioOutWrite(AudioOut audioOut, void *buffer, xsUnsignedValue requested)
{
	esp_err_t err = ESP_OK;
	uint8_t *src = (uint8_t *)buffer;
	const int kTimeout = 200;
	const int16_t volume = __atomic_load_n(&audioOut->volumeFixed, __ATOMIC_SEQ_CST);

	while (requested > 0 && ESP_OK == err) {
		if ((256 == volume) && (0 == audioOut->stagingOffset) && (requested >= audioOut->dma_buf_size)) {
			size_t bytes_written = 0;
			if (audioOut->started)
				err = i2s_channel_write(audioOut->tx_handle, src, audioOut->dma_buf_size, &bytes_written, kTimeout);
			else
				err = i2s_channel_preload_data(audioOut->tx_handle, src, audioOut->dma_buf_size, &bytes_written);
			if (ESP_OK == err && bytes_written != audioOut->dma_buf_size) err = ESP_FAIL;
			__atomic_fetch_sub(&audioOut->bytesWritable, audioOut->dma_buf_size, __ATOMIC_SEQ_CST);
			src += audioOut->dma_buf_size;
			requested -= audioOut->dma_buf_size;
		}
		else {
			uint32_t stagingSpace = audioOut->dma_buf_size - audioOut->stagingOffset;
			uint32_t use = (requested < stagingSpace) ? (uint32_t)requested : stagingSpace;

			if (256 == volume)
				c_memcpy(audioOut->stagingBuffer + audioOut->stagingOffset, src, use);
			else {
				int16_t *dst = (int16_t *)(audioOut->stagingBuffer + audioOut->stagingOffset);
				int16_t *s = (int16_t *)src;
				int16_t vol = volume;
				uint32_t samples = use >> 1;
				for (uint32_t i = 0; i < samples; i++)
					dst[i] = (s[i] * vol) >> 8;
			}

			audioOut->stagingOffset += use;
			src += use;
			requested -= use;

			if (audioOut->stagingOffset == audioOut->dma_buf_size) {
				size_t bytes_written = 0;
				if (audioOut->started)
					err = i2s_channel_write(audioOut->tx_handle, audioOut->stagingBuffer, audioOut->dma_buf_size, &bytes_written, kTimeout);
				else
					err = i2s_channel_preload_data(audioOut->tx_handle, audioOut->stagingBuffer, audioOut->dma_buf_size, &bytes_written);
				if (ESP_OK == err && bytes_written != audioOut->dma_buf_size) err = ESP_FAIL;
			__atomic_fetch_sub(&audioOut->bytesWritable, audioOut->dma_buf_size, __ATOMIC_SEQ_CST);
				audioOut->stagingOffset = 0;
			}
		}
	}

	return err;
}

void stackchanAudioOutLoop(void *pvParameter)
{
	AudioOut audioOut = (AudioOut)pvParameter;

	while (true) {
		uint32_t newState;
		uint8_t doCallback = 0;
		AudioOutElement element;

		xTaskNotifyWait(0, 0, &newState, portMAX_DELAY);
		if (2 == newState || __atomic_load_n(&audioOut->closed, __ATOMIC_SEQ_CST))
			break;

		drainQueue(audioOut);
		xSemaphoreTake(audioOut->queueMutex, portMAX_DELAY);
		doCallback = audioOut->elements && !audioOut->elements->bytesAvailable;
		// A relocatable queue head must be consumed on the XS thread.
		for (element = audioOut->elements; element; element = element->next)
			if (element->bytesAvailable && !element->data) { doCallback = 1; break; }
		xSemaphoreGive(audioOut->queueMutex);

		if (doCallback && !__atomic_exchange_n(&audioOut->callbackPending, true, __ATOMIC_SEQ_CST)) {
			audioOut->callbackPending = true;
			__atomic_add_fetch(&audioOut->useCount, 1, __ATOMIC_SEQ_CST);
			modMessagePostToMachine(audioOut->the, C_NULL, 0, audiooutDeliver, audioOut);
		}
	}

	audioOut->task = NULL;

	vTaskDelete(NULL);	// "If it is necessary for a task to exit then have the task call vTaskDelete( NULL ) to ensure its exit is clean."
}
