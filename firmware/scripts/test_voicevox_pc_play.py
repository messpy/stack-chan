import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

source = Path(__file__).with_name("voicevox-pc-play.py")
spec = importlib.util.spec_from_file_location("voicevox_pc_play", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PCPlayTests(unittest.TestCase):
    def test_new_wav_is_required(self):
        a, b = Path("/tmp/a.wav"), Path("/tmp/b.wav")
        self.assertEqual(module.pick_new_wav({}, {a: (1, 44)}), a)
        with self.assertRaises(ValueError):
            module.pick_new_wav({a: (1, 44)}, {a: (1, 44)})
        with self.assertRaises(ValueError):
            module.pick_new_wav({}, {a: (1, 44), b: (2, 55)})

    def test_small_or_old_wav_does_not_pass(self):
        a = Path("/tmp/a.wav")
        with self.assertRaises(ValueError):
            module.pick_new_wav({}, {a: (1, 23)})

    @patch.object(module.shutil, "which", return_value="/usr/bin/aplay")
    def test_explicit_alsa_player_command(self, which):
        path = Path("/tmp/new.wav")
        self.assertEqual(module.playback_command(path, "aplay", "default"),
                         ["aplay", "-q", "-D", "default", "/tmp/new.wav"])

    @patch.object(module.shutil, "which", return_value="/usr/bin/paplay")
    def test_pulse_player_command(self, which):
        self.assertEqual(module.playback_command(Path("/tmp/new.wav"), "paplay", None),
                         ["paplay", "/tmp/new.wav"])


if __name__ == "__main__":
    unittest.main()
