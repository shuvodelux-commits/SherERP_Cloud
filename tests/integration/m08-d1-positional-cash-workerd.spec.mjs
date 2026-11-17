import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {loadPinnedGASFunctions} from '../fixtures/m08-legacy-source-runner.mjs';
import {M08_POSITIONAL_DDL}
  from '../fixtures/m08-d1-positional-cash-schema.mjs';
import {previewD1PositionalCashReconciliation}
  from '../fixtures/m08-d1-positional-cash-preview.mjs';

// Frozen GAS oracle runs only on synthetic source-shaped fixtures.
import {previewD1SQLPositionalClosing}
  from '../fixtures/m08-sql-positional-close-read.mjs';

import {M08_BANK_DDL}
  from '../fixtures/m08-d1-bank-ledger-schema.mjs';
import {previewD1BankLedger}
  from '../fixtures/m08-d1-bank-ledger-preview.mjs';

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


// #452: one read-only D1 SQL statement must reproduce the pinned source
// physical marker-window algorithm without relying on a JS preflight read.
async function sqlParity(tenant,id,sessions,entries){
  const originalSessions=sessions.slice().sort((a,b)=>a._rowIndex-b._rowIndex);
  const originalCash=entries.slice().sort((a,b)=>a._rowIndex-b._rowIndex);
  const source=originalSessions.find(x=>x['Session ID']===id);
  const expected=plain(oracle.cashReconciliationRecalculateClosedSession_(
    source,originalSessions,originalCash
  ));
  const unchanged=await snapshot();
  const result=await previewD1SQLPositionalClosing(DB,{
    tenantId:tenant,sessionId:id
  });
  assert.deepEqual(result,{sessionId:id,recalculated:expected});
  assert.deepEqual(await snapshot(),unchanged,'SQL proof must not mutate D1');
  return result.recalculated;
}

test('M08 SQL source row order: window, opening exclusion, other session use and late close',async()=>{
  const sessions=[
    session('S1',2,{'Counted Cash':143,
      'Opening Explanation Entry IDs':'["opening"]',
      'Closing Explanation Entry IDs':'["late"]'}),
    session('S2',3,{'Closing Explanation Entry IDs':'["foreign"]'})
  ];
  const entries=[
    marker(2,'S1',{Date:'2050-01-01'}),
    cash(3,'sale',30,0,'Sale',{Date:'2050-02-01'}),
    cash(4,'expense',0,10,'Expense',{Date:'1990-01-01'}),
    cash(5,'opening',9),cash(6,'foreign',70),
    cash(7,'deleted',400,0,'Sale',{'Is Deleted':'TRUE'}),
    cash(8,'old-adjustment',25,0,'Day Close Adjustment'),
    marker(9,'S2',{Date:'1970-01-01'}),
    cash(10,'late',15,0,'Sale',{Date:'1975-01-01'}),
    cash(11,'unlinked-future',999)
  ];
  await seed('SHOP-A',sessions,entries);
  assert.deepEqual(await sqlParity('SHOP-A','S1',sessions,entries),
    {expected:135,variance:8});
});

test('M08 SQL source window counts in-window closing only once and late closing once despite repeated JSON IDs',async()=>{
  const sessions=[
    session('S1',2,{'Counted Cash':116,
      'Closing Explanation Entry IDs':'["inside","inside","late"]'})
  ];
  const entries=[
    marker(2,'S1'),cash(3,'inside',7),cash(4,'normal',0),
    marker(5,'NEXT'),cash(6,'late',9)
  ];
  await seed('SHOP-A',sessions,entries);
  assert.deepEqual(await sqlParity('SHOP-A','S1',sessions,entries),
    {expected:116,variance:0});
});

