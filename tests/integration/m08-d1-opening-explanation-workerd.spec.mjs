import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {loadPinnedGASFunctions} from '../fixtures/m08-legacy-source-runner.mjs';
import {M08_OPENING_DDL}
  from '../fixtures/m08-d1-opening-explanation-schema.mjs';
import {previewD1OpeningCashExplanation}
  from '../fixtures/m08-d1-opening-explanation-preview.mjs';

const timeZone='Asia/Dhaka';
const plain=x=>JSON.parse(JSON.stringify(x));
const session=(id,row=2,fields={})=>({
  _rowIndex:row,'Session ID':id,'Status':'Closed',
  'Date':'2026-11-16','Opened At':row===2
    ?'2026-11-15T09:00:00+06:00':'2026-11-16T09:00:00+06:00',
  'Opening Cash':100,'Expected Cash':100,'Counted Cash':100,'Variance':0,
  'Opening Explanation Entry IDs':'','Closing Explanation Entry IDs':'',
  ...fields
});
const cash=(id,row,credit=0,debit=0,fields={})=>({
  _rowIndex:row,'Entry ID':id,'Type':debit?'Expense':'Sale',
  'Date':'2026-11-16','Reference':'','Description':'Real business entry',
  'Credit':credit,'Debit':debit,'Is Deleted':'',...fields
});
const prior=(fields={})=>session('PRIOR',2,{
  'Opening Cash':130,'Expected Cash':130,'Counted Cash':130,...fields
});
const target=(fields={})=>session('TARGET',3,{
  'Opening Cash':90,'Expected Cash':90,'Counted Cash':90,...fields
});
const expenses=()=>[cash('OUT-1',20,0,20),cash('OUT-2',21,0,20)];

