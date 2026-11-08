import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const run=promisify(execFile);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stackchan-screen-'));
try{
const header=new URL('../../host/app/archive-screen-copy.h',import.meta.url).pathname;
fs.writeFileSync(path.join(temp,'test.c'),`#include <stdint.h>
#include <assert.h>
#include "${header}"
int main(void){uint16_t dst[12]={0},src[]={1,2,3,4,5,6,7,8,9};int c=0;
sc_screen_copy((void*)dst,4,3,1,1,2,2,&c,(void*)src,6);assert(c==3);sc_screen_copy((void*)dst,4,3,1,1,2,2,&c,(void*)(src+3),2);assert(dst[5]==1&&dst[6]==2&&dst[9]==3&&dst[10]==4);assert(dst[0]==0&&dst[11]==0);
memset(dst,0,sizeof(dst));c=0;sc_screen_copy((void*)dst,4,3,-1,-1,3,3,&c,(void*)src,18);assert(c==9);assert(dst[0]==5&&dst[1]==6&&dst[4]==8&&dst[5]==9);assert(dst[2]==0&&dst[11]==0);
c=0;sc_screen_copy((void*)dst,4,3,0,0,0,3,&c,(void*)src,18);assert(c==0);return 0;}`);
await run('cc',['-std=c11','-Wall','-Werror',path.join(temp,'test.c'),'-o',path.join(temp,'test')]);await run(path.join(temp,'test'));
console.log('PASS: native display rectangle copy, split transfers, clipping and zero-width safety');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
