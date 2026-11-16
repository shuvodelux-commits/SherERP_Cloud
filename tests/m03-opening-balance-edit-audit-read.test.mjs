import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createOpeningBalanceEditAuditReadAdapter}
  from '../src/db/opening-balance-edit-audit-read.js';

const HEADERS = [
  'Audit ID', 'Changed At', 'Entity Type', 'Entity ID', 'Entity Name',
  'Old Opening Balance', 'New Opening Balance', 'Delta',
  'Current Due Before', 'Current Due After', 'Reason', 'Changed By'
];
const FIELDS = [
  'audit_id', 'changed_at_text', 'entity_type', 'entity_id', 'entity_name',
  'old_opening_balance_text', 'new_opening_balance_text', 'delta_text',
  'current_due_before_text', 'current_due_after_text', 'reason', 'changed_by'
];
const SAMPLE = [
  {'Audit ID':'OB-001', 'Changed At':'2026-11-16T12:00Z',
   'Entity Type':'CUSTOMER', 'Entity ID':'C-1', 'Entity Name':'করিম',
   'Old Opening Balance':'-150.00', 'New Opening Balance':'-100.5',
   Delta:'49.5','Current Due Before':'-90.00',
   'Current Due After':'-40.5',Reason:' সংশোধন ', 'Changed By':'শুভ',_rowIndex:2},
  {'Audit ID':'OB-002', 'Changed At':'2026-11-16T12:05Z',
   'Entity Type':'CUSTOMER', 'Entity ID':'C-1', 'Entity Name':'করিম',
   'Old Opening Balance':'-100.5', 'New Opening Balance':'-0.00',
   Delta:'100.50','Current Due Before':'',
   'Current Due After':'-0.00',Reason:' দ্বিতীয় সম্পাদনা ',
   'Changed By':'শুভ',_rowIndex:3}
];
const source = () => SAMPLE.map(row=>({...row}));
const archive = () => source().map(row=>({
  legacy_sheet_row:row._rowIndex,
  ...Object.fromEntries(HEADERS.map((h,i)=>[FIELDS[i],row[h]]))
}));
function fakeDB(data={success:true,results:archive()}){
  const calls=[];
  return {
    calls,
    DB:{prepare(sql){
      calls.push({sql});
      return {bind(...args){
        calls[calls.length-1].args=args;
        return {async all(){return data;}};
      }};
    }}
  };
}
const reader = data => createOpeningBalanceEditAuditReadAdapter({DB:fakeDB(data).DB});

