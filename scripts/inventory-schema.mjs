#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Remove comments without changing strings or newline positions. */
function withoutComments(source) {
  let result='', quote='', escaped=false, mode='code';
  for(let i=0;i<source.length;i++) {
    const c=source[i], next=source[i+1];
    if(mode==='line') { if(c==='\n'){result+='\n';mode='code';} else result+=' '; continue; }
    if(mode==='block') { if(c==='*'&&next==='/'){result+='  ';i++;mode='code';} else result+=c==='\n'?'\n':' ';continue; }
    if(quote) { result+=c; if(escaped)escaped=false; else if(c==='\\')escaped=true; else if(c===quote)quote='';continue; }
    if(c==='"'||c==="'"||c.charCodeAt(0)===96) {quote=c;result+=c;continue;}
    if(c==='/'&&next==='/'){result+='  ';i++;mode='line';continue;}
    if(c==='/'&&next==='*'){result+='  ';i++;mode='block';continue;}
    result+=c;
  }
  if(mode==='block'||quote)throw new Error('Unterminated comment or source string');
  return result;
}

function literalBlock(source, name) {
  const found=new RegExp('\\b'+name+'\\s*:\\s*\\{').exec(source);
  if(!found)throw new Error('Missing '+name+' block');
  let depth=1, quote='', escaped=false;
  const start=found.index+found[0].length;
  for(let i=start;i<source.length;i++) {
    const c=source[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
    if(c==='{')depth++;
    if(c==='}')depth--;
    if(depth===0)return source.slice(start,i);
  }
  throw new Error('Unclosed '+name+' block');
}

function parseEntries(block, pattern, label, transform) {
  const result=new Map();
  let remainder=block;
  for(const match of block.matchAll(pattern)) {
    if(result.has(match[1]))throw new Error('Duplicate '+label+' key: '+match[1]);
    result.set(match[1],transform(match));
    remainder=remainder.replace(match[0], ' '.repeat(match[0].length));
  }
  if(remainder.replace(/[\s,]/g,'')!=='')throw new Error('Invalid '+label+' literal or unexpected value');
  return result;
}

export function inventorySchema(configSource) {
  const source=withoutComments(configSource);
  const sheets=parseEntries(literalBlock(source,'SHEETS'), /\b([A-Z][A-Z0-9_]*)\s*:\s*("(?:\\.|[^"\\])*")\s*,?/g,'SHEETS',(m)=>JSON.parse(m[2]));
  const headers=parseEntries(literalBlock(source,'HEADERS'),/\b([A-Z][A-Z0-9_]*)\s*:\s*\[([\s\S]*?)\]\s*,?/g,'HEADERS',(m)=>{
    let values;
    try{values=JSON.parse('['+m[2].replace(/,\s*$/,'')+']');}
    catch{throw new Error('Invalid literal header array for '+m[1]);}
    if(!Array.isArray(values)||!values.length||values.some((v)=>typeof v!=='string'||!v))throw new Error('Invalid headers for '+m[1]);
    if(new Set(values).size!==values.length)throw new Error('Duplicate column in '+m[1]);
    return values;
  });
  if(sheets.size!==headers.size||[...sheets.keys()].some((k)=>!headers.has(k)))throw new Error('SHEETS/HEADERS group mismatch');
  return {formatVersion:1,tables:[...sheets].map(([sheetKey,sheetName])=>({sheetKey,sheetName,columns:headers.get(sheetKey)}))};
}

if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
  try{
    const source=await readFile(process.argv[2]||'legacy/source/Config.gs','utf8');
    process.stdout.write(JSON.stringify(inventorySchema(source),null,2)+'\n');
  }catch(e){console.error('M02 schema inventory failed: '+e.message);process.exitCode=1;}
}
