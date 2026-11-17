import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  auditMigratedM03GasRuntime,readMigratedM03RuntimeSources
} from '../scripts/audit-m03-forbidden-gas-runtime.mjs';

const one=(code,path='src/db/reviewed-adapter.js')=>({[path]:code});
const forbidden=[
  'SpreadsheetApp','LockService','PropertiesService','CacheService',
  'Session','Utilities','HtmlService','ScriptApp','DriveApp',
  'UrlFetchApp','ContentService'
];

test('M03 CI checks every migrated Worker backend src JS file; never treats frozen GAS as a port',async()=>{
  const entries=await readMigratedM03RuntimeSources();
  assert(Object.keys(entries).length>80,'all migrated src modules must be collected');
  assert(Object.keys(entries).every(p=>p.startsWith('src/')&&p.endsWith('.js')));
  assert(Object.keys(entries).some(p=>p==='src/index.js'));
  assert(Object.keys(entries).some(p=>p==='src/rpc/handler.js'));
  assert(Object.keys(entries).some(p=>p==='src/db/legacy-catalog-read.js'));
  assert(Object.keys(entries).some(p=>p==='src/db/m03-sealed-source-lookup.js'));
  assert(Object.keys(entries).every(p=>!p.startsWith('legacy/')&&!p.includes('tests/')));
  assert.deepEqual(auditMigratedM03GasRuntime(entries),{
    status:'MIGRATED_BACKEND_NO_DIRECT_GAS_RUNTIME',
    scope:'src/*.js AST (not source GAS, HTML, or dynamic eval)',
    files:Object.keys(entries).length,
    violations:0
  });
  const frozen=readFileSync(new URL('../legacy/source/Database.gs',import.meta.url),'utf8');
  assert.match(frozen,/SpreadsheetApp|CacheService|Utilities|LockService|Session|PropertiesService|getSheet_/);
});

test('all original GAS service globals are forbidden in executable migrated JavaScript',()=>{
  for(const name of forbidden){
    const samples=[
      `export const read=()=>${name}.getActive();`,
      `async function f(){return await ${name}.getActive();} export {f};`,
      `const service=${name}; export {service};`,
      `const {service}={service:${name}}; export {service};`,
      `function ${name}(){return 0;} export {${name}};`
    ];
    for(const code of samples)assert.throws(()=>auditMigratedM03GasRuntime(one(code)),
      /forbidden|GAS|runtime|review/i,name);
  }
});

test('globalThis or self bracket/optional GAS lookup cannot hide an unresolved service',()=>{
  for(const code of [
    'export const x=globalThis.SpreadsheetApp;',
    "export const x=globalThis['LockService'];",
    'export const x=self?.PropertiesService;',
    "export const x=globalThis['Cache' + 'Service'];",
    'export const x=globalThis[serviceName];',
    "export const x=globalThis[`Session`];",
    'const {SpreadsheetApp:legacy}=globalThis; export {legacy};'
  ])assert.throws(()=>auditMigratedM03GasRuntime(one(code)),
    /forbidden|GAS|dynamic|runtime|review/i);
});

test('google.script.run and computed variants remain a browser/GAS boundary, not Worker RPC',()=>{
  for(const code of [
    'export const f=()=>google.script.run.doSomething();',
    "export const f=()=>google['script']['run'].doSomething();",
    'export const f=()=>google.script;',
    "export const f=()=>globalThis['google'].script.run;",
    'export const f=()=>globalThis.google.script.run;',
    'export const f=()=>google?.script?.run;'
  ])assert.throws(()=>auditMigratedM03GasRuntime(one(code)),/forbidden|GAS|runtime/i);
});

test('Apps Script import and re-export requests cannot turn source services into Worker dependencies',()=>{
  for(const code of [
    "import {SpreadsheetApp as Sheets} from 'google-apps-script'; export {Sheets};",
    "import 'google-apps-script';",
    "export * from '@types/google-apps-script';",
    "export async function f(){return import('google-apps-script');}"
  ])assert.throws(()=>auditMigratedM03GasRuntime(one(code)),/forbidden|GAS|runtime/i);
});

test('comments, docstrings, harmless object properties, literal source hints and old source stay unchanged',()=>{
  const clean=`
    // SpreadsheetApp.getActiveSpreadsheet() lives in original GAS only
    /* google.script.run is in legacy/source/javascript.html */
    export const notes="LockService \\n PropertiesService google.script.run Utilities";
    const x={SpreadsheetApp:'source tag',CacheService:'source label'};
    export const y=x.SpreadsheetApp;
    export const z='globalThis[\\'SpreadsheetApp\\']';
  `;
  assert.deepEqual(auditMigratedM03GasRuntime(one(clean)),{
    status:'MIGRATED_BACKEND_NO_DIRECT_GAS_RUNTIME',
    scope:'src/*.js AST (not source GAS, HTML, or dynamic eval)',
    files:1,violations:0
  });
});

test('source input is confined to exact src JS paths, valid own code and parseable modules',()=>{
  for(const entries of [
    null,[],{},one('export const x=1;','legacy/source/Database.gs'),
    one('export const x=1;','tests/fixtures/m03-worker.js'),
    one('export const x=1;','src/../legacy/source/Database.gs'),
    one('function broken( {'),
    one(42),
    {'src/db/ok.js':'export const x=1;', '__proto__':'forged'}
  ])assert.throws(()=>auditMigratedM03GasRuntime(entries),/invalid|source|GAS|parse|review/i);
  let access=0;
  const poisoned=Object.defineProperty({},'src/db/ok.js',{
    enumerable:true,get(){access++;throw Error('PRIVATE_SQL');}
  });
  assert.throws(()=>auditMigratedM03GasRuntime(poisoned),err=>
    err instanceof Error && !err.message.includes('PRIVATE_SQL'));
  assert.equal(access,0);
});

test('source scanner never enables public RPC or changes Worker D1 binding policy',()=>{
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('auditMigratedM03GasRuntime'),false);
  assert.equal(rpc.includes('auditMigratedM03GasRuntime'),false);
  assert.match(live,/database:'not-connected'/);
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
});
