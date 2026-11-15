#!/usr/bin/env node
/**
 * Frozen M00 literal RPC *source* boundary only.
 * No authentication or RPC registration; never deployed or used for authority.
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */
import {parse} from 'acorn';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditM00RpcContracts,assertM00RpcSnapshot} from './audit-m00-rpc.mjs';

const EXCEPTIONS=Object.freeze({
  getAppShellData:{client:[],backend:[],phase:'PRE_SESSION'},
  login:{client:['mobile','password'],backend:['mobile','password'],phase:'PRE_SESSION'},
  logout:{client:['token'],backend:['token'],phase:'LOGOUT'},
  validateSession:{client:['saved'],backend:['token'],phase:'PRE_SESSION'}
});
const EXCEPTION_NAMES=Object.keys(EXCEPTIONS).sort();
const lineAt=(text,index)=>text.slice(0,index).split('\n').length;
function parsed(js,file){
  try {return parse(js,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});}
  catch {throw new Error('Invalid frozen M00 source JavaScript: '+file);}
}
function walk(node,fn){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const value of node)walk(value,fn);return;}
  if(typeof node.type!=='string')return;
  fn(node);
  for(const [key,value] of Object.entries(node)){
    if(['start','end','loc','raw'].includes(key))continue;
    if(value&&typeof value==='object')walk(value,fn);
  }
}
function originals(sources){
  const owners=new Map();
  for(const file of Object.keys(sources).filter(x=>/^[\w.-]+\.gs$/.test(x)).sort()){
    const functions=parsed(sources[file],file).body.filter(x=>
      x.type==='FunctionDeclaration'&&x.id?.type==='Identifier');
    for(const fn of functions){
      if(!owners.has(fn.id.name))owners.set(fn.id.name,[]);
      owners.get(fn.id.name).push({file,params:fn.params});
    }
  }
  return name=>{
    const found=owners.get(name)||[];
    if(found.length!==1)
      throw new Error('Missing or ambiguous original GAS RPC method: '+name);
    return found[0];
  };
}
function identifierNames(nodes){
  if(nodes.some(x=>x?.type!=='Identifier'))
    throw new Error('Unsupported pre-session RPC argument syntax');
  return nodes.map(x=>x.name);
}

