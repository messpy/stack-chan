"""Exercise production PCM ring functions, without ESP32 or recorded audio."""
import ctypes
import re
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE=Path(__file__).parents[1]/'host/modules/audio/platforms/m5stackchan-cores3/esp32-opus-encoder.c'
def function(source,name):
    match=re.search(r'^static [^;{}]*\b'+name+r'\([^;{}]*\)\n\{',source,re.M)
    start=match.start();opening=source.index('{',start);depth=1;end=opening+1
    while depth:
        depth+=(source[end]=='{')-(source[end]=='}');end+=1
    return source[start:end]

class RingChannels(unittest.TestCase):
    def test_preserves_active_mic_and_pcm_order(self):
        source=SOURCE.read_text()
        definitions='\n'.join(line for line in source.splitlines() if line.startswith('#define PCM_'))
        # Compile the actual ring ABI and pure native implementation.
        structure=re.search(r'typedef struct \{[^{}]*\} xsPcmRing;',source,re.S).group(0)
        code='#include <stdint.h>\n#include <stdlib.h>\n#include <string.h>\n#define c_memcpy memcpy\n'+definitions+'\n'+structure+'\n'
        code+='\n'.join(function(source,n) for n in ['pcmRingReadable','pcmRingWritable','pcmRingCopyIn','pcmRingCopyOut','pcmRingWriteDownmix'])
        code+='''
uint32_t convert(const int16_t *input, uint32_t frames, int channels, uint32_t capacity, uint32_t start, int16_t *output, uint32_t *stats) {
 uint8_t *memory=calloc(1,capacity);uint32_t state[PCM_RING_STATE_WORDS]={0};
 state[PCM_RING_READ]=state[PCM_RING_WRITE]=start;
 xsPcmRing ring={.data=memory,.state=state,.length=capacity};
 uint32_t written=pcmRingWriteDownmix(&ring,(const uint8_t*)input,frames*channels*2,channels);
 pcmRingCopyOut(&ring,(uint8_t*)output,written);
 stats[0]=state[PCM_RING_CAPTURED];stats[1]=state[PCM_RING_DROPPED_BYTES];
 stats[2]=state[PCM_RING_READ];stats[3]=state[PCM_RING_WRITE];free(memory);return written;
}
'''
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'test.c').write_text(code)
            subprocess.run(['cc','-shared','-fPIC','-O2',str(root/'test.c'),'-o',str(root/'test.so')],check=True)
            convert=ctypes.CDLL(str(root/'test.so')).convert
            convert.argtypes=[ctypes.POINTER(ctypes.c_int16),ctypes.c_uint32,ctypes.c_int,ctypes.c_uint32,ctypes.c_uint32,ctypes.POINTER(ctypes.c_int16),ctypes.POINTER(ctypes.c_uint32)]
            convert.restype=ctypes.c_uint32
            for frames in [0,1,128,960,1500]:
                wave=[(i*137)%18000-9000 for i in range(frames)]
                for mode in ['right-only','left-only','right-dominant','left-dominant','right-fullscale','tie','opposite-phase','mono','silent']:
                    channels=1 if mode=='mono' else 2
                    left=wave if mode in ['left-only','left-dominant','tie','opposite-phase','mono','right-fullscale'] else [v//4 for v in wave] if mode=='right-dominant' else [0]*frames
                    right=wave if mode in ['right-only','right-dominant','tie'] else [v//4 for v in wave] if mode=='left-dominant' else [-32768 if i%2==0 else 32767 for i in range(frames)] if mode=='right-fullscale' else [-v for v in wave] if mode=='opposite-phase' else [0]*frames
                    values=left if channels==1 else [v for pair in zip(left,right) for v in pair]
                    expected=right if sum(v*v for v in right)>sum(v*v for v in left) else left
                    for start in [0,4094]:
                        with self.subTest(frames=frames,mode=mode,start=start):
                            data=(ctypes.c_int16*len(values))(*values);out=(ctypes.c_int16*frames)();stats=(ctypes.c_uint32*4)()
                            count=convert(data,frames,channels,8192,start,out,stats)
                            self.assertEqual(count,frames*2);self.assertEqual(list(out),expected)
                            self.assertEqual(list(stats)[:2],[frames*2,0]);self.assertEqual(stats[2],stats[3])
            # Full input is rejected without publishing a partial/truncated frame.
            frames=1100;values=[1,2]*frames;data=(ctypes.c_int16*len(values))(*values);out=(ctypes.c_int16*frames)();stats=(ctypes.c_uint32*4)()
            self.assertEqual(convert(data,frames,2,2048,0,out,stats),0)
            self.assertEqual(list(stats),[frames*2,frames*2,0,0])
if __name__=='__main__':unittest.main()
