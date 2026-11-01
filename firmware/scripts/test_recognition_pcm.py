import ctypes
import json
from pathlib import Path
import random
import subprocess
import tempfile
import unittest


class Stats(ctypes.Structure):
    _fields_ = [('left_energy', ctypes.c_uint64), ('right_energy', ctypes.c_uint64),
                ('output_energy', ctypes.c_uint64), ('frames', ctypes.c_size_t),
                ('channel', ctypes.c_int), ('peak', ctypes.c_int)]


class RecognitionPCMTests(unittest.TestCase):
    def test_native_pcm_matches_reference_for_stereo_mono_and_clipping(self):
        header = Path(__file__).resolve().parents[1] / 'host/app/archive-recognition-pcm.h'
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'pcm.c'
            library = Path(directory) / 'pcm.so'
            source.write_text('#include ' + json.dumps(str(header)) + '\nvoid convert(const int16_t *in,int16_t *out,size_t frames,int channels,int gain,ScRecognitionPCM *stats){*stats=sc_recognition_pcm(in,out,frames,channels,gain);}\n')
            subprocess.run(['cc', '-shared', '-fPIC', '-O2', str(source), '-o', str(library)], check=True)
            convert = ctypes.CDLL(str(library)).convert
            convert.argtypes = [ctypes.POINTER(ctypes.c_int16), ctypes.POINTER(ctypes.c_int16), ctypes.c_size_t, ctypes.c_int, ctypes.c_int, ctypes.POINTER(Stats)]
            convert.restype = None
            rng = random.Random(33)
            for channels in (1, 2):
                for frames in (0, 1, 128, 2048):
                    for gain in (1, 4, 8):
                        values = [rng.randrange(-32768, 32768) for _ in range(frames * channels)]
                        left = sum(value * value for value in values[::channels])
                        right = sum(value * value for value in values[1::2]) if channels == 2 else 0
                        channel = int(channels == 2 and right > left)
                        expected = [max(-32768, min(32767, value * gain)) for value in values[channel::channels]]
                        data = (ctypes.c_int16 * len(values))(*values)
                        output = (ctypes.c_int16 * frames)()
                        stats = Stats()
                        convert(data, output, frames, channels, gain, ctypes.byref(stats))
                        self.assertEqual(list(output), expected)
                        self.assertEqual((stats.left_energy, stats.right_energy, stats.channel, stats.frames), (left, right, channel, frames))
                        self.assertEqual(stats.output_energy, sum(value * value for value in expected))
                        self.assertEqual(stats.peak, max(map(abs, expected), default=0))


if __name__ == '__main__':
    unittest.main()
