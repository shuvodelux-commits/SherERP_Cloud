#!/usr/bin/env node
/**
 * M03 Run 2 — exhaustive private repository/RPC D1 await safety audit.
 *
 * This is a safety gate for the current migrated src/db + src/rpc code,
 * NOT automatic migration of the pinned 394 source-affected GAS functions.
 * No source execution, Worker/remote D1 binding, publishing, writes or
 * activation of client-accessible RPC occurs here.
 */
import {parse} from 'acorn';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rpcRegistry} from '../src/rpc/registry.js';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const GITHUB_SOURCE_COMMIT='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const PRIVATE_PATH=/^src\/(?:db|rpc)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js$/;
const TERMINALS=new Set(['all','first','run','batch','exec']);
const METHODS=Object.freeze(['all','first','run','batch','exec']);
const deny=()=>new Error('M03 private D1 terminal await/alias review required');
const unsafe=()=>new Error('Invalid M03 private runtime source or input');
const isFn=node=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression']
 .includes(node?.type);

function sourceEntries(sources){
 try{
  if(!sources || typeof sources!=='object'||Array.isArray(sources)||
     ![null,Object.prototype].includes(Object.getPrototypeOf(sources)))throw unsafe();
  const keys=Reflect.ownKeys(sources);
  if(keys.length===0)throw unsafe();
  const entries=[];
  for(const key of keys){
   if(typeof key!=='string'||!PRIVATE_PATH.test(key)||
      key.split('/').some(x=>x==='.'||x==='..'))throw unsafe();
   const desc=Object.getOwnPropertyDescriptor(sources,key);
   if(!desc?.enumerable||!Object.hasOwn(desc,'value')||
      typeof desc.value!=='string'||!desc.value.trim())throw unsafe();
   entries.push([key,desc.value]);
  }
  return entries.sort((a,b)=>a[0].localeCompare(b[0],'en'));
 }catch{throw unsafe();}
}
function identifier(node){
 if(node?.type==='Identifier')return node.name;
 return null;
}
function propertyName(node){
 if(node?.type!=='MemberExpression'||node.computed)return null;
 return identifier(node.property);
}
function isDB(node){
 if(node?.type==='Identifier')return node.name==='DB'||node.name==='db';
 if(node?.type==='MemberExpression' && !node.computed)
  return ['DB','db'].includes(propertyName(node));
 return false;
}
function hasPrivatePrepare(node){
 if(!node)return false;
 if(node.type==='ChainExpression')return hasPrivatePrepare(node.expression);
 if(node.type==='CallExpression'){
  const callee=node.callee;
  if(propertyName(callee)==='prepare' && isDB(callee.object))return true;
  return hasPrivatePrepare(callee);
 }
 if(node.type==='MemberExpression')return hasPrivatePrepare(node.object);
 return false;
}
function reviewCall(node){
 if(node.type!=='CallExpression')return null;
 const callee=node.callee?.type==='ChainExpression'?
  node.callee.expression:node.callee;
 if(callee?.type!=='MemberExpression')return null;

 // Reject computed method dispatch even when syntactically awaited:
 // aliases and client-influenced properties are not reviewed D1 contracts.
 if(callee.computed &&
    (hasPrivatePrepare(callee.object)||isDB(callee.object))){
  throw deny();
 }
 const name=propertyName(callee);
 // Promise.all is a native combinator, not a D1 terminal. Its enclosed
 // DB calls are inspected separately and must inherit the *same* async
 // function's await (a deferred callback cannot borrow that await).
 if(name==='all' && callee.object?.type==='Identifier' &&
    callee.object.name==='Promise')return null;
 if(name==='prepare' && isDB(callee.object))return null;
 if(!TERMINALS.has(name))return null;
 if(name==='batch'||name==='exec'){
  if(!isDB(callee.object))throw deny();
  return name;
 }
 if(!hasPrivatePrepare(callee.object))throw deny();
 return name;
}
function scanModule(file,code){
 let ast;
 try{ast=parse(code,{sourceType:'module',ecmaVersion:'latest',allowHashBang:true});}
 catch{throw new Error('M03 private D1 module AST parse failed: '+file);}
 const calls=Object.fromEntries(METHODS.map(name=>[name,0]));
 const visit=(node,parents=[])=>{
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){
   for(const child of node)visit(child,parents);
   return;
  }
  if(node.type==='CallExpression'){
   const name=reviewCall(node);
   if(name!==null){
    const fn=[...parents].reverse().find(isFn);
    if(!fn?.async)throw deny();
    const fnAt=parents.lastIndexOf(fn);
    const within=parents.slice(fnAt+1);
    const awaited=within.some(ancestor=>ancestor.type==='AwaitExpression');
    const returned=within.some(ancestor=>
       ancestor.type==='ReturnStatement' && ancestor.argument===node) ||
      (fn.type==='ArrowFunctionExpression' && fn.body===node);
    if(!awaited&&!returned)throw deny();
    calls[name]++;
   }
  }
  const next=[...parents,node];
  for(const [k,v] of Object.entries(node)){
   if(['start','end','loc','raw','range'].includes(k))continue;
   if(v&&typeof v==='object')visit(v,next);
  }
 };
 try{visit(ast);}
 catch{throw new Error('M03 private D1 await/alias review required: '+file);}
 return calls;
}

