export const readUSB = native('xs_archive_usb_read');
export const writeUSB = native('xs_archive_usb_write');

export const rebootUSB = native('xs_archive_usb_reboot');

// Fail-safe for native camera/JPEG/SD hangs; 60s timer runs outside the JS VM.
export const photoRecoveryWatchdog = native('xs_archive_photo_watchdog');
export const photoRecoveryTriggered = native('xs_archive_photo_watchdog_triggered');

export const convertRGB24 = native('xs_archive_rgb24');

export const randomBytes = native('xs_archive_random');
export const sealVault = native('xs_archive_seal');
export const openVault = native('xs_archive_open');

export const encodeJPEG = native('xs_archive_jpeg');

export const usbConnected = native('xs_archive_usb_connected');

export const initDebugLog = native('xs_archive_log_init');
export const pushDebugLog = native('xs_archive_log_push');
export const popDebugLog = native('xs_archive_log_pop');
export const debugLogStatus = native('xs_archive_log_status');
export const writeDebugUSB = native('xs_archive_debug_write');

export const heapStatus = native('xs_archive_heap_status');
export const prepareRecognitionPCM = native('xs_archive_recognition_pcm');

export const collectMemory = native('xs_archive_collect_memory');