test('M08 SQL preserves counted zero vs absent and retains other-session linked exclusion',async()=>{
  const sessions=[
    session('S1',2,{'Counted Cash':0}),
    session('S2',3,{'Status':'Closing','Counted Cash':'',
      'Opening Explanation Entry IDs':'["opening"]'}),
    session('S3',4,{'Closing Explanation Entry IDs':'["shared"]'})
  ];
  const entries=[
    marker(2,'S1'),cash(3,'s1',10),
    marker(4,'S2'),cash(5,'opening',5),
    cash(6,'shared',40),cash(7,'regular',10),
    marker(8,'S3'),cash(9,'unlinked-s3',100)
  ];
  await seed('SHOP-A',sessions,entries);
  assert.deepEqual(await sqlParity('SHOP-A','S1',sessions,entries),
    {expected:110,variance:-110});
  assert.deepEqual(await sqlParity('SHOP-A','S2',sessions,entries),
    {expected:110,variance:''});
});

test('M08 SQL tenant isolation with identical source Session IDs and Entry IDs',async()=>{
  const sa=[session('S1',2,{'Counted Cash':110})];
  const sb=[session('S1',2,{'Opening Cash':200,'Counted Cash':230})];
  const a=[marker(2,'S1'),cash(3,'shared',10)];
  const b=[marker(2,'S1'),cash(3,'shared',30)];
  await seed('SHOP-A',sa,a);
  await seed('SHOP-B',sb,b);
  assert.deepEqual(await sqlParity('SHOP-A','S1',sa,a),
    {expected:110,variance:0});
  assert.deepEqual(await sqlParity('SHOP-B','S1',sb,b),
    {expected:230,variance:0});
});

test('M08 SQL no marker / no eligible closing session yields null; duplicate marker refuses',async()=>{
  const sessions=[session('S1',2),session('S2',3,{'Status':'Open'})];
  const entries=[marker(2,'S1'),cash(3,'sale',10)];
  await seed('SHOP-A',sessions,entries);
  assert.deepEqual(await previewD1SQLPositionalClosing(
    DB,{tenantId:'SHOP-A',sessionId:'MISSING'}),
    {sessionId:'MISSING',recalculated:null});
  assert.deepEqual(await sqlParity('SHOP-A','S2',sessions,entries),null);
  await DB.prepare(
    "INSERT INTO m08_positional_cash VALUES('SHOP-A',5,'mark-dupe','Session Open','S1',0,0,0,'2026-11-16')"
  ).run();
  await assert.rejects(()=>previewD1SQLPositionalClosing(
    DB,{tenantId:'SHOP-A',sessionId:'S1'}),/Duplicate Session Open marker/);
});

test('M08 SQL rejects duplicate nonblank original Cash Book and Cash Session IDs',async()=>{
  const sessions=[session('S1')];
  const entries=[marker(2,'S1'),cash(3,'reused',1),cash(4,'reused',2)];
  await seed('SHOP-A',sessions,entries);
  await assert.rejects(()=>previewD1SQLPositionalClosing(
    DB,{tenantId:'SHOP-A',sessionId:'S1'}),/Duplicate Cash Book Entry ID/);
  await DB.prepare("DELETE FROM m08_positional_cash WHERE legacy_row=4").run();
  await DB.prepare(
    "INSERT INTO m08_positional_sessions VALUES('SHOP-A',3,'S1','Closed',10000,10000,'','')"
  ).run();
  await assert.rejects(()=>previewD1SQLPositionalClosing(
    DB,{tenantId:'SHOP-A',sessionId:'S1'}),/Duplicate Cash Session ID/);
});

test('M08 SQL malformed linked ID import and wrong JSON element type refuse without writing',async()=>{
  const sessions=[session('S1',2,{'Closing Explanation Entry IDs':'["sale"]'})];
  const entries=[marker(2,'S1'),cash(3,'sale',10)];
  await seed('SHOP-A',sessions,entries);
  assert.deepEqual(await sqlParity('SHOP-A','S1',sessions,entries),
    {expected:110,variance:-10});
  const bad=['sale,another','{oops','[5]','{"entryId":"sale"}'];
  for(const text of bad){
    await DB.prepare("UPDATE m08_positional_sessions SET closing_entry_ids=? WHERE tenant_id='SHOP-A'")
      .bind(text).run();
    const unchanged=await snapshot();
    await assert.rejects(()=>previewD1SQLPositionalClosing(
      DB,{tenantId:'SHOP-A',sessionId:'S1'}),/Invalid canonical linked Cash IDs/);
    assert.deepEqual(await snapshot(),unchanged);
  }
});

