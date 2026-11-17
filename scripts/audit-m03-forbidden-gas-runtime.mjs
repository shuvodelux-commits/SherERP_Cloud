#!/usr/bin/env node
/**
 * M03 Run 2: static, fail-closed scan of migrated Worker/backend src JS.
 *
 * Frozen legacy/source GAS and HTML are intentionally excluded. This
 * recognizes DIRECT executable legacy service dependencies, not dynamic
 * code evaluation or all 394 source async conversions. No Worker side effect,
 * remote DB binding, secrets, imports of legacy GAS or public RPC.
 */
import {parse} from 'acorn';
import {readdir,readFile} from 'node:fs/promises';
import {join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const BACKEND=join(ROOT,'src');
const SERVICES=new Set([
 'SpreadsheetApp','LockService','PropertiesService','CacheService',
 'Session','Utilities','HtmlService','ScriptApp','DriveApp',
 'UrlFetchApp','ContentService','MailApp','GmailApp','DocumentApp',
 'SlidesApp','FormApp','CalendarApp','Browser','Jdbc'
]);
const GLOBAL_ROOTS=new Set(['globalThis','self','window']);
const IMPORT_SERVICE=/^(?:@types\/)?google-apps-script(?:\/|$)/i;
const BAD_PATH=()=>new Error('Invalid M03 migrated runtime source scope');
const REPORT_SCOPE='src/*.js AST (not source GAS, HTML, or dynamic eval)';
const invalid=()=>new Error('Invalid or forbidden GAS backend runtime dependency');

function safePath(path){
 if(typeof path!=='string'||!/^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.js$/.test(path)||
    path.split('/').some(part=>part==='.'||part==='..'))throw BAD_PATH();
 return path;
}
function sourceText(record){
 if(!record || typeof record!=='object' || Array.isArray(record) ||
    ![Object.prototype,null].includes(Object.getPrototypeOf(record)))throw BAD_PATH();
 const keys=Reflect.ownKeys(record);
 if(keys.length===0 || keys.some(k=>typeof k!=='string'))throw BAD_PATH();
 const result=[];
 for(const key of keys){
  safePath(key);
  const own=Object.getOwnPropertyDescriptor(record,key);
  if(!own?.enumerable||!Object.hasOwn(own,'value')||
     typeof own.value!=='string'||!own.value.trim())throw BAD_PATH();
  result.push([key,own.value]);
 }
 return result.sort((a,b)=>a[0].localeCompare(b[0]));
}
function literalKey(node){
 if(!node)return null;
 if(node.type==='Identifier')return node.name;
 if(node.type==='Literal' && typeof node.value==='string')return node.value;
 if(node.type==='TemplateLiteral' && node.expressions.length===0)
  return node.quasis[0]?.value?.cooked??null;
 return null;
}
function memberChain(node){
 if(node?.type==='ChainExpression')return memberChain(node.expression);
 if(node?.type==='Identifier')return [node.name];
 if(node?.type!=='MemberExpression')return null;
 const prefix=memberChain(node.object);
 if(!prefix)return null;
 const key=literalKey(node.property);
 return key===null?null:[...prefix,key];
}
function isPropertyKeyOnly(node,parents){
 const parent=parents.at(-1);
 const grandparent=parents.at(-2);
 return parent?.type==='Property' && parent.key===node &&
   !parent.computed && !parent.shorthand &&
   grandparent?.type==='ObjectExpression';
}
function isHarmlessMemberProperty(node,parents){
 const parent=parents.at(-1);
 return parent?.type==='MemberExpression' && parent.property===node &&
   !parent.computed && !GLOBAL_ROOTS.has(memberChain(parent.object)?.[0]);
}
function checkAst(file,code){
 let parsed;
 try{parsed=parse(code,{sourceType:'module',ecmaVersion:'latest',allowHashBang:true});}
 catch{throw new Error('M03 migrated runtime syntax review required: '+file);}
 const fail=(symbol)=>{throw new Error('M03 forbidden GAS runtime: '+file+' ('+symbol+')');};
 function visit(node,parents=[]){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const child of node)visit(child,parents);return;}
  const type=node.type;
  if(type==='Identifier' && SERVICES.has(node.name) &&
     !isPropertyKeyOnly(node,parents) && !isHarmlessMemberProperty(node,parents))
   fail(node.name);
  if(type==='ImportDeclaration'||type==='ExportNamedDeclaration'||
     type==='ExportAllDeclaration'||type==='ImportExpression'){
   const source=node.source;
   if(source?.type==='Literal' && typeof source.value==='string' &&
      IMPORT_SERVICE.test(source.value))fail('Apps Script import');
   if(type==='ImportExpression' && source &&
      !(source.type==='Literal'&&typeof source.value==='string'))
    fail('dynamic imported module requires review');
  }
  if(type==='MemberExpression'){
   const path=memberChain(node);
   if(path){
    if(GLOBAL_ROOTS.has(path[0]) && path.length>=2 &&
       (SERVICES.has(path[1]) || (path[1]==='google'&&path[2]==='script')))
      fail(path.slice(1).join('.'));
    if(path[0]==='google' && path[1]==='script')fail('google.script');
   }else{
    const base=memberChain(node.object);
    if(node.computed && base && GLOBAL_ROOTS.has(base[0]))
      fail('dynamic global property requires review');
    if(base && (base[0]==='google'&&base[1]==='script' ||
       GLOBAL_ROOTS.has(base[0])&&base[1]==='google'&&base[2]==='script'))
      fail('dynamic google.script');
   }
  }
  const next=[...parents,node];
  for(const [k,v] of Object.entries(node)){
   if(['start','end','loc','range','raw'].includes(k))continue;
   if(v && typeof v==='object')visit(v,next);
  }
 }
 visit(parsed);
}

/**
 * Input must be a data-only map of backend JS paths to complete source text.
 * The parser reads syntax only, never evals code or logs source values.
 */
export function auditMigratedM03GasRuntime(sources){
 const entries=sourceText(sources);
 for(const [file,code] of entries)checkAst(file,code);
 return Object.freeze({
  status:'MIGRATED_BACKEND_NO_DIRECT_GAS_RUNTIME',
  scope:REPORT_SCOPE,files:entries.length,violations:0
 });
}

/**
 * Traverse only src; refuse filesystem symlinks and directories outside src.
 * No legacy/source, compiled frontend, tests, fixtures, migrations or uploads.
 */
export async function readMigratedM03RuntimeSources(){
 const entries=[];
 async function walk(root){
  const items=(await readdir(root,{withFileTypes:true}))
    .sort((a,b)=>a.name.localeCompare(b.name));
  for(const item of items){
   const absolute=join(root,item.name);
   if(item.isSymbolicLink())throw BAD_PATH();
   if(item.isDirectory())await walk(absolute);
   else if(item.isFile() && item.name.endsWith('.js')){
    const path='src/'+relative(BACKEND,absolute).split(sep).join('/');
    safePath(path);
    entries.push([path,await readFile(absolute,'utf8')]);
   }
  }
 }
 await walk(BACKEND);
 return Object.fromEntries(entries);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3 || process.argv[2]!=='--check')throw BAD_PATH();
  const sources=await readMigratedM03RuntimeSources();
  const result=auditMigratedM03GasRuntime(sources);
  process.stdout.write('M03 direct GAS-runtime AST gate: '+
    result.files+' backend JS modules, 0 direct forbidden services (NOT full GAS port)\n');
 }catch{
  console.error('M03 migrated backend GAS-runtime static gate failed');
  process.exitCode=1;
 }
}
