#!/usr/bin/env python3
"""Execute the SDK ring writer with a delayed consumer and verify byte order."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('patch', Path(__file__).with_name('patch-audio-input-ring.py'))
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)


class RingTest(unittest.TestCase):
    def test_full_wrap_and_delayed_consumer(self):
        sdk = Path(os.environ['MODDABLE']) / 'modules/io/audioin/esp32/audioin.c'
        source = patch.patch_source(sdk.read_text())
        self.assertEqual(patch.patch_source(source), source)
        start = source.index('static uint32_t scAudioInputWritable(')
        end = source.index('\nvoid audioInLoop(', start)
        helper = source[start:end]
        harness = r'''
#include <stdint.h>
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
typedef struct { uint8_t *buffer, *endPos, *recPos, *playPos; } Record, *AudioInput;
HELPER
static uint32_t delayedConsumer(uint32_t capacity) {
    uint8_t *data=calloc(1,capacity);
    Record r={data,data+capacity,data,data};uint32_t accepted=0;
    for(unsigned tick=0;tick<1000;tick++) {
        unsigned offered=640; /* 10 ms, 16 kHz stereo PCM */
        while(offered) {
            uint32_t writable=scAudioInputWritable(&r);
            uint32_t amount=writable<offered?writable:offered;
            if(!amount)break;
            r.recPos+=amount;accepted+=amount;offered-=amount;
        }
        if(tick%50==49) { /* UI holds the VM for up to half a second */
            r.playPos=r.recPos;
            if(r.playPos==r.endPos)r.playPos=r.buffer;
        }
    }
    free(data);return accepted;
}
int main(void) {
    assert(delayedConsumer(65536)==640000);
    assert(delayedConsumer(16384)<delayedConsumer(65536));
    uint32_t data[32] = {0};
    Record r = {(uint8_t *)data, (uint8_t *)(data + 32), (uint8_t *)data, (uint8_t *)data};
    uint32_t produced = 0, consumed = 0, seed = 7;
    for (unsigned step = 0; step < 100000; step++) {
        uint32_t writable = scAudioInputWritable(&r);
        assert(writable % 4 == 0 && writable <= sizeof(data) - 4);
        if (step < 100 || (seed & 1)) {
            uint32_t frames = writable / 4;
            if (frames > 5) frames = 5;
            while (frames--) {
                *(uint32_t *)r.recPos = produced++;
                r.recPos += 4;
            }
        } else {
            unsigned limit = 1 + (seed % 9);
            while (limit-- && consumed < produced) {
                if (r.playPos == r.endPos) r.playPos = r.buffer;
                assert(*(uint32_t *)r.playPos == consumed++);
                r.playPos += 4;
                if (r.playPos == r.endPos) r.playPos = r.buffer;
            }
        }
        assert(produced - consumed <= 31);
        if (step == 99) {
            assert(produced == 31 && consumed == 0);
            assert(scAudioInputWritable(&r) == 0);
            assert(scAudioInputShouldNotify(&r, 0));
        }
        seed = seed * 1664525u + 1013904223u;
    }
    while (consumed < produced) {
        if (r.playPos == r.endPos) r.playPos = r.buffer;
        assert(*(uint32_t *)r.playPos == consumed++);
        r.playPos += 4;
    }
    if (r.playPos == r.endPos) r.playPos = r.buffer;
    if (r.recPos == r.endPos) r.recPos = r.buffer;
    assert(!scAudioInputShouldNotify(&r, 0));
    assert(scAudioInputShouldNotify(&r, 4));
    assert(produced > 10000);
    puts("full, wrap, FIFO and delayed consumer passed");
}
'''.replace('HELPER', helper)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'test.c').write_text(harness)
            subprocess.run(['cc', '-Wall', '-Wextra', '-Werror', '-fsanitize=undefined', str(path / 'test.c'), '-o', str(path / 'test')], check=True)
            subprocess.run([str(path / 'test')], check=True)


if __name__ == '__main__':
    unittest.main()