test('M08 SQL invalid tenant/session request fails before SQL and keeps both tables unchanged',async()=>{
  await seed('SHOP-A',[session('S1')],[marker(2,'S1'),cash(3,'sale',10)]);
  const unchanged=await snapshot();
  for(const request of [
    null,{}, {tenantId:'SHOP-A;DROP',sessionId:'S1'},
    {tenantId:'SHOP-A',sessionId:'S1',sql:'DELETE FROM cash'},
    {tenantId:'SHOP-A',sessionId:''},
    {tenantId:'SHOP-A',sessionId:Promise.resolve('S1')}
  ])await assert.rejects(()=>previewD1SQLPositionalClosing(DB,request),TypeError);
  await assert.rejects(()=>previewD1SQLPositionalClosing(null,{
    tenantId:'SHOP-A',sessionId:'S1'
  }),/D1/);
  assert.deepEqual(await snapshot(),unchanged);
});


/** M08 #66 — Bank Book/Bank Ledger real local D1 source parity.
 * All M08 bank schema tables are disposable and never deployed to D1.
 */
const bankAccount=(id,opening,current,status='Active',other={})=>({
  'Bank Account ID':id,'Account Name':id+' display',
  'Bank Name':'Demo Bank','Account Number':'9999',
  'Account Type':'Bank','Opening Balance':opening,
  'Current Balance':current,'Status':status,...other
});
const bankEntry=(id,accountId,date,credit='',debit='',other={})=>({
  'Entry ID':id,'Bank Account ID':accountId,'Date':date,
  'Type':'Deposit','Reference':'','Description':'',
  'Credit':credit,'Debit':debit,'Status':'Active',
  'Reversal Of':'','Notes':'','Created By':'','Created At':'',
  'Is Backdated':false,'Backdated Days':0,'Backdated Reason':'',
  ...other
});
const bankRequest=(accountId,overrides={})=>({
  tenantId:'SHOP-A',accountId,from:'2026-11-01',
  to:'2026-11-17',today:'2026-11-17',...overrides
});
const bankCents=value=>Math.round(Number(value||0)*100);
const bankTables=['m08_bank_book','m08_bank_accounts'];
async function bankReset(){
  for(const table of bankTables)await DB.prepare('DROP TABLE IF EXISTS '+table).run();
  for(const ddl of M08_BANK_DDL)await DB.prepare(ddl).run();
}
async function bankSeed(tenant,accounts,entries){
  for(const [index,account] of accounts.slice().reverse().entries()){
    const row=accounts.length-index;
    await DB.prepare(
      'INSERT INTO m08_bank_accounts VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).bind(tenant,row,account['Bank Account ID'],account['Account Name'],
      account['Bank Name'],account['Account Number'],
      bankCents(account['Opening Balance']),bankCents(account['Current Balance']),
      account.Status,account['Account Type']).run();
  }
  for(const [index,entry] of entries.slice().reverse().entries()){
    const row=entries.length-index;
    await DB.prepare(
      'INSERT INTO m08_bank_book VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(tenant,row,entry['Entry ID'],entry['Bank Account ID'],
      entry.Date,entry.Type,entry.Reference,entry.Description,
      bankCents(entry.Debit),bankCents(entry.Credit),entry.Status,
      entry['Reversal Of'],entry.Notes,entry['Created By'],
      entry['Created At'],entry['Is Backdated']?1:0,
      Number(entry['Backdated Days']||0),entry['Backdated Reason']).run();
  }
}
async function bankSnapshot(){
  return {
    accounts:(await DB.prepare(
      'SELECT * FROM m08_bank_accounts ORDER BY tenant_id,legacy_row'
    ).all()).results.map(x=>({...x})),
    book:(await DB.prepare(
      'SELECT * FROM m08_bank_book ORDER BY tenant_id,legacy_row'
    ).all()).results.map(x=>({...x}))
  };
}
function sourceBankLedger(accounts,entries,request){
  const fn=loadPinnedGASFunctions({
    'BankLedger.gs':['getBankLedger']
  },{
    requirePermission_:(token,module,action)=>{
      assert.deepEqual([token,module,action],['fixture','bank','view']);
    },
    sanitizeInput_:v=>v==null?'':String(v).trim(),
    formatDate_:()=>request.today,
    safeDateOnly_:v=>v,
    getAllRows_:group=>{
      if(group==='BANK_ACCOUNTS')return accounts;
      if(group==='BANK_BOOK')return entries;
      throw Error('Unexpected source group '+group);
    },
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:(label,error)=>{throw Error(label+': '+error.message);}
  });
  const outcome=fn.getBankLedger('fixture',{
    bankAccountId:request.accountId,from:request.from,to:request.to
  });
  assert.equal(outcome.success,true,outcome.message);
  return plain(outcome.data);
}
async function assertBankSource(tenant,accounts,entries,request){
  const beforeState=await bankSnapshot();
  const result=await previewD1BankLedger(DB,{...request,tenantId:tenant});
  assert.deepEqual(result.statement,sourceBankLedger(accounts,entries,request));
  const sourceBankBalance=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'BankBook.gs':['getBankBalance_','getTotalBankBalance_']
  },{getAllRows_:group=>{
    assert.equal(group,'BANK_ACCOUNTS');return accounts;
  }});
  assert.equal(result.bankBalance,
    sourceBankBalance.getBankBalance_(request.accountId));
  assert.equal(result.activeBankTotal,
    sourceBankBalance.getTotalBankBalance_());
  assert.deepEqual(await bankSnapshot(),beforeState,
    'Bank Ledger projection must not write any D1 record');
  return result;
}

