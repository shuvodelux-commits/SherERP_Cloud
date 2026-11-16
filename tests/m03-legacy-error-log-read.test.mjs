import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLegacyErrorLogReadAdapter}
  from '../src/db/legacy-error-log-read.js';

const HEADERS=['Timestamp','Context','Message'];
const ROWS=[
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা 오류  ',_rowIndex:2},
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা 오류  ',_rowIndex:3},
  {Timestamp:'',Context:'Reports',Message:'missing date',_rowIndex:4}
];
const records=()=>ROWS.map(row=>({
  legacy_sheet_row:row._rowIndex,timestamp_text:row.Timestamp,
  context:row.Context,message:row.Message
}));
function mockDB(result={success:true,results:records()}){
  const calls=[];
  const DB={prepare(sql){
    calls.push({sql});
    return {bind(...args){
      calls[calls.length-1].args=args;
      return {async all(){return result}};
    }};
  }};
  return {DB,calls};
}

test('frozen original Config.gs LOGS has exactly three source headers and no Log ID',()=>{
  const source=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  assert.match(source,/LOGS:\s*\["Timestamp", "Context", "Message"\]/);
  assert.equal(HEADERS.includes('Log ID'),false);
  const m02=readFileSync(new URL('../migrations/0006_legacy_error_logs.sql',import.meta.url),'utf8');
  assert.match(m02,/row_id INTEGER PRIMARY KEY AUTOINCREMENT/);
  assert.match(m02,/with NO\s*\n--\s*stable Log ID\./);
});

test('source-shaped LOGS read retains full duplicate rows, blanks, physical indexes and original text',async()=>{
  const {DB,calls}=mockDB();
  const a=createLegacyErrorLogReadAdapter({DB});
  assert.deepEqual(await a.getSheetHeaders_('LOGS'),HEADERS);
  const rows=await a.getAllRows_('LOGS');
  assert.deepEqual(rows,ROWS);
  assert.deepEqual(Object.keys(rows[0]),[...HEADERS,'_rowIndex']);
  assert.equal(rows[0].Message,'  বাংলা 오류  ');
  assert.equal(rows[2].Timestamp,'');
  assert.equal(rows[0].then,undefined);
  assert.equal(rows[0]['Log ID'],undefined);
  rows[0].Message='client-mutated';
  assert.deepEqual(await a.getAllRows_('LOGS'),ROWS);
  assert(calls.every(c=>/^SELECT\s/i.test(c.sql) &&
    /ORDER BY legacy_sheet_row ASC LIMIT\s+\?/i.test(c.sql) &&
    c.args?.length===1 && c.args[0]===1001),
    'only bounded fixed SQL SELECTs allowed');
});

test('original String find semantics preserve identical events and first physical match',async()=>{
  const a=createLegacyErrorLogReadAdapter({DB:mockDB().DB});
  assert.deepEqual(await a.findRows_('LOGS','Context','POS'),ROWS.slice(0,2));
  assert.deepEqual(await a.findRows_('LOGS','Message','  বাংলা 오류  '),ROWS.slice(0,2));
  assert.deepEqual(await a.findFirstRow_('LOGS','Message','  বাংলা 오류  '),ROWS[0]);
  assert.deepEqual(await a.findRow_('LOGS','Message','  বাংলা 오류  '),{
    row:ROWS[0],rowIndex:2
  });
  assert.equal(await a.findRowIndex_('LOGS','Context','Reports'),4);
  assert.equal(await a.findRowIndex_('LOGS','Context','unknown'),-1);
  assert.equal(await a.findFirstRow_('LOGS','Message','বাংলা 오류'),null);
  await assert.rejects(()=>a.findRow_('LOGS','Log ID','not-allowed'),/unsupported|column|header/i);
});