/** Read-only source contract, not server-side authorization or a Worker allowlist. */
export function auditM00LiteralRpcSession({sources,sourceCommit,lexicalSnapshot}={}){
  const lexical=auditM00RpcContracts({sources,sourceCommit});
  if(lexicalSnapshot)assertM00RpcSnapshot(lexical,lexicalSnapshot);
  const names=new Map(lexical.rpcs.map(x=>[x.name,x]));
  const GAS=originals(sources);
  const observed=new Map();
  const exceptions=[];
  let literalCallsites=0,tokenFirstCallsites=0;
  for(const file of Object.keys(sources).filter(x=>/^[\w.-]+\.html$/.test(x)).sort()){
    const html=sources[file];
    if(typeof html!=='string')throw new Error('Invalid M00 HTML source');
    for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
      const offset=match.index+match[0].indexOf('>')+1;
      walk(parsed(match[1],file),node=>{
        if(node.type!=='CallExpression'||node.callee?.type!=='Identifier'||
           node.callee.name!=='serverCall')return;
        const method=node.arguments[0];
        if(method?.type!=='Literal'||typeof method.value!=='string')return;
        const name=method.value;
        const entry=names.get(name);
        const original=GAS(name);
        if(entry && (entry.status!=='DEFINED'||entry.backendFile!==original.file))
          throw new Error('Original GAS RPC owner drift: '+name);
        if(node.arguments.some(x=>x.type==='SpreadElement'))
          throw new Error('Unsupported literal RPC spread argument');
        const inputs=node.arguments.slice(1);
        const params=original.params;
        const line=lineAt(html,offset+node.start);
        observed.set(name,(observed.get(name)||0)+1);
        literalCallsites++;
        if(Object.hasOwn(EXCEPTIONS,name)){
          const allowed=EXCEPTIONS[name];
          if(file!=='javascript.html')
            throw new Error('Unreviewed pre-session or logout RPC exception source');
          const actualClient=identifierNames(inputs);
          const actualBackend=identifierNames(params);
          if(JSON.stringify(actualClient)!==JSON.stringify(allowed.client)||
            JSON.stringify(actualBackend)!==JSON.stringify(allowed.backend))
            throw new Error('Changed original login/session RPC argument order');
          exceptions.push({
            name,frontendFile:file,line,
            clientFirstArgument:actualClient[0]||null,
            backendFirstParameter:actualBackend[0]||null,
            phase:allowed.phase
          });
        }else{
          if(inputs[0]?.type!=='Identifier'||inputs[0].name!=='authToken')
            throw new Error('Literal RPC first session token argument mismatch');
          if(params[0]?.type!=='Identifier'||params[0].name!=='token')
            throw new Error('Literal RPC first backend token parameter mismatch');
          tokenFirstCallsites++;
        }
      });
    }
  }
  if(literalCallsites<lexical.counts.literalCallsites)
    throw new Error('Literal RPC AST/lexical callsite count drift');
  for(const entry of lexical.rpcs){
    if((observed.get(entry.name)||0)<entry.callCount)
      throw new Error('Literal RPC AST lost a lexically indexed method call');
  }
  // The original lexical scanner can undercount HTML script calls. Make the
  // uncovered live AST sites an explicit M00 migration gate, never ignore them.
  const coverageGaps=[...observed].sort(([a],[b])=>a.localeCompare(b))
    .flatMap(([name,actual])=>{
      const indexed=names.get(name)?.callCount||0;
      return actual>indexed?[{name,indexed,actual,missing:actual-indexed}]:[];
    });
  const missingFromLexical=coverageGaps.reduce((n,x)=>n+x.missing,0);
  const counts=Object.fromEntries(EXCEPTION_NAMES.map(name=>[
    name,exceptions.filter(x=>x.name===name).length
  ]));
  if(Object.values(counts).some(n=>n!==1)||exceptions.length!==EXCEPTION_NAMES.length)
    throw new Error('Missing or duplicate reviewed literal RPC exception');
  exceptions.sort((a,b)=>EXCEPTION_NAMES.indexOf(a.name)-EXCEPTION_NAMES.indexOf(b.name));
  return {
    formatVersion:1,sourceCommit,
    methodology:'AST lexical-backed original browser-to-GAS token position inventory; not authentication, not authorization, not a Worker RPC allowlist or full functional port',
    counts:{
      literalCallsites,lexicalCallsites:lexical.counts.literalCallsites,
      missingFromLexical,tokenFirstCallsites,
      exceptionCallsites:exceptions.length,
      distinctMethods:observed.size,lexicalMethods:lexical.rpcs.length
    },
    exceptions,coverageGaps
  };
}
export function assertM00LiteralRpcSessionSnapshot(current,snapshot){
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw new Error('M00 literal RPC session contract snapshot drift');
  return true;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const mode=process.argv[2];
    if(!['--check','--write'].includes(mode)||process.argv.length!==3)
      throw new Error('Usage: audit-m00-literal-rpc-session.mjs --check|--write');
    const root=new URL('../',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
    const dir=fileURLToPath(new URL('legacy/source/',root));
    const files=(await readdir(dir)).filter(x=>/\.(gs|html)$/.test(x)).sort();
    const sources=Object.fromEntries(await Promise.all(files.map(async file=>[
      file,await readFile(join(dir,file),'utf8')
    ])));
    const file=new URL('docs/baseline/m00-literal-rpc-session.json',root);
    const lexicalSnapshot=JSON.parse(await readFile(
      new URL('docs/baseline/m00-rpc-contract-inventory.json',root),'utf8'));
    const result=auditM00LiteralRpcSession({sources,sourceCommit:manifest.source.commit,lexicalSnapshot});
    if(mode==='--write'){
      await writeFile(file,JSON.stringify(result,null,2)+'\n','utf8');
      process.stdout.write('M00 literal RPC session snapshot written (source-only)\n');
    }else{
      const expected=JSON.parse(await readFile(file,'utf8'));
      assertM00LiteralRpcSessionSnapshot(result,expected);
      process.stdout.write('M00 literal RPC session verified (source-only)\n');
    }
  })().catch(error=>{
    console.error('M00 literal RPC session audit rejected: '+error.message);
    process.exitCode=1;
  });
}
