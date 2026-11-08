#!/usr/bin/env python3
"""Align the Moddable CoreS3 GC0308 camera with M5CoreS3's two-PSRAM-buffer policy.

The camera module is loaded from modules/io/imagein/camera/esp32/camera,\nas specified by firmware/host/modules/camera/manifest_device.json.\nApplied only by the CoreS3 archive build, not at runtime. Refuse unexpected
SDK versions rather than silently changing other camera configurations.
The original shared SDK file is kept next to it for manual rollback.
"""
import os
import re
from pathlib import Path

MARKER = "STACKCHAN_CORE_S3_CAMERA_2FB"
SRC = Path("modules/io/imagein/camera/esp32/camera.c")
BACKUP_SUFFIX = ".stackchan-original"
FRAMES = "#define kCameraFrameCount (3)"
FB = ".fb_count = 3,"
GRAB_RE = re.compile(r"(?m)^(\s*)\.grab_mode = CAMERA_GRAB_LATEST,[^\n]*$")


def patch_buffers(source):
    if MARKER in source:
        if (
            "#define kCameraFrameCount (2)" not in source
            or ".fb_count = 2," not in source
            or ".grab_mode = CAMERA_GRAB_WHEN_EMPTY," not in source
        ):
            raise RuntimeError("Existing camera patch is incomplete; review SDK")
        return source
    if source.count(FRAMES) != 1 or source.count(FB) != 1:
        raise RuntimeError("Unexpected SDK camera buffer layout; abort camera patch")
    if len(GRAB_RE.findall(source)) != 1:
        raise RuntimeError("Unexpected SDK camera grab policy; abort camera patch")
    source = source.replace(
        FRAMES,
        "/* " + MARKER + ": CoreS3 stills use two PSRAM frame buffers. */\n"
        "#define kCameraFrameCount (2)",
        1,
    ).replace(FB, ".fb_count = 2,", 1)
    source = GRAB_RE.sub(
        lambda match: match.group(1) + ".grab_mode = CAMERA_GRAB_WHEN_EMPTY,",
        source, count=1,
    )
    return source


LIFECYCLE_MARKER = "STACKCHAN_CAMERA_STOP_NOTIFY"
LOOP = "\twhile (true) {\n\t\tif (kStateClosing == camera->state) {"
STOP = "\txTaskNotify(camera->task, kStateStopping, eSetValueWithOverwrite);\n\n\txSemaphoreTake(camera->mutex, portMAX_DELAY);"


def patch_source(source):
    source = patch_buffers(source)
    if LIFECYCLE_MARKER in source:
        if ("if (kStateRunning == control) running = 1;" not in source
                or "while (kStateIdle != camera->state)" not in source
                or "if (!fb) continue; /* Driver timeout:" not in source):
            raise RuntimeError("Existing camera lifecycle patch is incomplete; review SDK")
        return source
    if source.count(LOOP) != 1 or source.count(STOP) != 1:
        raise RuntimeError("Unexpected SDK camera task lifecycle; abort camera patch")
    # Running capture formerly never consumed stop/close task notifications.
    source = source.replace(LOOP,
        "\twhile (true) {\n"
        "\t\t/* " + LIFECYCLE_MARKER + ": consume control even during capture. */\n"
        "\t\tuint32_t control;\n"
        "\t\tif (xTaskNotifyWait(0, 0, &control, 0) == pdTRUE) {\n"
        "\t\t\tcamera->state = control;\n"
        "\t\t\tif (kStateRunning == control) running = 1;\n"
        "\t\t}\n"
        "\t\tif (kStateClosing == camera->state) {", 1)
    source = source.replace(STOP,
        "\txTaskNotify(camera->task, kStateStopping, eSetValueWithOverwrite);\n"
        "\t/* Do not return DMA buffers while the producer can publish a frame. */\n"
        "\twhile (kStateIdle != camera->state)\n"
        "\t\tmodDelayMilliseconds(1);\n\n"
        "\txSemaphoreTake(camera->mutex, portMAX_DELAY);", 1)
    needle = "\t\t\tcamera_fb_t *fb = esp_camera_fb_get();"
    if source.count(needle) != 1:
        raise RuntimeError("Unexpected SDK frame acquisition; abort camera patch")
    source = source.replace(needle, needle + "\n\t\t\tif (!fb) continue; /* Driver timeout: service control on next loop. */", 1)
    return source


def apply(root):
    path = Path(root) / SRC
    if not path.is_file():
        raise RuntimeError(f"Moddable camera source not found: {path} (check manifest_device.json camera module path)")
    before = path.read_text(encoding="utf8")
    after = patch_source(before)
    if after == before:
        print("[CHECK] CoreS3 camera SDK patch: already applied")
        return
    backup = path.with_name(path.name + BACKUP_SUFFIX)
    if backup.exists() and patch_source(backup.read_text(encoding="utf8")) != after:
        raise RuntimeError(f"SDK backup differs from current source: {backup}")
    if not backup.exists():
        backup.write_text(before, encoding="utf8")
    path.write_text(after, encoding="utf8")
    if patch_source(path.read_text(encoding="utf8")) != after:
        raise RuntimeError("Camera SDK patch verification failed")
    print(f"[CHECK] CoreS3 camera: 2 PSRAM frames, WHEN_EMPTY; SDK backup={backup}")


if __name__ == "__main__":
    sdk = os.environ.get("MODDABLE")
    if not sdk:
        raise SystemExit("[FATAL] STEP=CAMERA_SDK MODDABLE is not set")
    try:
        apply(sdk)
    except (OSError, RuntimeError) as error:
        raise SystemExit("[FATAL] STEP=CAMERA_SDK " + str(error))
