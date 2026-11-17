#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Compiled-output-only display guard. The pinned original source, auth policy,
// POS event handlers and all public Worker endpoints remain untouched.
const SOURCE='  body.pos-v2-active #page-pos #v2AddProductBtn {\n';
const GUARD='  body.pos-v2-active #page-pos #v2AddProductBtn[hidden] {\n'+
  '    display: none !important;\n'+
  '  }\n\n';

export function patchPosV2HiddenVisibility(html){
  if(typeof html!=='string')throw new TypeError('Missing compiled POS V2 HTML');
  const sourceCount=html.split(SOURCE).length-1;
  if(sourceCount!==1){
    throw new Error('Original POS V2 Add Product selector missing, duplicate or ambiguous');
  }
  const marker='body.pos-v2-active #page-pos #v2AddProductBtn[hidden]';
  const found=html.split(marker).length-1;
  if(found>1 || (found===1 && !html.includes(GUARD))){
    throw new Error('Duplicate or inconsistent compiled POS V2 hidden rule');
  }
  if(found===1)return html;
  return html.replace(SOURCE,GUARD+SOURCE);
}

if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const file=process.argv[2]||'dist/index.html';
  try{
    const html=await readFile(file,'utf8');
    await writeFile(file,patchPosV2HiddenVisibility(html),'utf8');
    console.log('Compiled POS V2 Products-add visibility guard applied to '+file);
  }catch(error){
    console.error('Compiled POS V2 visibility patch failed: '+error.message);
    process.exitCode=1;
  }
}
