import {copyFile} from 'node:fs/promises';
await copyFile(new URL('../host/app/reminder-tools.json',import.meta.url),new URL('../host/app/reminder-tools.txt',import.meta.url));

for(const [source,target] of [['face-editor.html','face-editor-page.txt'],['face-editor.js','face-editor-script.txt'],['archive-face-format.js','face-format-script.txt']])await copyFile(new URL('../host/app/'+source,import.meta.url),new URL('../host/app/'+target,import.meta.url));
