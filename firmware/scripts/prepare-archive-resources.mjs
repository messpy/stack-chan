import {copyFile} from 'node:fs/promises';
await copyFile(new URL('../host/app/reminder-tools.json',import.meta.url),new URL('../host/app/reminder-tools.txt',import.meta.url));
