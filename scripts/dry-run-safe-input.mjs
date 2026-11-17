/**
 * M02-safe private local JSON input. Never fetch a URL, follow a final-path
 * symlink or read a device/FIFO. Error messages intentionally omit file paths.
 */
import {open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
const MAX_INPUT_BYTES=64*1024*1024;
export async function readLocalJsonFile(input){
 if(typeof input!=='string'||!input.trim()||input.length>4096||
    input.startsWith('-')||/^[a-z][a-z0-9+.-]*:/i.test(input))
  throw new Error('M02 local input rejected');
 const path=resolve(input);
 let stat;
 try{stat=await lstat(path);}
 catch{throw new Error('M02 local input rejected');}
 if(!stat.isFile()||stat.size<1||stat.size>MAX_INPUT_BYTES)
  throw new Error('M02 local input rejected');
 let handle;
 try{
  handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const actual=await handle.stat();
  if(!actual.isFile()||actual.size<1||actual.size>MAX_INPUT_BYTES||
     actual.ino!==stat.ino||actual.dev!==stat.dev)
   throw new Error('M02 local input rejected');
  const raw=await handle.readFile({encoding:'utf8'});
  if(Buffer.byteLength(raw,'utf8')>MAX_INPUT_BYTES)
   throw new Error('M02 local input rejected');
  return JSON.parse(raw);
 }catch{
  throw new Error('M02 local input rejected');
 }finally{
  if(handle)await handle.close();
 }
}
