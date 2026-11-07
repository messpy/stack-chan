import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src = readFileSync(new URL('../../host/app/archive-usb.c', import.meta.url), 'utf8');

test('20KB USB RPC receive frame is not reserved in internal static BSS', () => {
  assert.match(src, /#define\s+ARCHIVE_USB_PACKET_LIMIT\s+20000\b/);
  assert.match(src, /#define\s+ARCHIVE_USB_LINE_BYTES\s+\(ARCHIVE_USB_PACKET_LIMIT\s*\+\s*5\)/);
  assert.doesNotMatch(src, /static\s+char\s+line\s*\[/);
  assert.match(src, /static\s+char\s*\*line\s*;/);
  assert.match(src, /line\s*=\s*heap_caps_malloc\(ARCHIVE_USB_LINE_BYTES,\s*MALLOC_CAP_SPIRAM\s*\|\s*MALLOC_CAP_8BIT\)/);
  assert.doesNotMatch(src, /heap_caps_malloc\(ARCHIVE_USB_LINE_BYTES,\s*MALLOC_CAP_INTERNAL/);
});

test('USB request parsing retains the full frame boundary and overflow guard', () => {
  const reader = src.slice(src.indexOf('void xs_archive_usb_read('), src.indexOf('void xs_archive_usb_write('));
  assert.ok(reader.indexOf('ensureUSBReceiveBuffer(the)') >= 0);
  assert.ok(reader.indexOf('ensureUSBReceiveBuffer(the)') < reader.indexOf('usb_serial_jtag_read_bytes('));
  assert.match(reader, /if\s*\(used\s*<\s*ARCHIVE_USB_LINE_BYTES\s*-\s*1\)/);
  assert.match(reader, /else\s*\{dropping=1;used=0;\}/);
  assert.match(reader, /strncmp\(line,"@SC ",4\)/);
});

test('USB allocation failure is explicit and memory metrics exclude user data', () => {
  assert.match(src, /if\s*\(!line\)\s*xsUnknownError\("USB receive PSRAM unavailable"\)/);
  assert.match(src, /SC_HEAP_FIELD\("usbRxPSRAMBytes",line\s*\?\s*ARCHIVE_USB_LINE_BYTES\s*:\s*0\)/);
  const metrics = src.slice(src.indexOf('void xs_archive_heap_status('), src.indexOf('#include <math.h>'));
  assert.doesNotMatch(metrics, /SC_HEAP_FIELD\("(?:token|password|transcript|image|audioBytes)"/);
});
