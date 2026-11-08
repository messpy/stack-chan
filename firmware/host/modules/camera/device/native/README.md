# ESP32 camera lifecycle override

Source: Moddable SDK `80076c48f5ab87ce29de728071b7408599071a12`,
`modules/io/imagein/camera/esp32/camera.c`. LGPL-3.0-or-later; original
copyright retained and license texts included. SDK JavaScript API stays upstream.

Local changes: reject mutex/task allocation failure and dispose failed constructors; consume control notifications during streaming and when slots are
full (without blocking on an exhausted driver pool); handle a null initial framebuffer; acknowledge stop before returning
buffers; coalesce readable callbacks; terminate/deinitialize on explicit close,
retaining only the native record until its one queued callback drains. The queued
callback never invokes JavaScript after close. Native frame count/config stay
upstream (three PSRAM frames); external SDK edits are not copied here.

`archive-camera-native-loop.test.mjs` compiles and executes the production worker
loop with RTOS/camera doubles. Real scheduling, DMA and I2C still require CoreS3
acceptance. `esp_camera_fb_get` and driver deinit can still block inside ESP-IDF;
this patch does not claim a hard real-time teardown deadline.
