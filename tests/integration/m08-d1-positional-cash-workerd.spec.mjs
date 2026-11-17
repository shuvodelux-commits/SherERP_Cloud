import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {loadPinnedGASFunctions} from '../fixtures/m08-legacy-source-runner.mjs';
import {M08_POSITIONAL_DDL}
  from '../fixtures/m08-d1-positional-cash-schema.mjs';
import {previewD1PositionalCashReconciliation}
  from '../fixtures/m08-d1-positional-cash-preview.mjs';

// Frozen GAS oracle runs only on synthetic source-shaped fixtures.
const oracle=loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_'],
  'CashReconciliation.gs':[
    'cashReconciliationSigned_','cashReconciliationIsDeleted_',
    'cashReconciliationIsSynthetic_','cashReconciliationParseIds_',
    'cashReconciliationExplanationField_','cashReconciliationRowById_',
    'cashReconciliationLinkedUsage_','cashReconciliationRecalculateClosedSession_'
  ]
});
const plain=value=>JSON.parse(JSON.stringify(value));
const harness=createTestHarness({workers:[
  {configPath:'./wrangler.m08-positional-test.jsonc'}
]});
const worker=harness.getWorker('shererp-m08-positional-read-test');
let DB;
const session=(id,rowIndex=2,fields={})=>({
  _rowIndex:rowIndex,'Session ID':id,'Status':'Closed',
  'Opening Cash':100,'Counted Cash':100,
  'Opening Explanation Entry IDs':'','Closing Explanation Entry IDs':'',
  ...fields
});
const cash=(rowIndex,id,credit=0,debit=0,type='Sale',fields={})=>({
  _rowIndex:rowIndex,'Entry ID':id,'Type':type,'Reference':'',
  'Credit':credit,'Debit':debit,'Is Deleted':'',
  'Date':'2026-11-16',...fields
});
const marker=(row,id,fields={})=>cash(row,'mark-'+id,0,0,'Session Open',{
  'Reference':id,...fields
});
const cents=value=>Math.round(Number(value)*100);
async function seed(tenant,sessions,entries){
  // Deliberately reverse insertion order. Source physical row order must
  // come from immutable legacy_row, never SQL insertion order or Date.
  for(const s of sessions.slice().reverse()){
    await DB.prepare(`INSERT INTO m08_positional_sessions
      (tenant_id,legacy_row,session_id,status,opening_cents,counted_cents,
       opening_entry_ids,closing_entry_ids)
      VALUES(?,?,?,?,?,?,?,?)`)
      .bind(tenant,s._rowIndex,s['Session ID'],s['Status'],
        cents(s['Opening Cash']),
        s['Counted Cash']==='' || s['Counted Cash']==null
          ?null:cents(s['Counted Cash']),
        s['Opening Explanation Entry IDs'],s['Closing Explanation Entry IDs'])
      .run();
  }
  for(const row of entries.slice().reverse()){
    await DB.prepare(`INSERT INTO m08_positional_cash
      (tenant_id,legacy_row,entry_id,type,reference,
       credit_cents,debit_cents,is_deleted,date_text)
      VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(tenant,row._rowIndex,row['Entry ID'],row['Type'],
        row['Reference'],cents(row['Credit']),cents(row['Debit']),
        row['Is Deleted']===true ||
          String(row['Is Deleted']).toUpperCase()==='TRUE'?1:0,
        row['Date']).run();
  }
}
async function snapshot(){
  const result={};
  for(const [name,sql] of Object.entries({
    sessions:'SELECT * FROM m08_positional_sessions ORDER BY tenant_id,legacy_row',
    cash:'SELECT * FROM m08_positional_cash ORDER BY tenant_id,legacy_row'
  }))result[name]=(await DB.prepare(sql).all()).results.map(x=>({...x}));
  return result;
}
async function parity(tenant,sessionId,sessions,entries){
  const sourceSessions=sessions.slice().sort((a,b)=>a._rowIndex-b._rowIndex);
  const sourceCash=entries.slice().sort((a,b)=>a._rowIndex-b._rowIndex);
  const source=sourceSessions.find(x=>x['Session ID']===sessionId);
  const expected=plain(oracle.cashReconciliationRecalculateClosedSession_(
    source,sourceSessions,sourceCash
  ));
  const beforeState=await snapshot();
  const actual=await previewD1PositionalCashReconciliation(
    DB,{tenantId:tenant,sessionId}
  );
  assert.deepEqual(actual,{sessionId,recalculated:expected});
  assert.deepEqual(await snapshot(),beforeState,
    'read-only D1 projection must not mutate either table');
  return actual.recalculated;
}
before(async()=>{await harness.listen();({DB}=await worker.getEnv());});
after(async()=>harness.close());
beforeEach(async()=>{
  for(const table of ['m08_positional_cash','m08_positional_sessions'])
    await DB.prepare('DROP TABLE IF EXISTS '+table).run();
  for(const statement of M08_POSITIONAL_DDL)await DB.prepare(statement).run();
});

test('physical Session Open window ignores dates, synthetic/deleted cash, other session usage and links late closing once',async()=>{
  const sessions=[
    session('S1',2,{'Opening Cash':100,'Counted Cash':143,
      'Opening Explanation Entry IDs':'opening',
      'Closing Explanation Entry IDs':'late'}),
    session('S2',3,{'Closing Explanation Entry IDs':'foreign'})
  ];
  const entries=[
    marker(2,'S1',{Date:'2050-01-01'}),
    cash(3,'sale',30,0,'Sale',{Date:'2050-02-01'}),
    cash(4,'expense',0,10,'Expense',{Date:'1990-01-01'}),
    cash(5,'opening',9),
    cash(6,'foreign',70),
    cash(7,'deleted',400,0,'Sale',{'Is Deleted':'TRUE'}),
    cash(8,'old-adjustment',25,0,'Day Close Adjustment'),
    marker(9,'S2',{Date:'1970-01-01'}),
    cash(10,'late',15,0,'Sale',{Date:'1975-01-01'}),
    cash(11,'unlinked-future',999)
  ];
  await seed('SHOP-A',sessions,entries);
  const actual=await parity('SHOP-A','S1',sessions,entries);
  assert.deepEqual(actual,{expected:135,variance:8});
});

test('inside-window and late closing explanations count once even when stored IDs repeat',async()=>{
  const sessions=[session('S1',2,{'Counted Cash':116,
    'Closing Explanation Entry IDs':'["inside","inside","late"]'})];
  const entries=[
    marker(2,'S1'),cash(3,'inside',7),cash(4,'normal',0),
    marker(5,'NEXT'),cash(6,'late',9)
  ];
  await seed('SHOP-A',sessions,entries);
  assert.deepEqual(await parity('SHOP-A','S1',sessions,entries),
    {expected:116,variance:0});
});

test('explicit counted zero produces negative variance; missing count remains blank',async()=>{
  const sessions=[
    session('ZERO',2,{'Counted Cash':0}),
    session('UNCOUNTED',3,{'Status':'Closing','Counted Cash':''})
  ];
  const entries=[
    marker(2,'ZERO'),cash(3,'cash-in',10),marker(4,'UNCOUNTED'),
    cash(5,'uncounted-in',5)
  ];
  await seed('SHOP-A',sessions,entries);
  assert.deepEqual(await parity('SHOP-A','ZERO',sessions,entries),
    {expected:110,variance:-110});
  assert.deepEqual(await parity('SHOP-A','UNCOUNTED',sessions,entries),
    {expected:105,variance:''});
});

test('real rows lacking Entry ID remain native movement; no session marker returns null',async()=>{
  const sessions=[session('S1')];
  const entries=[marker(2,'S1'),cash(3,'',20),cash(4,'expense',0,5)];
  await seed('SHOP-A',sessions,entries);
  assert.deepEqual(await parity('SHOP-A','S1',sessions,entries),
    {expected:115,variance:-15});
  const absent=await previewD1PositionalCashReconciliation(
    DB,{tenantId:'SHOP-A',sessionId:'NOT-A-SESSION'}
  );
  assert.deepEqual(absent,{sessionId:'NOT-A-SESSION',recalculated:null});
});

test('tenant-scoped source row IDs cannot leak or cross-reconcile even when identifiers overlap',async()=>{
  const sA=[session('S1',2,{'Counted Cash':110})];
  const sB=[session('S1',2,{'Opening Cash':200,'Counted Cash':230})];
  const a=[marker(2,'S1'),cash(3,'shared',10)];
  const b=[marker(2,'S1'),cash(3,'shared',30)];
  await seed('SHOP-A',sA,a);
  await seed('SHOP-B',sB,b);
  assert.deepEqual(await parity('SHOP-A','S1',sA,a),
    {expected:110,variance:0});
  assert.deepEqual(await parity('SHOP-B','S1',sB,b),
    {expected:230,variance:0});
});

test('duplicated imported Cash Book IDs or Session IDs fail closed rather than choosing arbitrary records',async()=>{
  const sessions=[session('S1')];
  const entries=[marker(2,'S1'),cash(3,'reused',1),cash(4,'reused',2)];
  await seed('SHOP-A',sessions,entries);
  await assert.rejects(
    ()=>previewD1PositionalCashReconciliation(DB,{
      tenantId:'SHOP-A',sessionId:'S1'
    }),/Duplicate Cash Book Entry ID/
  );
  await DB.prepare('DELETE FROM m08_positional_cash WHERE legacy_row=4').run();
  await DB.prepare(`INSERT INTO m08_positional_sessions
    (tenant_id,legacy_row,session_id,status,opening_cents,counted_cents,
     opening_entry_ids,closing_entry_ids)
    VALUES('SHOP-A',3,'S1','Closed',10000,10000,'','')`).run();
  await assert.rejects(
    ()=>previewD1PositionalCashReconciliation(DB,{
      tenantId:'SHOP-A',sessionId:'S1'
    }),/Duplicate Cash Session ID/
  );
});

test('malformed identity fails closed, test Worker exposes no reconciliation route and reads remain inert',async()=>{
  const sessions=[session('S1')],entries=[marker(2,'S1'),cash(3,'sale',10)];
  await seed('SHOP-A',sessions,entries);
  const unchanged=await snapshot();
  for(const invalid of [
    null,{}, {tenantId:'SHOP-A;DROP',sessionId:'S1'},
    {tenantId:'SHOP-A',sessionId:''},
    {tenantId:'SHOP-A',sessionId:'S1',sql:'DROP TABLE'},
    {tenantId:'SHOP-A',sessionId:Promise.resolve('S1')}
  ])await assert.rejects(
    ()=>previewD1PositionalCashReconciliation(DB,invalid),TypeError
  );
  await assert.rejects(
    ()=>previewD1PositionalCashReconciliation(null,{
      tenantId:'SHOP-A',sessionId:'S1'
    }),/D1/
  );
  assert.equal((await worker.fetch('https://m08.test/api/rpc',{
    method:'POST',body:JSON.stringify({tenantId:'SHOP-A',sessionId:'S1'})
  })).status,404);
  assert.deepEqual(await snapshot(),unchanged);
});
