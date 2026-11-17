import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {
 auditM03PrivateD1Terminals,readM03PrivateRuntimeSources,buildM03Run2Acceptance
} from '../scripts/audit-m03-run2-acceptance.mjs';

const sample=(src,path='src/db/example.js')=>({[path]:src});
const good=src=>auditM03PrivateD1Terminals(sample(src));
const bad=src=>assert.throws(()=>good(src),/M03|await|unknown|D1|review|unsafe/i);
const pin='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';

test('Run2 final static audit scans every private M03-controlled db/rpc module, not 12 hand-picked files',async()=>{
 const sources=await readM03PrivateRuntimeSources();
 const paths=Object.keys(sources);
 assert(paths.length>=55,'all src/db + src/rpc .js files must be read, not only previously reviewed 12');
 assert(paths.includes('src/db/expense-category-text-update.js'));
 assert(paths.includes('src/db/m03-sealed-source-lookup.js'));
 assert(paths.includes('src/db/legacy-catalog-read.js'));
 assert(paths.includes('src/db/m04-atomic-g1-sale-proof.js'));
 assert(paths.includes('src/rpc/handler.js'));
 assert(paths.includes('src/rpc/awaited-response-boundary.js'));
 assert(paths.every(p=>/^src\/(db|rpc)\//.test(p)));
 const result=auditM03PrivateD1Terminals(sources);
 assert.equal(result.status,'M03_PRIVATE_D1_TERMINALS_AWAITED');
 assert.equal(result.files,paths.length);
 assert(result.terminals>=50,'all current real D1 terminal calls must be scanned');
 assert(result.byMethod.all>=15);
 assert(result.byMethod.first>=15);
 assert(result.byMethod.batch>=5);
 assert(result.byMethod.run>=1);
 assert.equal(result.violations,0);
 assert.equal(result.publicRpcEnabled,false);
});

test('await and direct return from an ASYNC function safely consume private D1 results',()=>{
 assert.deepEqual(good(`
  export async function one(DB){
   const a=await DB.prepare('SELECT').bind('x').all();
   const b=await DB.prepare('SELECT').first();
   await DB.batch([DB.prepare('INSERT')]);
   await DB.prepare('INSERT').bind('x').run();
   return a.length+b;
  }
 `).byMethod,{all:1,first:1,run:1,batch:1,exec:0});
 assert.equal(good(`
  export const f=async(db)=>db.prepare('SELECT').all();
  export async function x(db){return db.prepare('SELECT').first();}
 `).terminals,2,'async implicit return adopts returned Promise');
 assert.equal(good(`
  export const f=async(DB)=>await Promise.all([
    DB.prepare('SELECT').all(),DB.prepare('SELECT').first()
  ]);
 `).terminals,2);
 assert.equal(good("export async function x(DB){return await DB.batch([]);}").terminals,1);
});

test('missing await at real D1 terminal fails even if function is declared async',()=>{
 for(const s of [
  "export async function f(DB){const rows=DB.prepare('SELECT').all();return rows.map(x=>x);}",
  "export async function f(DB){DB.prepare('INSERT').bind('x').run();return true;}",
  "export async function f(DB){const x=DB.prepare('SELECT').first();return {x};}",
  "export async function f(DB){DB.batch([DB.prepare('INSERT')]);return true;}",
  "export async function f(DB){const p=DB.prepare('SELECT').all();await p;return p;}",
  "export async function f(DB){return {row:DB.prepare('SELECT').first()};}",
  "export function f(DB){return DB.prepare('SELECT').all();}"
 ])bad(s);
});

test('deferred callbacks cannot steal await from a parent function, even with Promise.all',()=>{
 for(const s of [
  "export async function f(DB){return await Promise.all([()=>DB.prepare('SELECT').all()]);}",
  "export async function f(DB){return await Promise.resolve([1].map(()=>DB.prepare('SELECT').first()));}",
  "export async function f(DB){return [1].map(function(){return DB.prepare('SELECT').first();});}",
  "export async function f(DB){return await Promise.all([()=>DB.batch([])]);}"
 ])bad(s);
});

test('unrecognized aliases and computed D1 method property access require review, not silent skip',()=>{
 for(const s of [
  "export async function f(DB){const stmt=DB.prepare('SELECT');return stmt.all();}",
  "export async function f(DB){return DB.prepare('SELECT')['all']();}",
  "export async function f(DB){return DB.prepare('SELECT')[method]();}",
  "export async function f(DB){return DB['batch']([]);}",
  "export async function f(DB){return other.first();}",
  "export async function f(DB){return anObject.run();}",
  "export async function f(DB){return DB['prepare']('SELECT').all();}"
 ])bad(s);
});

test('comments and string literals are not executable SQL, while malformed or hostile input fails closed',()=>{
 assert.deepEqual(good(`
  /* DB.prepare('SELECT').first(); */
  export const message="DB.batch([]); // not code";
  export const f=async function(){return {note:message};};
 `).byMethod,{all:0,first:0,run:0,batch:0,exec:0});
 for(const candidate of [
  null,[],{},sample("function broken("),sample(42),
  sample("export const x=1;","legacy/source/Database.gs"),
  sample("export const x=1;","src/modules/finance.js"),
  sample("export const x=1;","src/../db/escape.js"),
  JSON.parse('{"src/db/valid.js":"export const x=1;","__proto__":"evil"}')
 ])assert.throws(()=>auditM03PrivateD1Terminals(candidate),/M03|invalid|review|source/i);
 let invoked=0;
 const getter=Object.defineProperty({},'src/db/x.js',{
  enumerable:true,get(){invoked++;throw Error('SENSITIVE_D1_SECRET');}
 });
 assert.throws(()=>auditM03PrivateD1Terminals(getter),err=>
  !err.message.includes('SENSITIVE_D1_SECRET'));
 assert.equal(invoked,0);
});

test('Run2 acceptance ledger distinguishes private await coverage from unported GAS + blocked public RPC',async()=>{
 const all=await readM03PrivateRuntimeSources();
 const audited=auditM03PrivateD1Terminals(all);
 const frozen=JSON.parse(readFileSync(new URL(
  '../docs/baseline/m03-async-caller-closure.json',import.meta.url),'utf8'));
 const {rpcRegistry}=await import('../src/rpc/registry.js');
 const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const report=buildM03Run2Acceptance({
  sourceCommit:pin,closure:frozen,privateAudit:audited,registry:rpcRegistry,
  workerSource:worker
 });
 assert.equal(report.status,'PRIVATE_AWAIT_GATE_PASSED__FULL_SOURCE_CONVERSION_BLOCKED');
 assert.equal(report.pinnedSourceFunctions,614);
 assert.equal(report.affectedSourceFunctions,394);
 assert.equal(report.auditedPrivateFiles,audited.files);
 assert.equal(report.auditedD1TerminalCalls,audited.terminals);
 assert.equal(report.productionD1Enabled,false);
 assert.equal(report.financialRpcEnabled,false);
 assert.equal(report.completeSourceToD1Conversion,false,
  'never mislabel a private D1 await audit as all 394 source functions ported');
 assert(report.remainingRequirements.includes('M04 authenticated RPC authority'));
 assert(report.remainingRequirements.includes('M03 SQL-atomic shared posting and reversal kernel'));
 assert.throws(()=>buildM03Run2Acceptance({
  sourceCommit:'f'.repeat(40),closure:frozen,privateAudit:audited,
  registry:rpcRegistry,workerSource:worker
 }),/source|pin|M03/i);
 assert.throws(()=>buildM03Run2Acceptance({
  sourceCommit:pin,closure:frozen,privateAudit:audited,
  registry:{getProductsBootstrap:()=>({success:true})},workerSource:worker
 }),/public|RPC|M03/i);
});

test('offline CLI enforces full private scan and prints honest boundary (never activates public RPC)',()=>{
 const base=new URL('../',import.meta.url);
 const ok=spawnSync(process.execPath,['scripts/audit-m03-run2-acceptance.mjs','--check'],
  {cwd:base,encoding:'utf8'});
 assert.equal(ok.status,0,ok.stderr);
 assert.match(ok.stdout,/private|await/i);
 assert.match(ok.stdout,/394|blocked/i);
 const wrong=spawnSync(process.execPath,
  ['scripts/audit-m03-run2-acceptance.mjs','--enable-public'],
  {cwd:base,encoding:'utf8'});
 assert.notEqual(wrong.status,0);
});
