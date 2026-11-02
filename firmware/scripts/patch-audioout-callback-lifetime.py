#!/usr/bin/env python3
"""Retain ESP32 pins/audioout until queued callbacks have drained after close."""
import os
from pathlib import Path
MARKER='STACKCHAN_AUDIOOUT_CALLBACK_LIFETIME'
def patch_source(source):
 if MARKER in source:return source
 old='#define upUseCount(out) (out)->useCount += 1'
 new='''/* STACKCHAN_AUDIOOUT_CALLBACK_LIFETIME: producer and VM share references. */
#if ESP32
#define upUseCount(out) __atomic_add_fetch(&(out)->useCount, 1, __ATOMIC_SEQ_CST)
#else
#define upUseCount(out) (out)->useCount += 1
#endif'''
 if source.count(old)!=1:raise RuntimeError('SDK audio reference counter changed; review patch')
 source=source.replace(old,new,1)
 old='\tout->useCount -= 1;\n\tif (out->useCount > 0)'
 new='''#if ESP32
\tif (__atomic_sub_fetch(&out->useCount, 1, __ATOMIC_SEQ_CST) > 0)
#else
\tout->useCount -= 1;
\tif (out->useCount > 0)
#endif'''
 if source.count(old)!=1:raise RuntimeError('SDK audio release changed; review patch')
 source=source.replace(old,new,1)
 start=source.index('void deliverCallbacks(void *the, void *refcon, uint8_t *message, uint16_t messageLength)\n{')
 end=source.index('\n#endif',source.index('void queueCallback(modAudioOut out, xsIntegerValue id, xsIntegerValue stream)\n{',start))
 # queueCallback itself contains a Windows #if: use balanced braces to find its end.
 queue=source.index('void queueCallback(modAudioOut out, xsIntegerValue id, xsIntegerValue stream)\n{',start)
 brace=source.index('{',queue);depth=1;end=brace+1
 while depth:
  if source[end]=='{':depth+=1
  elif source[end]=='}':depth-=1
  end+=1
 section=source[start:end]
 section=section.replace('\txsBeginHost(out->the);','''#if ESP32
\tif (out->state >= kStateClosing) {
\t\tout->pendingCallbackCount = 0;
\t\tdownUseCount(out); /* release the queued message without touching closed JS/mutex */
\t\treturn;
\t}
#endif
\txsBeginHost(out->the);''',1)
 section=section.replace('\tupUseCount(out);','''#if !ESP32
\tupUseCount(out);
#endif''',1)
 anchor='\t\txsCatch {\n\t\t}\n\t}'
 if section.count(anchor)!=1:raise RuntimeError('SDK audio callback body changed; review patch')
 section=section.replace(anchor,'''\t\txsCatch {
\t\t}
#if ESP32
\t\tif (out->state >= kStateClosing) {
\t\t\tout->pendingCallbackCount = 0;
\t\t\tbreak;
\t\t}
#endif
\t}''',1)
 old='''\t\tif (1 == out->pendingCallbackCount)
#if defined(_WIN32)
\t\t\tPostMessage(out->hWnd, WM_CALLBACK, 0, (LPARAM)out);
#else
\t\t\tmodMessagePostToMachine(out->the, NULL, 0, deliverCallbacks, out);
#endif'''
 new='''\t\tif (1 == out->pendingCallbackCount) {
#if ESP32
\t\t\tupUseCount(out); /* queued delivery owns a reference, including after close */
\t\t\tif (0 != modMessagePostToMachine(out->the, NULL, 0, deliverCallbacks, out)) {
\t\t\t\tout->pendingCallbackCount = 0;
\t\t\t\tdownUseCount(out);
\t\t\t\tmodLog("audio callback post failed");
\t\t\t}
#elif defined(_WIN32)
\t\t\tPostMessage(out->hWnd, WM_CALLBACK, 0, (LPARAM)out);
#else
\t\t\tmodMessagePostToMachine(out->the, NULL, 0, deliverCallbacks, out);
#endif
\t\t}'''
 if section.count(old)!=1:raise RuntimeError('SDK audio callback poster changed; review patch')
 section=section.replace(old,new,1)
 return source[:start]+section+source[end:]
if __name__=='__main__':
 p=Path(os.environ['MODDABLE'])/'modules/pins/i2s/audioout.c';old=p.read_text();new=patch_source(old)
 if new!=old:p.write_text(new)
 print('SDK queued audio callback lifetime: ready')