test('M08 Bank D1 preserves opening row, same-account manual reversal, void and true source chronology',async()=>{
  await bankReset();
  const accounts=[bankAccount('A',100,140),bankAccount('B',50,50)];
  const entries=[
    bankEntry('BB-000001','A','2026-11-01',100,'',{'Type':'Opening Balance'}),
    bankEntry('BB-000002','A','2026-11-13',80,'',{'Type':'Transfer In'}),
    bankEntry('BB-000003','A','2026-11-13','',20,{'Type':'Purchase Payment'}),
    bankEntry('BB-000004','A','2026-11-13','',10,{'Status':'Reversed'}),
    bankEntry('BB-000005','A','2026-11-14',30,'',{'Status':'Reversed'}),
    bankEntry('BB-000006','A','2026-11-14','',30,{'Reversal Of':'BB-000005'}),
    bankEntry('BB-000007','A','2026-11-15','',20),
    bankEntry('BB-000008','B','2026-11-14',10)
  ];
  await bankSeed('SHOP-A',accounts,entries);
  const result=await assertBankSource('SHOP-A',accounts,entries,
    bankRequest('A',{from:'2026-11-13',to:'2026-11-15'}));
  const ledger=result.statement;
  assert.equal(ledger.openingBalance,100);
  assert.equal(ledger.closingBalance,140);
  assert.equal(ledger.totalCredit,110);
  assert.equal(ledger.totalDebit,70);
  assert.equal(ledger.entryCount,5);
  assert.deepEqual(ledger.entries.map(r=>r.entryId),
    ['BB-000007','BB-000006','BB-000005','BB-000003','BB-000002']);
  assert.equal(ledger.integrity.balanced,true);
  assert.equal(result.bankBalance,140);
});

test('M08 Bank D1 falls back to historical account opening exactly once if no opening entry',async()=>{
  await bankReset();
  const accounts=[bankAccount('A',200,255)];
  const entries=[
    bankEntry('BB-000002','A','2026-11-10',75),
    bankEntry('BB-000003','A','2026-11-15','',20)
  ];
  await bankSeed('SHOP-A',accounts,entries);
  const r=await assertBankSource('SHOP-A',accounts,entries,
    bankRequest('A',{from:'2026-11-15',to:'2026-11-15'}));
  assert.equal(r.statement.openingBalance,275);
  assert.equal(r.statement.closingBalance,255);
  assert.equal(r.statement.entries[0].balance,255);
  assert.equal(r.statement.integrity.hasOpeningRow,false);
});

