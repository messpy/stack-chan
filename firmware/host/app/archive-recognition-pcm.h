#ifndef STACKCHAN_RECOGNITION_PCM_H
#define STACKCHAN_RECOGNITION_PCM_H
#include <stdint.h>
#include <stddef.h>
typedef struct {
    uint64_t left_energy, right_energy, output_energy;
    size_t frames;
    int channel, peak;
} ScRecognitionPCM;
static inline ScRecognitionPCM sc_recognition_pcm(const int16_t *input, int16_t *output, size_t frames, int channels, int gain) {
    ScRecognitionPCM stats = {.frames=frames};
    for(size_t i=0;i<frames;i++){
        int32_t left=input[i*channels];stats.left_energy+=(uint64_t)(left*left);
        if(channels==2){int32_t right=input[i*2+1];stats.right_energy+=(uint64_t)(right*right);}
    }
    stats.channel=channels==2&&stats.right_energy>stats.left_energy?1:0;
    for(size_t i=0;i<frames;i++){
        int32_t value=(int32_t)input[i*channels+stats.channel]*gain;
        if(value>32767)value=32767;else if(value < -32768)value=-32768;
        output[i]=(int16_t)value;
        int peak=value<0?-value:value;if(peak>stats.peak)stats.peak=peak;
        stats.output_energy+=(uint64_t)(value*value);
    }
    return stats;
}
#endif