test('frozen original Config.gs declares the 12 exact OPENING_BALANCE_EDIT_LOG columns',()=>{
  const config=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  const at=config.indexOf('    OPENING_BALANCE_EDIT_LOG: [');
  assert(at>=0);
  const end=config.indexOf('    ],',at);
  assert(end>at);
  assert.deepEqual([...config.slice(at,end).matchAll(/"([^"]+)"/g)].map(m=>m[1]),HEADERS);
});

test('internal source adapter preserves signed amounts, negative zero, UTF-8, duplicates and physical row indexes',async()=>{
  const {DB,calls}=fakeDB();
  const a=createOpeningBalanceEditAuditReadAdapter({DB});
  assert.deepEqual(await a.getSheetHeaders_('OPENING_BALANCE_EDIT_LOG'),HEADERS);
  const rows=await a.getAllRows_('OPENING_BALANCE_EDIT_LOG');
  assert.deepEqual(rows,source());
  assert.deepEqual(Object.keys(rows[0]),[...HEADERS,'_rowIndex']);
  assert.equal(rows[1]['New Opening Balance'],'-0.00');
  assert.equal(rows[1]['Current Due After'],'-0.00');
  assert.equal(rows[0]['Entity Name'],'করিম');
  assert.equal(rows[0].Reason,' সংশোধন ');
  assert.equal(rows[0].row_id,undefined);
  assert.equal(rows[0].then,undefined);
  rows[0].Reason='tamper client copy';
  assert.deepEqual(await a.getAllRows_('OPENING_BALANCE_EDIT_LOG'),source());
  assert(calls.every(call=>
    /^SELECT\s/i.test(call.sql) &&
    /ORDER BY legacy_sheet_row ASC LIMIT\s+\?/i.test(call.sql) &&
    call.args?.length===1 && call.args[0]===1001));
});

test('source find helpers compare exact String values and retain repeated entity audit records',async()=>{
  const a=reader({success:true,results:archive()});
  assert.deepEqual(await a.findRows_('OPENING_BALANCE_EDIT_LOG','Entity ID','C-1'),source());
  assert.deepEqual(await a.findFirstRow_('OPENING_BALANCE_EDIT_LOG','Entity ID','C-1'),source()[0]);
  assert.deepEqual(await a.findRow_('OPENING_BALANCE_EDIT_LOG','Audit ID','OB-002'),
    {row:source()[1],rowIndex:3});
  assert.equal(await a.findRowIndex_('OPENING_BALANCE_EDIT_LOG','Audit ID','OB-001'),2);
  assert.equal(await a.findRowIndex_('OPENING_BALANCE_EDIT_LOG','Audit ID','missing'),-1);
  assert.equal(await a.findFirstRow_('OPENING_BALANCE_EDIT_LOG','New Opening Balance','0'),null);
  assert.equal(await a.findFirstRow_('OPENING_BALANCE_EDIT_LOG','Reason','সংশোধন'),null);
});

test('empty archive gives [] / null / -1, while the original header list stays intact',async()=>{
  const a=reader({success:true,results:[]});
  assert.deepEqual(await a.getAllRows_('OPENING_BALANCE_EDIT_LOG'),[]);
  assert.deepEqual(await a.findRows_('OPENING_BALANCE_EDIT_LOG','Entity ID','C-1'),[]);
  assert.equal(await a.findFirstRow_('OPENING_BALANCE_EDIT_LOG','Audit ID','x'),null);
  assert.equal(await a.findRow_('OPENING_BALANCE_EDIT_LOG','Audit ID','x'),null);
  assert.equal(await a.findRowIndex_('OPENING_BALANCE_EDIT_LOG','Audit ID','x'),-1);
  assert.deepEqual(await a.getSheetHeaders_('OPENING_BALANCE_EDIT_LOG'),HEADERS);
});

test('unapproved sheet/header names fail before SQL, and the adapter exposes no financial writes',async()=>{
  const {DB,calls}=fakeDB(),a=createOpeningBalanceEditAuditReadAdapter({DB});
  for(const sheet of ['OPENING_BALANCE','SETTINGS','CUSTOMERS','OPENING_BALANCE_EDIT_LOG; DROP TABLE cash']){
    await assert.rejects(()=>a.getAllRows_(sheet),/source|sheet|unsupported/i);
    await assert.rejects(()=>a.getSheetHeaders_(sheet),/source|sheet|unsupported/i);
  }
  for(const field of ['row_id','audit_id','_rowIndex','Old Opening Balance; DROP TABLE users']){
    await assert.rejects(()=>a.findRows_('OPENING_BALANCE_EDIT_LOG',field,'C-1'),
      /source|column|unsupported/i);
  }
  assert.equal(calls.length,0);
  for(const method of ['appendRow_','updateRowFields_','deleteRow_','postOpeningBalance'])
    assert.equal(a[method],undefined);
});

test('missing or gapped historical physical row denies the entire archive before any record escapes',async()=>{
  for(const positions of [
    [2,4],[2,null],[2,2.5],[2,Number.MAX_SAFE_INTEGER+1],
    [null,3]
  ]){
    const records=archive();
    positions.forEach((n,i)=>{records[i].legacy_sheet_row=n;});
    await assert.rejects(()=>reader({success:true,results:records})
      .getAllRows_('OPENING_BALANCE_EDIT_LOG'),/invalid|archive|source|row/i);
  }
});

test('a 1001st source audit record cannot silently disappear under a bounded D1 read',async()=>{
  const records=Array.from({length:1001},(_,i)=>({
    legacy_sheet_row:i+2,
    audit_id:'OB-'+(i+1),
    changed_at_text:'',entity_type:'CUSTOMER',entity_id:'C-1',entity_name:'',
    old_opening_balance_text:'',new_opening_balance_text:'',delta_text:'',
    current_due_before_text:'',current_due_after_text:'',reason:'',changed_by:''
  }));
  await assert.rejects(()=>reader({success:true,results:records})
    .getAllRows_('OPENING_BALANCE_EDIT_LOG'),/invalid|1000|limit|archive/i);
});

test('invalid D1 reply, duplicate Audit ID, empty Entity identity, unexpected/private keys and accessors fail closed',async()=>{
  assert.throws(()=>createOpeningBalanceEditAuditReadAdapter({}),/D1|binding/i);
  const first=archive()[0],second=archive()[1];
  const getter={...first};
  Object.defineProperty(getter,'reason',{enumerable:true,get(){throw Error('SECRET_AUDIT_REASON');}});
  for(const reply of [
    {success:false,results:[]},
    {success:true,results:[null]},
    {success:true,results:[{...first,row_id:42}]},
    {success:true,results:[{...first,old_opening_balance_text:150}]},
    {success:true,results:[{...first,audit_id:' '}]},
    {success:true,results:[{...first,entity_type:''}]},
    {success:true,results:[{...first,entity_id:' '}]},
    {success:true,results:[getter]},
    {success:true,results:[first,{...second,audit_id:first.audit_id}]}
  ]){
    let error;
    try{await reader(reply).getAllRows_('OPENING_BALANCE_EDIT_LOG');}catch(e){error=e;}
    assert(error instanceof Error,'must never return partial malformed financial audit');
    assert.doesNotMatch(String(error),/SECRET_AUDIT_REASON|SECRET_SQL|row_id/);
  }
  const fail=createOpeningBalanceEditAuditReadAdapter({
    DB:{prepare(){throw Error('SECRET_SQL');}}
  });
  await assert.rejects(()=>fail.getAllRows_('OPENING_BALANCE_EDIT_LOG'),error=>
    error instanceof Error && !String(error).includes('SECRET_SQL'));
});
