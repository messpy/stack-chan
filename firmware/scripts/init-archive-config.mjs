import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
const example=new URL('../host/app/manifest_archive.example.json',import.meta.url),target=new URL('../host/app/manifest_archive_private.json',import.meta.url);
if(fs.existsSync(target)){console.log('Local archive configuration already exists; no changes made.');process.exit(0);}
const data=JSON.parse(fs.readFileSync(example,'utf8'));data.config.archiveToken=randomBytes(32).toString('hex');fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Created private archive configuration. Credentials are not printed.');
