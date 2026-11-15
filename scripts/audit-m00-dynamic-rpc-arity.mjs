#!/usr/bin/env node
/**
 * M00 source-only AST parity for the FOUR dynamic browser RPC callsites.
 * NO Worker RPC registration, permissions, auth, D1, or source writes.
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */
import {parse} from 'acorn';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditM00DynamicRpc,assertM00DynamicRpcSnapshot}
  from './audit-m00-dynamic-rpc.mjs';

const lineAt=(source,index)=>source.slice(0,index).split('\n').length;
function parseSource(text,name){
  try{return parse(text,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});}
  catch(error){throw new Error('Invalid original RPC JavaScript in '+name+': '+error.message);}
}
function walk(node,visit){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)walk(item,visit);return;}
  if(typeof node.type!=='string')return;
  visit(node);
  for(const [key,value] of Object.entries(node)){
    if(key==='start'||key==='end'||key==='loc'||key==='raw')continue;
    if(value && typeof value==='object')walk(value,visit);
  }
}
function syntax(node){
  if(node?.type==='Identifier')return node.name;
  if(node?.type==='MemberExpression'&&!node.computed&&
     node.object?.type==='Identifier'&&node.property?.type==='Identifier')
    return node.object.name+'.'+node.property.name;
  return null;
}
function clientSites(sources){
  const calls=[];
  for(const file of Object.keys(sources).filter(x=>/^[\w.-]+\.html$/.test(x)).sort()){
    const html=sources[file];
    if(typeof html!=='string')throw new Error('Invalid M00 browser source '+file);
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
      const codeOffset=match.index+match[0].indexOf('>')+1;
      const tree=parseSource(match[1],file);
      walk(tree,node=>{
        if(node.type!=='CallExpression'||node.callee?.type!=='Identifier'||
           node.callee.name!=='serverCall')return;
        const first=node.arguments[0];
        if(first?.type==='Literal' && typeof first.value==='string')return;
        if(!first||!syntax(first))
          throw new Error('Unsupported dynamic RPC selector in '+file);
        if(node.arguments.some(x=>x.type==='SpreadElement'))
          throw new Error('Unsupported spread argument in dynamic RPC '+file);
        calls.push({
          frontendFile:file,
          line:lineAt(html,codeOffset+node.start),
          argumentSyntax:syntax(first),
          clientArguments:node.arguments.length-1
        });
      });
    }
  }
  return calls;
}
function backendArity(sources,file,name,cache){
  if(!Object.hasOwn(sources,file))throw new Error('Missing original GAS owner '+file);
  if(!cache.has(file)){
    const tree=parseSource(sources[file],file);
    cache.set(file,tree.body.filter(x=>x.type==='FunctionDeclaration'&&x.id));
  }
  const declarations=cache.get(file).filter(x=>x.id.name===name);
  if(declarations.length!==1)
    throw new Error('Missing or ambiguous original GAS RPC declaration '+name);
  const params=declarations[0].params;
  if(!params.every(x=>x.type==='Identifier'))
    throw new Error('Unsupported original GAS formal parameter for '+name);
  return params.length;
}

export function auditM00DynamicRpcArity({sources,sourceCommit,lexicalSnapshot,dynamicSnapshot}={}){
  // Reuse the strictly bounded method-target discovery; never infer an allowlist.
  const reviewed=auditM00DynamicRpc({sources,sourceCommit,lexicalSnapshot});
  if(dynamicSnapshot)assertM00DynamicRpcSnapshot(reviewed,dynamicSnapshot);
  const client=clientSites(sources);
  if(client.length!==reviewed.callsites.length)
    throw new Error('M00 dynamic RPC callsite count drift');
  const seen=new Set(),lookups=new Map();
  for(const site of client){
    const key=JSON.stringify([site.frontendFile,site.line]);
    if(seen.has(key))throw new Error('Ambiguous dynamic RPC callsite on one source line');
    seen.add(key);
    lookups.set(key,site);
  }
  const parsedBackends=new Map();
  let matched=0;
  const callsites=reviewed.callsites.map(site=>{
    const key=JSON.stringify([site.frontendFile,site.line]);
    const actual=lookups.get(key);
    if(!actual||actual.argumentSyntax!==site.argumentSyntax)
      throw new Error('M00 dynamic RPC callsite or selector drift');
    const targets=site.targets.map(({name,backendFile})=>{
      const backendArguments=backendArity(sources,backendFile,name,parsedBackends);
      if(actual.clientArguments!==backendArguments)
        throw new Error('M00 dynamic RPC arity mismatch: '+site.frontendFile+
          ':'+site.line+' -> '+name);
      matched++;
      return {name,backendFile,backendArguments};
    });
    return {
      frontendFile:site.frontendFile,
      line:site.line,
      argumentSyntax:site.argumentSyntax,
      clientArguments:actual.clientArguments,
      targets
    };
  });
  return {
    formatVersion:1,
    sourceCommit,
    methodology:'AST source-only four dynamic browser RPCs vs original GAS positional formals; not authorization, not a Worker allowlist, not a business port',
    counts:{
      dynamicCallsites:callsites.length,
      possibleTargetPairs:callsites.reduce((n,s)=>n+s.targets.length,0),
      matchedTargetPairs:matched
    },
    callsites
  };
}
export function assertM00DynamicRpcAritySnapshot(current,snapshot){
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw new Error('M00 dynamic RPC arity snapshot drift; review original source contract');
  return true;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const mode=process.argv[2];
    if(!['--write','--check'].includes(mode)||process.argv.length!==3)
      throw new Error('Usage: audit-m00-dynamic-rpc-arity.mjs --write|--check');
    const root=new URL('../',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
    const sourceDir=fileURLToPath(new URL('legacy/source/',root));
    const files=(await readdir(sourceDir)).filter(x=>/\.(gs|html)$/.test(x)).sort();
    const sources=Object.fromEntries(await Promise.all(files.map(async file=>[
      file,await readFile(join(sourceDir,file),'utf8')
    ])));
    const lexicalSnapshot=JSON.parse(await readFile(
      new URL('docs/baseline/m00-rpc-contract-inventory.json',root),'utf8'));
    const dynamicSnapshot=JSON.parse(await readFile(
      new URL('docs/baseline/m00-dynamic-rpc-closure.json',root),'utf8'));
    const result=auditM00DynamicRpcArity({
      sources,sourceCommit:manifest.source.commit,lexicalSnapshot,dynamicSnapshot
    });
    const output=new URL('docs/baseline/m00-dynamic-rpc-arity.json',root);
    if(mode==='--write'){
      await writeFile(output,JSON.stringify(result,null,2)+'\n','utf8');
      process.stdout.write('M00 dynamic RPC arity inventory written (source-only)\n');
    }else{
      assertM00DynamicRpcAritySnapshot(result,JSON.parse(await readFile(output,'utf8')));
      process.stdout.write('M00 dynamic RPC arity verified (source-only)\n');
    }
  })().catch(error=>{
    console.error('M00 dynamic RPC arity audit rejected: '+error.message);
    process.exitCode=1;
  });
}