let sourceSessions=[],sourceCash=[],sourceWriteCount=0;
const oracle=loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_','formatDate_','safeDateOnly_'],
  'CashReconciliation.gs':[
    'cashReconciliationSigned_','cashReconciliationIsDeleted_',
    'cashReconciliationIsSynthetic_','cashReconciliationParseIds_',
    'cashReconciliationExplanationField_','cashReconciliationRequiredDirection_',
    'cashReconciliationRowById_','cashReconciliationEvaluate_',
    'cashReconciliationSortKey_','cashReconciliationBuildRows_',
    'cashReconciliationLinkedUsage_','cashReconciliationFindSessionRow_',
    'cashReconciliationFindBuiltRow_','cashReconciliationPhaseMeta_',
    'saveCashReconciliationExplanation'
  ]
},{
  LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
  CONFIG:{LOCK_TIMEOUT_MS:1000},
  requirePermission_:(token,name,mode)=>{
    assert.deepEqual([token,name,mode],['synthetic','cashReconciliation','edit']);
  },
  getAllRows_:table=>table==='CASH_SESSIONS'?sourceSessions:
    table==='CASH_BOOK'?sourceCash:(()=>{throw new Error('Unexpected source table')})(),
  cashReconciliationRetireLegacyAdjustment_:()=>{sourceWriteCount++;},
  cashReconciliationRecalculateClosedSession_:()=>null,
  updateRowFields_:()=>{sourceWriteCount++;},
  ok_:data=>({success:true,data}),
  fail_:message=>({success:false,error:message}),
  logError_:()=>{},
  Session:{getScriptTimeZone:()=>timeZone},
  Utilities:{formatDate:(value,zone,pattern)=>{
    assert.equal(pattern,'yyyy-MM-dd');
    const parts=new Intl.DateTimeFormat('en-GB',{
      timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(value);
    const part=type=>parts.find(item=>item.type===type).value;
    return [part('year'),part('month'),part('day')].join('-');
  }}
});
const harness=createTestHarness({workers:[
  {configPath:'./wrangler.m08-opening-test.jsonc'}
]});
const worker=harness.getWorker('shererp-m08-opening-read-test');
let DB;
const cents=value=>Math.round(Number(value)*100);
const toCentsOrNull=value=>value===''||value==null?null:cents(value);
const queryAll=async sql=>(await DB.prepare(sql).all()).results.map(x=>({...x}));
async function snapshot(){
  return {
    sessions:await queryAll('SELECT * FROM m08_opening_sessions ORDER BY tenant_id,legacy_row'),
    cash:await queryAll('SELECT * FROM m08_opening_cash ORDER BY tenant_id,legacy_row')
  };
}
async function seed(tenant,sessions,entries){
  // Insertion order is intentionally not source physical row order.
  for(const s of sessions.slice().reverse()){
    await DB.prepare('INSERT INTO m08_opening_sessions(tenant_id,legacy_row,session_id,opened_at,status,opening_cents,expected_cents,counted_cents,variance_cents,opening_entry_ids,closing_entry_ids) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(tenant,s._rowIndex,s['Session ID'],s['Opened At'],s['Status'],
        cents(s['Opening Cash']),toCentsOrNull(s['Expected Cash']),
        toCentsOrNull(s['Counted Cash']),toCentsOrNull(s['Variance']),
        s['Opening Explanation Entry IDs'],s['Closing Explanation Entry IDs'])
      .run();
  }
  for(const row of entries.slice().reverse()){
    await DB.prepare('INSERT INTO m08_opening_cash(tenant_id,legacy_row,entry_id,type,reference,date_text,description,credit_cents,debit_cents,is_deleted) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(tenant,row._rowIndex,row['Entry ID'],row['Type'],row['Reference'],
        row['Date'],row['Description'],cents(row['Credit']),cents(row['Debit']),
        row['Is Deleted']===true||
          String(row['Is Deleted']).toUpperCase()==='TRUE'?1:0)
      .run();
  }
}
const request=(tenantId='SHOP-A',extra={})=>({
  tenantId,sessionId:'TARGET',phase:'opening',
  entryIds:['OUT-1','OUT-2'],timeZone,...extra
});
async function compareSource(tenant,sessions,entries,extra={}){
  const opts=request(tenant,extra);
  sourceSessions=plain(sessions);
  sourceCash=plain(entries);
  sourceWriteCount=0;
  const expected=plain(oracle.saveCashReconciliationExplanation(
    'synthetic',opts.sessionId,opts.phase,opts.entryIds
  ));
  const originalWrites=sourceWriteCount;
  const beforeState=await snapshot();
  if(expected.success){
    const result=await previewD1OpeningCashExplanation(DB,opts);
    assert.deepEqual(result,expected.data);
    assert.equal(originalWrites,2,'frozen source would attempt synthetic writes');
  }else{
    await assert.rejects(
      ()=>previewD1OpeningCashExplanation(DB,opts),
      {message:expected.error}
    );
    assert.equal(originalWrites,0,'frozen source fails before write');
  }
  assert.deepEqual(await snapshot(),beforeState,'D1 opening preview is read-only');
  return expected;
}
async function emptyAll(){
  await DB.prepare('DELETE FROM m08_opening_cash').run();
  await DB.prepare('DELETE FROM m08_opening_sessions').run();
}
before(async()=>{await harness.listen();({DB}=await worker.getEnv());});
after(async()=>harness.close());
beforeEach(async()=>{
  for(const name of ['m08_opening_cash','m08_opening_sessions'])
    await DB.prepare('DROP TABLE IF EXISTS '+name).run();
  for(const ddl of M08_OPENING_DDL)await DB.prepare(ddl).run();
});

test('two actual Cash Out entries explain negative opening difference without a D1 cash movement',async()=>{
  const sessions=[prior(),target()];
  const entries=expenses();
  await seed('SHOP-A',sessions,entries);
  const x=await compareSource('SHOP-A',sessions,entries);
  assert.equal(x.success,true);
  assert.equal(x.data.requiredAmount,40);
  assert.equal(x.data.requiredDirection,'Cash Out');
  assert.deepEqual(x.data.entryIds,['OUT-1','OUT-2']);
});

test('Cash In positive opening difference accepts two-entry normalized JSON/CSV selection',async()=>{
  const sessions=[prior(),target({'Opening Cash':170})];
  const entries=[cash('IN-1',20,10),cash('IN-2',21,30)];
  await seed('SHOP-A',sessions,entries);
  const x=await compareSource('SHOP-A',sessions,entries,{
    entryIds:'IN-1,IN-2,IN-1'
  });
  assert.equal(x.success,true);
  assert.deepEqual(x.data.entryIds,['IN-1','IN-2']);
  const again=await compareSource('SHOP-A',sessions,entries,{
    entryIds:'["IN-2","IN-1","IN-2"]'
  });
  assert.equal(again.success,true);
});

test('historical first opening baseline and earlier session not Closed must refuse new turnover',async()=>{
  const cases=[
    [target(),expenses()],
    [prior({'Status':'Closing'}),target()],
    [prior({'Counted Cash':''}),target()]
  ];
  for(const data of cases){
    await emptyAll();
    const sessions=Array.isArray(data[0])?data[0]:data.length===2 && data[1]._rowIndex
      ?[data[0],data[1]]:[data[0]];
    const entries=Array.isArray(data[1])?data[1]:expenses();
    await seed('SHOP-A',sessions,entries);
    const expected=await compareSource('SHOP-A',sessions,entries);
    assert.equal(expected.success,false);
    assert.match(expected.error,/no difference to explain/);
  }
});

test('explicit prior Closed counted zero differs from missing counted; real Cash In remains an explanation',async()=>{
  const sessions=[
    prior({'Opening Cash':0,'Expected Cash':0,'Counted Cash':0}),
    target({'Opening Cash':30})
  ];
  const entries=[cash('IN-1',20,10),cash('IN-2',21,20)];
  await seed('SHOP-A',sessions,entries);
  const x=await compareSource('SHOP-A',sessions,entries,{
    entryIds:['IN-1','IN-2']
  });
  assert.equal(x.success,true);
  assert.equal(x.data.requiredAmount,30);
});

test('opposite sign, one-cent short, soft-delete, synthetic and missing entries fail source-first',async()=>{
  const cases=[
    [expenses().map(x=>x['Entry ID']==='OUT-2'
      ?{...x,Credit:20,Debit:0,Type:'Sale'}:x),['OUT-1','OUT-2'],/required Cash Out direction/],
    [[cash('OUT-1',20,0,20),cash('OUT-2',21,0,19.99)],
      ['OUT-1','OUT-2'],/total exactly Cash Out 40/],
    [[cash('OUT-1',20,0,20),cash('OUT-2',21,0,20,{'Is Deleted':'TRUE'})],
      ['OUT-1','OUT-2'],/missing or deleted/],
    [[cash('OUT-1',20,0,20),cash('OUT-2',21,0,20,{Type:'Session Open'})],
      ['OUT-1','OUT-2'],/real ERP transaction/],
    [[cash('OUT-1',20,0,20)],['OUT-1','OUT-2'],/missing or deleted/]
  ];
  for(const [entries,entryIds,pattern] of cases){
    await emptyAll();
    const sessions=[prior(),target()];
    await seed('SHOP-A',sessions,entries);
    const x=await compareSource('SHOP-A',sessions,entries,{entryIds});
    assert.equal(x.success,false);
    assert.match(x.error,pattern);
  }
});

test('opening link cannot reuse a Cash Book entry already linked in another session or phase',async()=>{
  for(const sessions of [
    [prior({'Closing Explanation Entry IDs':'OUT-2'}),target()],
    [prior(),target({'Closing Explanation Entry IDs':'OUT-2'})]
  ]){
    await emptyAll();
    const entries=expenses();
    await seed('SHOP-A',sessions,entries);
    const x=await compareSource('SHOP-A',sessions,entries);
    assert.equal(x.success,false);
    assert.match(x.error,/already linked to another reconciliation/);
  }
});

test('full Cash Book records beyond the 250 candidate UI cap still validate selected opening entries',async()=>{
  const sessions=[prior(),target()];
  const entries=expenses().map(x=>({...x,Date:'2025-01-01'}));
  for(let i=0;i<260;i++)
    entries.push(cash('OTHER-'+i,100+i,0,1,{'Date':'2026-11-17'}));
  await seed('SHOP-A',sessions,entries);
  const x=await compareSource('SHOP-A',sessions,entries);
  assert.equal(x.success,true);
});

test('identical legacy IDs in distinct tenants never contaminate source balances or explanations',async()=>{
  const a=[prior(),target()];
  const b=[prior({'Counted Cash':100}),target({'Opening Cash':90})];
  await seed('SHOP-A',a,expenses());
  await seed('SHOP-B',b,[cash('OUT-1',20,0,5),cash('OUT-2',21,0,5)]);
  assert.equal((await compareSource('SHOP-A',a,expenses())).success,true);
  assert.equal((await compareSource('SHOP-B',b,
    [cash('OUT-1',20,0,5),cash('OUT-2',21,0,5)])).success,true);
  assert.deepEqual((await snapshot()).sessions.length,4);
});

test('duplicate imported Session or Cash IDs fail closed, even when source Sheets would choose a row',async()=>{
  await seed('SHOP-A',[prior(),target()],
    [...expenses(),cash('OUT-2',22,0,20)]);
  await assert.rejects(
    ()=>previewD1OpeningCashExplanation(DB,request()),
    /Duplicate Cash Book Entry ID/
  );
  await emptyAll();
  await seed('SHOP-A',[prior(),target(),target({'Session ID':'TARGET',_rowIndex:4})],
    expenses());
  await assert.rejects(
    ()=>previewD1OpeningCashExplanation(DB,request()),
    /Duplicate Cash Session ID/
  );
});

test('malformed identity or untrusted input fails; Worker route remains 404 and D1 unchanged',async()=>{
  await seed('SHOP-A',[prior(),target()],expenses());
  const beforeState=await snapshot();
  for(const invalid of [
    null,{},request('SHOP-A;DROP'),
    request('SHOP-A',{phase:'closing'}),
    request('SHOP-A',{entryIds:Promise.resolve(['OUT-1','OUT-2'])}),
    request('SHOP-A',{entryIds:['OUT-1',5]}),
    request('SHOP-A',{timeZone:''}),
    {...request(),sql:'DELETE FROM m08_opening_cash'}
  ])await assert.rejects(
    ()=>previewD1OpeningCashExplanation(DB,invalid),TypeError
  );
  await assert.rejects(
    ()=>previewD1OpeningCashExplanation(null,request()),/D1/
  );
  assert.equal((await worker.fetch('https://m08.local/api/rpc',{
    method:'POST',body:'{}'
  })).status,404);
  assert.deepEqual(await snapshot(),beforeState);
});