/**
 * Scope is every source under private src/db + src/rpc. All possible
 * D1-like terminals in that scope must be reviewed explicitly. Unknown
 * alias/computed calls are hard errors; never silently omit from the count.
 */
export function auditM03PrivateD1Terminals(sources){
 const entries=sourceEntries(sources);
 const counts=Object.fromEntries(METHODS.map(name=>[name,0]));
 for(const [file,source] of entries){
  const found=scanModule(file,source);
  for(const name of METHODS)counts[name]+=found[name];
 }
 return Object.freeze({
  status:'M03_PRIVATE_D1_TERMINALS_AWAITED',
  files:entries.length,
  terminals:METHODS.reduce((sum,name)=>sum+counts[name],0),
  byMethod:Object.freeze(counts),violations:0,publicRpcEnabled:false
 });
}

/** Read ONLY M03 single-owner private code; refuse symlinks. */
export async function readM03PrivateRuntimeSources(){
 const records=[];
 for(const directory of ['db','rpc']){
  const base=join(ROOT,'src',directory);
  async function visit(dir){
   const entries=(await readdir(dir,{withFileTypes:true}))
     .sort((a,b)=>a.name.localeCompare(b.name,'en'));
   for(const item of entries){
    if(item.isSymbolicLink())throw unsafe();
    const absolute=join(dir,item.name);
    if(item.isDirectory())await visit(absolute);
    else if(item.isFile() && item.name.endsWith('.js')){
     const path='src/'+directory+'/'+relative(base,absolute).split(sep).join('/');
     if(!PRIVATE_PATH.test(path))throw unsafe();
     records.push([path,await readFile(absolute,'utf8')]);
    }
   }
  }
  await visit(base);
 }
 return Object.fromEntries(records);
}
function ownRecord(value){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
   [null,Object.prototype].includes(Object.getPrototypeOf(value));
}

/**
 * Transparent milestone report: covers newly migrated private D1 terminal
 * calls, NOT 394 legacy source implementations or their browser clients.
 *
 * Full source conversion cannot be asserted from the M03 helper inventory:
 * each original endpoint must have a reviewed source-shaped implementation,
 * M04-authorized private bridge and source/Workerd parity before activation.
 */
export function buildM03Run2Acceptance({
  sourceCommit,closure,privateAudit,registry,workerSource
}={}){
 if(sourceCommit!==GITHUB_SOURCE_COMMIT ||
    !ownRecord(closure)||closure.sourceCommit!==sourceCommit||
    closure.sourceFiles!==47||closure.counts?.totalFunctions!==614||
    closure.counts?.impactedFunctions!==394||
    !Array.isArray(closure.affected)||closure.affected.length!==394)
  throw new Error('M03 source pin or caller closure review required');
 if(!ownRecord(privateAudit) ||
    privateAudit.status!=='M03_PRIVATE_D1_TERMINALS_AWAITED'||
    !Number.isSafeInteger(privateAudit.files)||privateAudit.files<1||
    !Number.isSafeInteger(privateAudit.terminals)||privateAudit.terminals<1||
    privateAudit.violations!==0||privateAudit.publicRpcEnabled!==false)
  throw new Error('M03 private D1 await coverage incomplete');
 if(!ownRecord(registry)||Reflect.ownKeys(registry).length!==0 ||
    typeof workerSource!=='string'||
    !workerSource.includes("database:'not-connected'"))
  throw new Error('M03 unauthorized public RPC or production D1 activation');
 return Object.freeze({
  status:'PRIVATE_AWAIT_GATE_PASSED__FULL_SOURCE_CONVERSION_BLOCKED',
  sourceCommit,pinnedSourceFunctions:614,affectedSourceFunctions:394,
  auditedPrivateFiles:privateAudit.files,
  auditedD1TerminalCalls:privateAudit.terminals,
  productionD1Enabled:false,financialRpcEnabled:false,
  completeSourceToD1Conversion:false,
  remainingRequirements:Object.freeze([
   'Source-by-source 394-function async conversion and business parity',
   'M02 source data and Unified Party account reconciliation',
   'M04 authenticated RPC authority',
   'M03 SQL-atomic shared posting and reversal kernel',
   'Real authenticated end-to-end acceptance before public activation'
  ])
 });
}

async function check(){
 if(process.argv.length!==3||process.argv[2]!=='--check')throw unsafe();
 const sources=await readM03PrivateRuntimeSources();
 const privateAudit=auditM03PrivateD1Terminals(sources);
 const closure=JSON.parse(await readFile(
  new URL('../docs/baseline/m03-async-caller-closure.json',import.meta.url),'utf8'));
 const workerSource=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
 const report=buildM03Run2Acceptance({
  sourceCommit:GITHUB_SOURCE_COMMIT,closure,privateAudit,
  registry:rpcRegistry,workerSource
 });
 process.stdout.write(
  'M03 private D1 await gate passed: '+report.auditedPrivateFiles+
  ' modules, '+report.auditedD1TerminalCalls+
  ' awaited D1 calls; 394 frozen source-affected functions NOT port-verified; '+
  'full Run2 source conversion blocked; no public RPC/production D1\n'
 );
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 check().catch(()=>{console.error('M03 private Run2 acceptance check failed');
  process.exitCode=1;});
}
