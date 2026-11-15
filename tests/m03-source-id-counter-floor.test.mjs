import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {planSourceIdCounterFloor} from '../src/modules/source-id-counter-floor.js';

const source=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const configSource=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
const fn=source.match(/^function generateId_\(idKey\) \{[\s\S]*?^\}/m)?.[0];
const mapping=configSource.match(/\bID_PREFIX:\s*(\{[\s\S]*?\n  \}),/)?.[1];
assert.ok(fn && mapping,'pinned Utils.gs and Config.gs ID contracts required');
const PREFIX=JSON.parse(JSON.stringify(runInNewContext('('+mapping+')')));
const PAD=Number(configSource.match(/\bID_PAD_LENGTH:\s*(\d+)/)?.[1]);
assert.equal(PAD,6);

function oracle({idKey,storedCounter='',existingIds=[]}){
  let saved;
  const nextId=runInNewContext(fn+'\ngenerateId_(idKey)',{
    idKey,
    CONFIG:{ID_PREFIX:PREFIX,ID_PAD_LENGTH:PAD,
      HEADERS:Object.fromEntries(Object.keys(PREFIX).map(k=>[k,['ID']]))},
    PropertiesService:{getDocumentProperties(){return {
      getProperty(key){assert.equal(key,'ID_COUNTER_'+idKey);return storedCounter;},
      setProperty(key,value){assert.equal(key,'ID_COUNTER_'+idKey);saved=value;}
    };}},
    getSheet_(key){
      assert.equal(key,idKey);
      return {getLastRow(){return existingIds.length+1;},
        getRange(first,col,count,width){
          assert.deepEqual([first,col,count,width],[2,1,existingIds.length,1]);
          return {getValues(){return existingIds.map(id=>[id]);}};
        }};
    }
  });
  return {nextId,recordedSequence:Number(saved)};
}
function compare(idKey,storedCounter,existingIds,expected){
  const before=JSON.stringify(existingIds);
  const result=planSourceIdCounterFloor({
    idKey,prefix:PREFIX[idKey],storedCounter,existingIds,padLength:PAD
  });
  const original=oracle({idKey,storedCounter,existingIds});
  assert.equal(result.nextPreviewId,original.nextId,'original GAS next ID');
  assert.equal(result.floor+1,original.recordedSequence,'original GAS property counter');
  assert.equal(result.nextPreviewId,expected);
  assert.equal(JSON.stringify(existingIds),before,'input never mutated');
  return result;
}

test('source high-water scan outranks stale properties and row count after deleted IDs',()=>{
  const r=compare('PRODUCT_CATEGORIES','4',[
    'PCAT-000001','PCAT-000016','PUNT-000055'
  ],'PCAT-000017');
  assert.deepEqual(r,{
    idKey:'PRODUCT_CATEGORIES',prefix:'PCAT',storedCounter:4,
    highestExisting:16,floor:16,nextPreviewId:'PCAT-000017'
  });
});

test('recorded property ahead of sheet IDs and empty catalog both match original',()=>{
  const r=compare('PRODUCT_UNITS','40',['PUNT-000001','PUNT-000002'],'PUNT-000041');
  assert.equal(r.floor,40);
  compare('PRODUCT_UNITS',null,[],'PUNT-000001');
  compare('PRODUCT_UNITS','0',[],'PUNT-000001');
});

test('trusted original Config ID families stay separate, preserve the original pad width',()=>{
  for(const [idKey,existing,expected] of [
    ['SALES',['INV-000003','PUR-000095'],'INV-000004'],
    ['PURCHASES',['PUR-000037','INV-000093'],'PUR-000038'],
    ['CASH_BOOK',['CB-000007'],'CB-000008'],
    ['PRODUCT_CATEGORIES',['PCAT-999999'],'PCAT-1000000'],
    ['PRODUCT_UNITS',['PUNT-2'],'PUNT-000003']
  ])compare(idKey,'1',existing,expected);
  assert.notEqual(PREFIX.SALES,PREFIX.PURCHASES);
});

test('counter preflight quarantines ambiguous or corrupt source-family IDs',()=>{
  for(const bad of [
    'PCAT-000016xyz','PCAT-','PCAT--1','PCAT-+1','PCAT-abc',
    'PCAT-999999999999999999999999'
  ]){
    assert.throws(()=>planSourceIdCounterFloor({
      idKey:'PRODUCT_CATEGORIES',prefix:'PCAT',
      storedCounter:'0',existingIds:[bad],padLength:6
    }),/invalid|ambiguous|unsafe|source|sequence|numeric/i,String(bad));
  }
  for(const rows of [
    ['PCAT-000001','PCAT-000001'],['PCAT-1','PCAT-000001']
  ]){
    assert.throws(()=>planSourceIdCounterFloor({
      idKey:'PRODUCT_CATEGORIES',prefix:'PCAT',storedCounter:0,existingIds:rows,padLength:6
    }),/duplicate|collision|ambiguous/i);
  }
});

test('bad or exhausted stored counters and existing sequences never issue a preview ID',()=>{
  for(const counter of ['-1','1.5','NaN','Infinity','1e3',
    '9007199254740992',-1,1.2,{},[]]){
    assert.throws(()=>planSourceIdCounterFloor({
      idKey:'SALES',prefix:'INV',storedCounter:counter,existingIds:[],padLength:6
    }),/counter|invalid|unsafe/i,String(counter));
  }
  assert.throws(()=>planSourceIdCounterFloor({
    idKey:'SALES',prefix:'INV',storedCounter:Number.MAX_SAFE_INTEGER,
    existingIds:[],padLength:6
  }),/exhausted|safe|overflow/i);
  assert.throws(()=>planSourceIdCounterFloor({
    idKey:'SALES',prefix:'INV',storedCounter:0,
    existingIds:['INV-9007199254740991'],padLength:6
  }),/exhausted|safe|overflow/i);
});

test('untrusted sheet snapshots, unknown keys and malformed prefix/pad are rejected',()=>{
  const accepted={idKey:'SALES',prefix:'INV',storedCounter:0,existingIds:[],padLength:6};
  for(const partial of [
    {idKey:'SALES;DROP TABLE'},{idKey:''},{prefix:'a-long-bad'},{prefix:''},
    {prefix:'INV; DROP'}, {existingIds:null},{existingIds:{}},
    {existingIds:[null]}, {existingIds:[123]}, {existingIds:Array(1)},
    {padLength:0}, {padLength:1.2},{padLength:33},
  ]){
    assert.throws(()=>planSourceIdCounterFloor({...accepted,...partial}),
      /invalid|unsupported|prefix|source|counter|identif|pad/i);
  }
});

test('snapshots and planner output cannot share mutable state or issue any write',()=>{
  const ids=Object.freeze(['INV-000005']);
  const opts=Object.freeze({idKey:'SALES',prefix:'INV',storedCounter:'3',existingIds:ids,padLength:6});
  const a=planSourceIdCounterFloor(opts),b=planSourceIdCounterFloor(opts);
  assert.deepEqual(a,b);
  assert.equal(a.floor,5);
  assert.equal(a.nextPreviewId,'INV-000006');
  const code=readFileSync(new URL('../src/modules/source-id-counter-floor.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/import\s|SpreadsheetApp|PropertiesService|LockService|\.prepare\(|\.run\(|\.batch\(/);
});
