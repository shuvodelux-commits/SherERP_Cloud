#!/usr/bin/env node
/**
 * M03 Run 2 — source-pinned, reviewed async conversion regression gate.
 *
 * These six files are a small subset of the 394 GAS functions whose
 * repository-facing chains need conversion. Requiring explicit await at
 * their known D1 calls prevents a Promise silently reaching source-style
 * arrays, row indexes and RPC envelopes. THIS IS NOT full async closure.
 *
 * M03 exclusively owns these source-read/RPC boundaries; M02–M09 modules
 * and their business logic are not scanned/modified or claimed migrated.
 */
import {parse} from 'acorn';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// For each reviewed file, require at least one awaited call per symbol.
// All occurrences of reviewed symbols in the file must be awaited.
const REVIEWED=Object.freeze({
  'src/db/legacy-catalog-read.js':Object.freeze([
    'all','getAllRows_','findRows_','findFirstRow_','findRow_'
  ]),
  'src/db/settings-read.js':Object.freeze(['all']),
  'src/db/party-identity-read.js':Object.freeze(['first','all']),
  'src/modules/product-master-options.js':Object.freeze([
    'getAllRows_','getOptions','getSettingsMap_'
  ]),
  'src/modules/source-app-shell-reader.js':Object.freeze(['getAppShellSettings_']),
  'src/rpc/internal-daybook-bootstrap.js':Object.freeze(['getBootstrap'])
});
export const REVIEWED_AWAIT_FILES=Object.freeze(Object.keys(REVIEWED));
const EXPECTED_SITES=Object.freeze({
  'src/db/legacy-catalog-read.js':5,
  'src/db/settings-read.js':2,
  'src/db/party-identity-read.js':2,
  'src/modules/product-master-options.js':4,
  'src/modules/source-app-shell-reader.js':1,
  'src/rpc/internal-daybook-bootstrap.js':1
});


const deny=()=>new Error('M03 reviewed async conversion missing await or invalid source');
const isFn=node=>node?.type==='FunctionDeclaration'||
  node?.type==='FunctionExpression'||node?.type==='ArrowFunctionExpression';
function callName(node){
  const callee=node.callee;
  if(callee.type==='Identifier')return callee.name;
  if(callee.type==='MemberExpression' && callee.computed===false &&
     callee.property?.type==='Identifier')return callee.property.name;
  return null;
}
function allAwaitedCalls(source,required) {
  let ast;
  try{ast=parse(source,{sourceType:'module',ecmaVersion:'latest'});}
  catch{throw deny();}
  const visited=new Map(required.map(name=>[name,0]));
  const visit=(node,parents=[])=>{
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){
      for(const entry of node)visit(entry,parents);
      return;
    }
    if(node.type==='CallExpression'){
      const name=callName(node);
      if(visited.has(name)){
        const fn=[...parents].reverse().find(isFn);
        // An await in an outer async function does NOT await a call inside
        // a deferred callback or mapper. Require await in the SAME fn.
        const fnIndex=parents.lastIndexOf(fn);
        const awaited=fnIndex>=0 &&
          parents.slice(fnIndex+1).some(ancestor=>ancestor.type==='AwaitExpression');
        if(!fn?.async || !awaited)throw deny();
        visited.set(name,visited.get(name)+1);
      }
    }
    const next=[...parents,node];
    for(const [key,value] of Object.entries(node)){
      if(key==='start'||key==='end'||key==='loc'||key==='range')continue;
      if(value && typeof value==='object')visit(value,next);
    }
  };
  visit(ast);
  if([...visited.values()].some(n=>n<1))throw deny();
  return [...visited.values()].reduce((sum,n)=>sum+n,0);
}

/**
 * Deterministic static contract, not a runtime adapter or a production gate.
 * Source input must contain EXACTLY the reviewed six modules and data-only
 * source strings; nothing is evaluated, deployed or introspected from D1.
 */
export function auditReviewedM03AwaitChains(sources){
  if(!sources||typeof sources!=='object'||Array.isArray(sources)||
     ![null,Object.prototype].includes(Object.getPrototypeOf(sources)))
    throw deny();
  const keys=Reflect.ownKeys(sources);
  if(keys.length!==REVIEWED_AWAIT_FILES.length ||
     keys.some(k=>typeof k!=='string'||!Object.hasOwn(REVIEWED,k)))
    throw deny();
  let total=0;
  for(const path of REVIEWED_AWAIT_FILES){
    const prop=Object.getOwnPropertyDescriptor(sources,path);
    if(!prop?.enumerable||!Object.hasOwn(prop,'value')||
       typeof prop.value!=='string'||!prop.value.trim())throw deny();
    const count=allAwaitedCalls(prop.value,REVIEWED[path]);
    // Removing one of several expected reads (e.g. one Settings query)
    // must never pass merely because another call uses the same name.
    if(count!==EXPECTED_SITES[path])throw deny();
    total+=count;
  }
  return Object.freeze({
    status:'REVIEWED_M03_AWAITED_ONLY',
    files:REVIEWED_AWAIT_FILES.length,awaitedCallSites:total,
    publicRpcEnabled:false
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3||process.argv[2]!=='--check')throw deny();
    const root=new URL('../',import.meta.url);
    const sources=Object.fromEntries(REVIEWED_AWAIT_FILES.map(path=>
      [path,readFileSync(new URL(path,root),'utf8')]
    ));
    const out=auditReviewedM03AwaitChains(sources);
    if(out.awaitedCallSites!==15)throw deny();
    process.stdout.write('M03 reviewed awaited slice: '+out.files+
      ' source files / '+out.awaitedCallSites+
      ' awaited calls (NOT full 394-function conversion)\n');
  }catch{
    console.error('M03 reviewed async conversion check failed');
    process.exitCode=1;
  }
}