test('M08 Bank D1 never resurrects voided entries using reversal in a different bank account',async()=>{
  await bankReset();
  const accounts=[bankAccount('A',100,105),bankAccount('B',200,150)];
  const entries=[
    bankEntry('BB-000001','A','2026-11-14',50,'',{'Status':'Reversed'}),
    bankEntry('BB-000002','B','2026-11-14','',50,{'Reversal Of':'BB-000001'}),
    bankEntry('BB-000003','A','2026-11-15',5)
  ];
  await bankSeed('SHOP-A',accounts,entries);
  const r=await assertBankSource('SHOP-A',accounts,entries,bankRequest('A'));
  assert.deepEqual(r.statement.entries.map(x=>x.entryId),['BB-000003']);
  assert.equal(r.statement.closingBalance,105);
});

test('M08 Bank D1 date/Entry ID ordering, reversed date ranges and missing date defaults match GAS',async()=>{
  await bankReset();
  const accounts=[bankAccount('A',0,0)];
  const entries=[
    bankEntry('BB-000010','A','2026-11-12',50,'',{'Created By':'clerk'}),
    bankEntry('BB-000002','A','2026-11-12','',50,{
      'Is Backdated':true,'Backdated Days':5,'Backdated Reason':'Adjustment'
    })
  ];
  await bankSeed('SHOP-A',accounts,entries);
  const r=await assertBankSource('SHOP-A',accounts,entries,
    bankRequest('A',{from:'2026-11-15',to:'2026-11-01'}));
  assert.deepEqual(r.statement.range,{from:'2026-11-01',to:'2026-11-15'});
  assert.deepEqual(r.statement.entries.map(x=>[x.entryId,x.balance]),
    [['BB-000010',0],['BB-000002',-50]]);
  assert.equal(r.statement.entries[0].isBackdated,false);
  assert.equal(r.statement.entries[1].backdatedDays,5);
  const fallback=await assertBankSource('SHOP-A',accounts,entries,
    bankRequest('A',{from:'bad',to:''}));
  assert.deepEqual(fallback.statement.range,
    {from:'2026-11-01',to:'2026-11-17'});
});

test('M08 Bank D1 reports stored-balance drift without changing source rows',async()=>{
  await bankReset();
  const accounts=[bankAccount('A',100,105)];
  const entries=[bankEntry('BB-000001','A','2026-11-15',10)];
  await bankSeed('SHOP-A',accounts,entries);
  const r=await assertBankSource('SHOP-A',accounts,entries,bankRequest('A'));
  assert.deepEqual(r.statement.integrity,{
    computedBalance:110,storedBalance:105,drift:5,
    balanced:false,hasOpeningRow:false
  });
});

test('M08 Bank D1 inactive account and mobile bank total are tenant-local and source-faithful',async()=>{
  await bankReset();
  const a=[
    bankAccount('A',0,140),bankAccount('B',0,-20),
    bankAccount('C',0,900,'Inactive'),
    bankAccount('MOBILE',0,2.50,'Active',{'Account Type':'Mobile Banking'})
  ];
  const b=[bankAccount('A',0,700),bankAccount('B',0,800,'Inactive')];
  await bankSeed('SHOP-A',a,[]);
  await bankSeed('SHOP-B',b,[]);
  const ra=await assertBankSource('SHOP-A',a,[],bankRequest('C'));
  const rb=await assertBankSource('SHOP-B',b,[],
    bankRequest('A',{tenantId:'SHOP-B'}));
  assert.equal(ra.activeBankTotal,122.50);
  assert.equal(ra.bankBalance,900);
  assert.equal(rb.activeBankTotal,700);
  assert.equal(rb.statement.integrity.storedBalance,700);
});

