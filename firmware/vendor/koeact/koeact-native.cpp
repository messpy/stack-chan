// StackChan glue for the Apache-2.0 KoeAct-JP stream model and decoder.
#include <algorithm>
#include <atomic>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include <cmath>
#include <cstring>
#include <map>
#include <memory>
#include <vector>
#include "dl_model_base.hpp"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "features.h"
#include "a2.h"
extern "C" {
#include "xs.h"
#include "xsmc.h"
extern const unsigned char koeact_model_data[];
extern const unsigned char koeact_weights_data[];
}
namespace {
// ESP-DL's C++ graph metadata contains many small allocations. Route those to
// PSRAM for this bounded inference, then restore the board's malloc policy.
// Task stacks, DMA and driver allocations retain explicit INTERNAL/DMA caps.
struct ExternalMallocScope {
 ExternalMallocScope(){heap_caps_malloc_extmem_enable(0);}
 ~ExternalMallocScope(){heap_caps_malloc_extmem_enable(CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL);}
};
struct FeatureScope {
 bool ready;
 FeatureScope():ready(ralomi::features_init()){}
 ~FeatureScope(){ralomi::features_release();}
};
struct PSRAM {
 void *data;
 explicit PSRAM(size_t bytes):data(heap_caps_calloc(1,bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT)){}
 ~PSRAM(){heap_caps_free(data);}
};
struct Result { a2_result action; int64_t elapsed; bool ok;uint32_t internalBefore=0,internalAfter=0,psramBefore=0,psramAfter=0,stackFree=0; };
Result recognize(const void *weights,size_t weightsBytes,const void *modelData,const int16_t *pcm,int samples){
 ExternalMallocScope allocationPolicy;
 Result result={};const int64_t start=esp_timer_get_time();
 constexpr int capacity=100; // four seconds, one encoder step per 40 ms
 a2_model decoder;
 if(a2_load(&decoder,weights,weightsBytes)!=0)return result;
 PSRAM arena(a2_arena_bytes(capacity)),mixed(10*2*320*sizeof(float)),floatPCM(samples*sizeof(float)),features(400*40*sizeof(float));
 if(!arena.data||!mixed.data||!floatPCM.data||!features.data)return result;
 auto *audio=static_cast<float*>(floatPCM.data);for(int i=0;i<samples;i++)audio[i]=pcm[i]/32768.f;
 FeatureScope frontend;if(!frontend.ready)return result;ralomi::log_mel(audio,samples,static_cast<float*>(features.data));
 const int frames=ralomi::frame_count(samples);
 std::unique_ptr<dl::Model> model(new dl::Model(static_cast<const char*>(modelData),fbs::MODEL_LOCATION_IN_FLASH_RODATA,0,dl::MEMORY_MANAGER_GREEDY,nullptr,false));
 auto &inputs=model->get_inputs();auto &outputs=model->get_outputs();
 if(!inputs.count("log_mel_features")||!outputs.count("layer4")||!outputs.count("layer8"))return result;
 auto *input=inputs.at("log_mel_features"),*layer4=outputs.at("layer4"),*layer8=outputs.at("layer8");
 if(input->shape.size()<2||input->shape[1]!=40||layer4->get_dtype()!=dl::DATA_TYPE_INT16||layer8->get_dtype()!=dl::DATA_TYPE_INT16)return result;
 struct State{dl::TensorBase *input,*output;std::vector<uint8_t> bytes;};std::vector<State> states;
 for(auto &[name,tensor]:inputs)if(name.rfind("state_",0)==0){
  if(!outputs.count("next_"+name))return result;auto *next=outputs.at("next_"+name);
  if(next->get_size()!=tensor->get_size()||next->get_dtype()!=tensor->get_dtype()||next->get_exponent()!=tensor->get_exponent())return result;
  states.push_back({tensor,next,std::vector<uint8_t>(tensor->get_size()*tensor->get_dtype_bytes(),0)});
 }
 int encoded=0;
 for(int at=0;at<frames;at+=40){
  const int count=std::min(40,frames-at),steps=count/4;
  const float scale=std::ldexp(1.f,-input->get_exponent());
  if(input->get_dtype()==dl::DATA_TYPE_INT16){auto *p=input->get_element_ptr<int16_t>();std::fill(p,p+input->get_size(),0);for(int i=0;i<count*40;i++)p[i]=dl::quantize<int16_t>(static_cast<float*>(features.data)[at*40+i],scale);}
  else if(input->get_dtype()==dl::DATA_TYPE_INT8){auto *p=input->get_element_ptr<int8_t>();std::fill(p,p+input->get_size(),0);for(int i=0;i<count*40;i++)p[i]=dl::quantize<int8_t>(static_cast<float*>(features.data)[at*40+i],scale);}
  else return result;
  for(auto &state:states)std::memcpy(state.input->get_element_ptr(),state.bytes.data(),state.bytes.size());
  model->run();
  if(encoded+steps>capacity)return result;
  a2_put_layers(static_cast<float*>(mixed.data),0,steps,layer4->get_element_ptr<int16_t>(),layer4->get_exponent(),layer8->get_element_ptr<int16_t>(),layer8->get_exponent());
  if(a2_encode(&decoder,static_cast<float*>(mixed.data),encoded,steps,capacity,arena.data)!=0)return result;
  encoded+=steps;
  for(auto &state:states)std::memcpy(state.bytes.data(),state.output->get_element_ptr(),state.bytes.size());
 }
 if(a2_generate(&decoder,encoded,capacity,arena.data,&result.action)!=0)return result;
 result.ok=true;result.elapsed=(esp_timer_get_time()-start)/1000;return result;
}
}
namespace {
struct Job { int16_t *pcm=nullptr;int samples=0;Result result={};std::atomic<bool> done{false}; };
Job *pending=nullptr;
void run_job(void *context){
 auto *job=static_cast<Job*>(context);
 const uint32_t ib=heap_caps_get_free_size(MALLOC_CAP_INTERNAL),pb=heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
 job->result=recognize(koeact_weights_data,1132544,koeact_model_data,job->pcm,job->samples);
 job->result.internalBefore=ib;job->result.psramBefore=pb;job->result.internalAfter=heap_caps_get_free_size(MALLOC_CAP_INTERNAL);job->result.psramAfter=heap_caps_get_free_size(MALLOC_CAP_SPIRAM);
 job->result.stackFree=uxTaskGetStackHighWaterMark(nullptr);
 job->done.store(true,std::memory_order_release);
 vTaskDelete(nullptr);
}
}
extern "C" void xs_koeact_start(xsMachine *the){
 void *pcm;xsUnsignedValue bytes;xsmcGetBufferReadable(xsArg(0),&pcm,&bytes);
 if(pending)xsUnknownError("KoeAct is busy");
 if(bytes<1280||bytes>128000||bytes%2)xsRangeError("Invalid KoeAct PCM");
 if(heap_caps_get_free_size(MALLOC_CAP_SPIRAM)<2500000||heap_caps_get_free_size(MALLOC_CAP_INTERNAL)<35000||heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL)<16384)xsUnknownError("KoeAct memory unavailable");
 auto *job=new Job();job->samples=bytes/2;job->pcm=static_cast<int16_t*>(heap_caps_malloc(bytes,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
 if(!job->pcm){delete job;xsUnknownError("KoeAct PCM memory unavailable");}
 memcpy(job->pcm,pcm,bytes);pending=job;
 if(xTaskCreatePinnedToCore(run_job,"koeact",16384,job,2,nullptr,0)!=pdPASS){pending=nullptr;heap_caps_free(job->pcm);delete job;xsUnknownError("KoeAct worker unavailable");}
 xsmcSetBoolean(xsResult,1);
}
extern "C" void xs_koeact_poll(xsMachine *the){
 if(!pending||!pending->done.load(std::memory_order_acquire)){xsmcSetNull(xsResult);return;}
 Result r=pending->result;heap_caps_free(pending->pcm);delete pending;pending=nullptr;
 if(!r.ok)xsUnknownError("KoeAct inference failed");
 xsmcVars(1);xsmcSetNewObject(xsResult);xsmcSetNumber(xsVar(0),r.action.p_act);xsmcSet(xsResult,xsID("pAct"),xsVar(0));
 xsmcSetInteger(xsVar(0),r.stackFree);xsmcSet(xsResult,xsID("stackFree"),xsVar(0));
 xsmcSetInteger(xsVar(0),r.internalBefore);xsmcSet(xsResult,xsID("internalBefore"),xsVar(0));
 xsmcSetInteger(xsVar(0),r.internalAfter);xsmcSet(xsResult,xsID("internalAfter"),xsVar(0));
 xsmcSetInteger(xsVar(0),r.psramBefore);xsmcSet(xsResult,xsID("psramBefore"),xsVar(0));
 xsmcSetInteger(xsVar(0),r.psramAfter);xsmcSet(xsResult,xsID("psramAfter"),xsVar(0));
 xsmcSetInteger(xsVar(0),r.elapsed);xsmcSet(xsResult,xsID("elapsedMs"),xsVar(0));
 xsmcSetNewArray(xsVar(0),r.action.n);xsmcSet(xsResult,xsID("ids"),xsVar(0));
 for(int i=0;i<r.action.n;i++){xsSlot id=xsInteger(r.action.ids[i]);xsmcSetIndex(xsVar(0),i,id);}
}
