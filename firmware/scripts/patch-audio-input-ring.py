#!/usr/bin/env python3
"""Keep unread ESP32 stereo input distinct from an empty circular buffer."""
import os
from pathlib import Path

MARKER = 'STACKCHAN_AUDIO_INPUT_RING'
HELPER = '''/* STACKCHAN_AUDIO_INPUT_RING: leave one hardware stereo frame unused.
 * Called with the input mutex held. Never move the consumer pointer. */
static uint32_t scAudioInputWritable(AudioInput input)
{
    const uint32_t frameBytes = 4; /* two 16-bit I2S slots, including mono extraction */
    uint32_t available;
    if (input->recPos == input->endPos)
        input->recPos = input->buffer;
    if (input->playPos > input->recPos)
        available = input->playPos - input->recPos - frameBytes;
    else {
        available = input->endPos - input->recPos;
        if (input->playPos == input->buffer)
            available = available > frameBytes ? available - frameBytes : 0;
    }
    return available;
}

'''
OLD = '''\t\tuint32_t\tamt;
\t\tif (input->playPos > input->recPos)
\t\t\tamt = input->playPos - input->recPos;
\t\telse
\t\t\tamt = input->endPos - input->recPos;
\t\tif (amt == 0) {
\t\t\tamt = input->playPos - input->buffer;
\t\t\tinput->recPos = input->buffer;
\t\t}'''


def patch_ring_source(source):
    if MARKER in source:
        return source
    if source.count(OLD) != 1:
        raise RuntimeError('SDK input producer changed; review ring patch')
    anchor = 'void audioInLoop('
    # Insert immediately before the implementation, rather than its forward declaration.
    index = source.index(anchor, source.index('void xs_audioin_read('))
    source = source[:index] + HELPER + source[index:]
    source = source.replace(OLD, '\t\tuint32_t amt = scAudioInputWritable(input);', 1)
    source = source.replace('\t\tsize_t bytes_read;', '\t\tsize_t bytes_read = 0;', 1)
    anchor = '\n#endif\n\n\t\tif (input->onReadable && (bytes_read > 0))'
    if source.count(anchor) != 1:
        raise RuntimeError('SDK input loop changed; review ring patch')
    source = source.replace(anchor, '\n\t\telse\n\t\t\tvTaskDelay(1); /* full: let the consumer run instead of spinning */' + anchor, 1)
    return source



def patch_source(source):
    source = patch_ring_source(source)
    # At 16 kHz stereo the old ring holds only 256 ms. Screen/I2C work can
    # delay callbacks beyond that. Larger allocations use the PSRAM-enabled
    # IDF allocator; boards without PSRAM retain the original capacity.
    if 'STACKCHAN_AUDIO_INPUT_CAPACITY' not in source:
        old_capacity = '#define AUDIO_IN_BUFFERSIZE\t(8192 * 2)'
        if source.count(old_capacity) != 1:
            raise RuntimeError('SDK input buffer definition changed; review patch')
        source = source.replace(old_capacity, """/* STACKCHAN_AUDIO_INPUT_CAPACITY: one second at 16 kHz stereo. */
#if defined(CONFIG_SPIRAM_USE_MALLOC) && CONFIG_SPIRAM_USE_MALLOC
#define AUDIO_IN_BUFFERSIZE (8192 * 8)
#else
#define AUDIO_IN_BUFFERSIZE (8192 * 2)
#endif""", 1)
    if 'STACKCHAN_AUDIO_INPUT_NOTIFY' in source:
        return source
    helper = """/* STACKCHAN_AUDIO_INPUT_NOTIFY: a full ring can outlive the previous
 * callback's pending flag. Retry notification even if no new I2S read fits. */
static uint8_t scAudioInputShouldNotify(AudioInput input, uint32_t bytes_read)
{
    return bytes_read || (input->recPos != input->playPos);
}

"""
    index = source.index('void audioInLoop(', source.index('void xs_audioin_read('))
    source = source[:index] + helper + source[index:]
    old = 'if (input->onReadable && (bytes_read > 0))'
    if source.count(old) != 1:
        raise RuntimeError('SDK input notification changed; review patch')
    return source.replace(old, 'if (input->onReadable && scAudioInputShouldNotify(input, bytes_read))', 1)


def apply(sdk):
    path = Path(sdk) / 'modules/io/audioin/esp32/audioin.c'
    old = path.read_text()
    new = patch_source(old)
    if new != old:
        path.write_text(new)
    print('SDK audio input ring: ready')


if __name__ == '__main__':
    sdk = os.environ.get('MODDABLE')
    if not sdk:
        raise SystemExit('MODDABLE is not set')
    apply(sdk)