test('M08 Bank D1 two tenants with same Account/Book IDs never share ledger history',async()=>{
  await bankReset();
  const accountsA=[bankAccount('A',100,110)];
  const entriesA=[bankEntry('BB-SAME','A','2026-11-15',10)];
  const accountsB=[bankAccount('A',200,170)];
  const entriesB=[bankEntry('BB-SAME','A','2026-11-15','',30)];
  await bankSeed('SHOP-A',accountsA,entriesA);
  await bankSeed('SHOP-B',accountsB,entriesB);
  const a=await assertBankSource('SHOP-A',accountsA,entriesA,bankRequest('A'));
  const b=await assertBankSource('SHOP-B',accountsB,entriesB,
    bankRequest('A',{tenantId:'SHOP-B'}));
  assert.equal(a.statement.closingBalance,110);
  assert.equal(b.statement.closingBalance,170);
  assert.equal(a.statement.entries[0].credit,10);
  assert.equal(b.statement.entries[0].debit,30);
});

test('M08 Bank D1 duplicate imported Account ID or Bank Book Entry ID fails closed',async()=>{
  await bankReset();
  const accounts=[bankAccount('A',100,110)];
  const entries=[bankEntry('BB-X','A','2026-11-15',10)];
  await bankSeed('SHOP-A',accounts,entries);
  await DB.prepare(
    "INSERT INTO m08_bank_book VALUES ('SHOP-A',999,'BB-X','A','2026-11-15','Deposit','','',0,300,'Active','','','','',0,0,'')"
  ).run();
  await assert.rejects(()=>previewD1BankLedger(DB,bankRequest('A')),
    /Duplicate Bank Book Entry ID/);
  await DB.prepare("DELETE FROM m08_bank_book WHERE legacy_row=999").run();
  await DB.prepare(
    "INSERT INTO m08_bank_accounts VALUES ('SHOP-A',999,'A','Duplicate','Demo','9999',0,0,'Active','Bank')"
  ).run();
  await assert.rejects(()=>previewD1BankLedger(DB,bankRequest('A')),
    /Duplicate Bank Account ID/);
});

test('M08 Bank D1 invalid source date and unknown account fail closed without mutation',async()=>{
  await bankReset();
  const accounts=[bankAccount('A',0,5)];
  const entries=[bankEntry('BB-001','A','2026-11-15',5)];
  await bankSeed('SHOP-A',accounts,entries);
  const stable=await bankSnapshot();
  await assert.rejects(()=>previewD1BankLedger(DB,bankRequest('MISSING')),
    /Bank account not found/);
  assert.deepEqual(await bankSnapshot(),stable);
  await DB.prepare(
    "UPDATE m08_bank_book SET date_text='2026-11-15T01:00:00Z' WHERE entry_id='BB-001'"
  ).run();
  const bad=await bankSnapshot();
  await assert.rejects(()=>previewD1BankLedger(DB,bankRequest('A')),
    /canonical YYYY-MM-DD/);
  assert.deepEqual(await bankSnapshot(),bad);
});

test('M08 Bank D1 empty ledger, SQL injection shape, missing binding and no public Worker route',async()=>{
  await bankReset();
  const accounts=[bankAccount('A',0,0)];
  await bankSeed('SHOP-A',accounts,[]);
  const valid=bankRequest('A');
  const r=await assertBankSource('SHOP-A',accounts,[],valid);
  assert.deepEqual(r.statement.entries,[]);
  assert.equal(r.statement.entryCount,0);
  const beforeState=await bankSnapshot();
  for(const invalid of [
    null,{}, {...valid,tenantId:'SHOP-A; DROP TABLE'},
    {...valid,accountId:''}, {...valid,from:Promise.resolve('2026-11-01')},
    {...valid,today:'2026-11-17T00:00:00Z'},
    {...valid,sql:'DROP TABLE m08_bank_book'}
  ])await assert.rejects(()=>previewD1BankLedger(DB,invalid),TypeError);
  await assert.rejects(()=>previewD1BankLedger(null,valid),/D1/);
  assert.equal((await worker.fetch('https://m08-bank.test/api/rpc',{
    method:'POST',body:JSON.stringify(valid)
  })).status,404);
  assert.deepEqual(await bankSnapshot(),beforeState);
});
