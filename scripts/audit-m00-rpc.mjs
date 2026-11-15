#!/usr/bin/env node
/**
 * M00 static client RPC cross-reference. NO Worker RPC registration, D1,
 * credentials, GAS execution or source writes.
 */
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

function maskStringsAndComments(source){
  let out='',state='code',escaped=false;
  for(let i=0;i<source.length;i++){
    const c=source[i],next=source[i+1];
    if(state==='line'){
      if(c==='\n'){out+='\n';state='code';}else out+=' ';
      continue;
    }
    if(state==='block' || state==='html'){
      const terminator=state==='block'?'*/':'-->';
      if(source.startsWith(terminator,i)){
        out+=' '.repeat(terminator.length);i+=terminator.length-1;state='code';
      } else out+=c==='\n'?'\n':' ';
      continue;
    }
    if(state==='single'||state==='double'||state==='template'){
      out+=c==='\n'?'\n':' ';
      if(escaped){escaped=false;continue;}
      if(c==='\\'){escaped=true;continue;}
      if((state==='single'&&c==="'")||(state==='double'&&c==='"')||
         (state==='template'&&c==='`'))state='code';
      continue;
    }
    if(source.startsWith('<!--',i)){out+='    ';i+=3;state='html';continue;}
    if(c==='/'&&next==='/'){out+='  ';i++;state='line';continue;}
    if(c==='/'&&next==='*'){out+='  ';i++;state='block';continue;}
    if(c==="'"){out+=' ';state='single';continue;}
    if(c==='"'){out+=' ';state='double';continue;}
    if(c==='`'){out+=' ';state='template';continue;}
    out+=c;
  }
  return out;
}

const lineAt=(text,index)=>text.slice(0,index).split('\n').length;

export function auditM00RpcContracts({sources,sourceCommit}={}){
  if(!sources || typeof sources!=='object' || Array.isArray(sources) ||
     !/^[a-f0-9]{40}$/.test(sourceCommit||''))
    throw new Error('Invalid M00 RPC source input or source commit');

  const names=Object.keys(sources).sort();
  const frontend=names.filter(x=>/^[\w.-]+\.html$/.test(x));
  const backend=names.filter(x=>/^[\w.-]+\.gs$/.test(x));
  if(!frontend.length||!backend.length)throw new Error('Missing GAS frontend or backend files');

  const owners=new Map();
  for(const file of backend){
    const content=sources[file];
    if(typeof content!=='string')throw new Error('Invalid backend file '+file);
    const mask=maskStringsAndComments(content);
    // Only column-zero source declarations are considered GAS globals.
    for(const match of mask.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)){
      const fn=match[1];
      if(!owners.has(fn))owners.set(fn,[]);
      owners.get(fn).push(file);
    }
  }

  const literalCalls=new Map(),dynamicCallsites=[];
  let totalLiterals=0;
  for(const file of frontend){
    const content=sources[file];
    if(typeof content!=='string')throw new Error('Invalid frontend file '+file);
    const mask=maskStringsAndComments(content);
    for(const match of mask.matchAll(/\bserverCall\s*\(/g)){
      const prior=mask.slice(Math.max(0,match.index-50),match.index);
      // Do not treat the shared serverCall implementation as a callsite.
      if(/\bfunction\s+$/.test(prior))continue;
      const argStart=match.index+match[0].length;
      const value=content.slice(argStart).match(/^\s*(['"])([A-Za-z_$][\w$]*)\1\s*(?=[,)])/);
      if(!value){
        dynamicCallsites.push({frontendFile:file,line:lineAt(content,match.index)});
        continue;
      }
      const name=value[2];
      if(!literalCalls.has(name))literalCalls.set(name,{files:new Set(),count:0});
      const entry=literalCalls.get(name);
      entry.files.add(file);entry.count++;totalLiterals++;
    }
  }

  const rpcs=[...literalCalls].sort(([a],[b])=>a.localeCompare(b)).map(([name,detail])=>{
    const defs=owners.get(name)||[];
    if(defs.length>1)throw new Error('Duplicate backend definition for RPC '+name);
    return {name,frontendFiles:[...detail.files].sort(),callCount:detail.count,
      backendFile:defs[0]||null,status:defs.length?'DEFINED':'UNRESOLVED'};
  });
  dynamicCallsites.sort((a,b)=>a.frontendFile.localeCompare(b.frontendFile)||a.line-b.line);
  return {
    formatVersion:1,sourceCommit,
    methodology:'Direct lexical literal RPC calls vs column-zero GAS definitions; not authorization, not a runtime, security, or transitive callgraph proof',
    counts:{frontendFiles:frontend.length,backendFiles:backend.length,
      literalCallsites:totalLiterals,dynamicCallsites:dynamicCallsites.length,
      unresolvedNames:rpcs.filter(x=>x.status==='UNRESOLVED').length},
    rpcs,dynamicCallsites
  };
}

export function assertM00RpcSnapshot(current,snapshot){
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw new Error('M00 RPC inventory drift; review pinned frontend and GAS definitions');
  return true;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const mode=process.argv[2];
    if(!['--write','--check'].includes(mode)||process.argv.length!==3)
      throw new Error('Usage: audit-m00-rpc.mjs --write|--check');
    const root=new URL('../',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
    const sourceDir=fileURLToPath(new URL('legacy/source/',root));
    const filenames=(await readdir(sourceDir)).filter(x=>/\.(gs|html)$/.test(x)).sort();
    const sources=Object.fromEntries(await Promise.all(filenames.map(async file=>[
      file,await readFile(join(sourceDir,file),'utf8')
    ])));
    const inventory=auditM00RpcContracts({sources,sourceCommit:manifest.source.commit});
    const output=new URL('docs/baseline/m00-rpc-contract-inventory.json',root);
    if(mode==='--write'){
      await writeFile(output,JSON.stringify(inventory,null,2)+'\n','utf8');
      process.stdout.write('M00 RPC contracts inventory written (source-only)\n');
    }else{
      assertM00RpcSnapshot(inventory,JSON.parse(await readFile(output,'utf8')));
      process.stdout.write('M00 RPC contracts verified (lexical only)\n');
    }
  })().catch(err=>{
    console.error('M00 RPC audit rejected: '+err.message);
    process.exitCode=1;
  });
}