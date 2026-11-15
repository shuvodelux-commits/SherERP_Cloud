#!/usr/bin/env node
/**
 * M00 source-only first-positional-session-token audit.
 * NO Worker RPC registration, authentication, D1, or client changes.
 * Original Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 */
import {parse} from 'acorn';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditM00DynamicRpcArity,assertM00DynamicRpcAritySnapshot}
  from './audit-m00-dynamic-rpc-arity.mjs';

const lineAt=(source,index)=>source.slice(0,index).split('\n').length;

function ast(js,file){
  try{
    return parse(js,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
  }catch{
    throw new Error('Unable to parse frozen original JavaScript in '+file);
  }
}

function walk(node,visitor){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)walk(item,visitor);return;}
  if(typeof node.type!=='string')return;
  visitor(node);
  for(const [key,value] of Object.entries(node)){
    if(key==='start'||key==='end'||key==='loc'||key==='raw')continue;
    if(value&&typeof value==='object')walk(value,visitor);
  }
}

function syntax(node){
  if(node?.type==='Identifier')return node.name;
  if(node?.type==='MemberExpression'&&!node.computed&&
    node.object?.type==='Identifier'&&node.property?.type==='Identifier')
    return node.object.name+'.'+node.property.name;
  return null;
}

function browserCalls(sources){
  const calls=new Map();
  let total=0;
  for(const file of Object.keys(sources).filter(x=>/^[\w.-]+\.html$/.test(x)).sort()){
    const html=sources[file];
    if(typeof html!=='string')throw new Error('Invalid M00 browser source '+file);
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
      const codeOffset=match.index+match[0].indexOf('>')+1;
      walk(ast(match[1],file),node=>{
        if(node.type!=='CallExpression'||node.callee?.type!=='Identifier'||
          node.callee.name!=='serverCall')return;
        const selector=node.arguments[0];
        if(selector?.type==='Literal'&&typeof selector.value==='string')return;
        const line=lineAt(html,codeOffset+node.start);
        const key=JSON.stringify([file,line]);
        if(calls.has(key))throw new Error('Ambiguous dynamic browser RPC source location');
        calls.set(key,{argumentSyntax:syntax(selector),firstArgument:node.arguments[1]});
        total++;
      });
    }
  }
  return {calls,total};
}

function firstBackendFormal(sources,file,method,cache){
  if(!Object.hasOwn(sources,file)||typeof sources[file]!=='string')
    throw new Error('Missing pinned GAS RPC source');
  if(!cache.has(file))
    cache.set(file,ast(sources[file],file).body.filter(x=>
      x.type==='FunctionDeclaration'&&x.id?.type==='Identifier'));
  const methods=cache.get(file).filter(x=>x.id.name===method);
  if(methods.length!==1)throw new Error('Missing or ambiguous original GAS RPC method');
  const first=methods[0].params[0];
  if(first?.type!=='Identifier')throw new Error('Unsupported first backend token formal');
  return first.name;
}

/**
 * Frozen-source token *position* only. Does not authenticate token, check
 * permissions, or authorize these candidate names in the Worker registry.
 */
export function auditM00DynamicRpcSessionFirst({
  sources,sourceCommit,lexicalSnapshot,dynamicSnapshot,aritySnapshot
}={}){
  const reviewed=auditM00DynamicRpcArity({
    sources,sourceCommit,lexicalSnapshot,dynamicSnapshot
  });
  if(aritySnapshot)assertM00DynamicRpcAritySnapshot(reviewed,aritySnapshot);
  const {calls,total}=browserCalls(sources);
  if(total!==reviewed.callsites.length)
    throw new Error('Dynamic RPC session callsite count drift');
  const parsedBackends=new Map();
  let checkedTargets=0;
  const callsites=reviewed.callsites.map(site=>{
    const found=calls.get(JSON.stringify([site.frontendFile,site.line]));
    if(!found||found.argumentSyntax!==site.argumentSyntax)
      throw new Error('Dynamic RPC source selector drift');
    if(found.firstArgument?.type!=='Identifier'||
      found.firstArgument.name!=='authToken')
      throw new Error('Dynamic RPC first session token position mismatch');
    const targets=site.targets.map(({name,backendFile})=>{
      const firstBackendParameter=firstBackendFormal(
        sources,backendFile,name,parsedBackends
      );
      if(firstBackendParameter!=='token')
        throw new Error('Dynamic RPC first backend token parameter mismatch: '+name);
      checkedTargets++;
      return {name,backendFile,firstBackendParameter};
    });
    return {
      frontendFile:site.frontendFile,
      line:site.line,
      argumentSyntax:site.argumentSyntax,
      clientFirstArgument:'authToken',
      targets
    };
  });
  return {
    formatVersion:1,
    sourceCommit,
    methodology:'Original AST dynamic RPC session variable and GAS first-formal position only; not authentication, not authorization, not an RPC allowlist or runtime proof',
    counts:{dynamicCallsites:callsites.length,checkedTargets},
    callsites
  };
}

export function assertM00DynamicRpcSessionSnapshot(current,snapshot){
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw new Error('M00 dynamic RPC session source snapshot drift');
  return true;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const mode=process.argv[2];
    if(!['--check','--write'].includes(mode)||process.argv.length!==3)
      throw new Error('Usage: audit-m00-dynamic-rpc-session.mjs --check|--write');
    const root=new URL('../',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
    const dir=fileURLToPath(new URL('legacy/source/',root));
    const files=(await readdir(dir)).filter(x=>/\.(gs|html)$/.test(x)).sort();
    const sources=Object.fromEntries(await Promise.all(files.map(async file=>[
      file,await readFile(join(dir,file),'utf8')
    ])));
    const load=async name=>JSON.parse(await readFile(
      new URL('docs/baseline/'+name+'.json',root),'utf8'
    ));
    const result=auditM00DynamicRpcSessionFirst({
      sources,sourceCommit:manifest.source.commit,
      lexicalSnapshot:await load('m00-rpc-contract-inventory'),
      dynamicSnapshot:await load('m00-dynamic-rpc-closure'),
      aritySnapshot:await load('m00-dynamic-rpc-arity')
    });
    const output=new URL('docs/baseline/m00-dynamic-rpc-session.json',root);
    if(mode==='--write'){
      await writeFile(output,JSON.stringify(result,null,2)+'\n','utf8');
      process.stdout.write('M00 dynamic RPC session token snapshot written (source-only)\n');
    }else{
      assertM00DynamicRpcSessionSnapshot(result,await load('m00-dynamic-rpc-session'));
      process.stdout.write('M00 dynamic RPC session token verified (source-only)\n');
    }
  })().catch(error=>{
    console.error('M00 dynamic RPC session audit rejected: '+error.message);
    process.exitCode=1;
  });
}