test('unknown source groups and source column names fail before SQL; writes never exposed',async()=>{
  const {DB,calls}=mockDB(),a=createLegacyErrorLogReadAdapter({DB});
  for(const group of ['LOG','SETTINGS','DELETE_LOG','LOGS;DROP TABLE users']){
    await assert.rejects(()=>a.getAllRows_(group),/unsupported|LOGS|sheet/i);
    await assert.rejects(()=>a.getSheetHeaders_(group),/unsupported|LOGS|sheet/i);
  }
  for(const column of ['row_id','legacy_sheet_row','Log ID','Context; DROP TABLE users']){
    await assert.rejects(()=>a.findRows_('LOGS',column,'POS'),/unsupported|column|header/i);
  }
  assert.equal(calls.length,0);
  for(const key of ['appendRow_','updateRowFields_','deleteRow_'])assert.equal(a[key],undefined);
});

test('empty LOGS archive returns empty arrays, null matches, and -1 missing positions',async()=>{
  const a=createLegacyErrorLogReadAdapter({DB:mockDB({success:true,results:[]}).DB});
  assert.deepEqual(await a.getAllRows_('LOGS'),[]);
  assert.deepEqual(await a.findRows_('LOGS','Timestamp',''),[]);
  assert.equal(await a.findFirstRow_('LOGS','Timestamp',''),null);
  assert.equal(await a.findRow_('LOGS','Timestamp',''),null);
  assert.equal(await a.findRowIndex_('LOGS','Timestamp',''),-1);
});

test('missing, NULL, unsafe or gapped physical row provenance fails rather than inventing Log IDs',async()=>{
  for(const item of [
    [records()[0],{...records()[1],legacy_sheet_row:4}],
    [records()[0],{...records()[1],legacy_sheet_row:null}],
    [records()[0],{...records()[1],legacy_sheet_row:2**53}],
    [records()[0],{...records()[1],legacy_sheet_row:2.5}]
  ]){
    const a=createLegacyErrorLogReadAdapter({DB:mockDB({success:true,results:item}).DB});
    await assert.rejects(()=>a.getAllRows_('LOGS'),/invalid|source|physical|row/i);
  }
});

test('a 1001st LOGS event must fail rather than silently truncate',async()=>{
  const large=Array.from({length:1001},(_,i)=>({
    legacy_sheet_row:i+2,timestamp_text:'',context:'dup',message:'same'
  }));
  const a=createLegacyErrorLogReadAdapter({DB:mockDB({success:true,results:large}).DB});
  await assert.rejects(()=>a.getAllRows_('LOGS'),/invalid|limit|1000|archive/i);
});

test('malformed D1, extra private fields, getters or nontext values are rejected with sanitized errors',async()=>{
  assert.throws(()=>createLegacyErrorLogReadAdapter({}),/D1|binding/i);
  const valid=records()[0];
  const getter={...valid};
  Object.defineProperty(getter,'message',{enumerable:true,get(){throw Error('PRIVATE_ERROR_PAYLOAD');}});
  const cases=[
    {success:false,results:[]},
    {success:true,results:[null]},
    {success:true,results:[{...valid,row_id:33}]},
    {success:true,results:[{...valid,context:null}]},
    {success:true,results:[{...valid,message:22}]},
    {success:true,results:[getter]},
    {success:true,results:[{...valid,legacy_sheet_row:undefined}]}
  ];
  for(const response of cases){
    const a=createLegacyErrorLogReadAdapter({DB:mockDB(response).DB});
    let error;
    try{await a.getAllRows_('LOGS')}catch(e){error=e;}
    assert(error instanceof Error,'expected fail-closed invalid D1');
    assert.doesNotMatch(String(error),/PRIVATE_ERROR_PAYLOAD|private user data|constraint/);
  }
  const thrown=createLegacyErrorLogReadAdapter({DB:{prepare(){throw Error('PRIVATE_SQL_ERROR')}}});
  await assert.rejects(()=>thrown.getAllRows_('LOGS'),error=>
    error instanceof Error && !String(error).includes('PRIVATE_SQL_ERROR'));
});
