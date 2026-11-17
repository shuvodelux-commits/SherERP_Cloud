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

import {M08_ROLE_DDL}
  from '../fixtures/m08-d1-role-account-schema.mjs';
import {previewD1RoleAccountIsolation}
  from '../fixtures/m08-d1-role-account-preview.mjs';

import {M08_TRANSFER_DDL}
  from '../fixtures/m08-d1-transfer-header-schema.mjs';
import {auditD1BankTransfers}
  from '../fixtures/m08-d1-transfer-provenance-preview.mjs';

import {M08_VENDOR_PAYEE_DDL}
  from '../fixtures/m08-d1-vendor-payee-schema.mjs';
import {previewD1VendorPayeeIsolation}
  from '../fixtures/m08-d1-vendor-payee-preview.mjs';


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


// M08 #66 source-role account isolation only; disposable local D1, no posting.
const fm=(id,name='Verified Person',extra={})=>({
  'Person ID':id,'Person Name':name,'Person Type':'Owner',Roles:'Owner',
  Status:'Active',Phone:'',Description:'',...extra
});
const ft=(id,personId,type,amount,extra={})=>({
  'Finance ID':id,'Person ID':personId,'Person':'Historic display name',
  'Transaction Type':type,Amount:amount,'Is Deleted':'',...extra
});
const pl=(id,kind,legacyId,rowIndex,debit,credit,extra={})=>({
  'Ledger ID':id,kind,legacyId,_rowIndex:rowIndex,
  Date:'2026-11-15',Type:'Opening Balance',
  Debit:debit,Credit:credit,'Is Deleted':'',
  'Created At':'2026-11-15T20:00:00+06:00',...extra
});
const safeCents=v=>Math.round(Number(v)*100);
const roleTables=[
  'm08_role_party','m08_role_finance','m08_role_persons'
];
async function roleReset(){
  for(const table of roleTables)
    await DB.prepare('DROP TABLE IF EXISTS '+table).run();
  for(const ddl of M08_ROLE_DDL)await DB.prepare(ddl).run();
}
async function roleSeed(tenant,masters,finance,parties){
  for(let i=masters.length-1;i>=0;i--){
    const m=masters[i];
    await DB.prepare('INSERT INTO m08_role_persons VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(tenant,i+2,m['Person ID'],m['Person Name'],m['Person Type'],
        m.Roles,m.Status,m.Phone,m.Description).run();
  }
  for(let i=finance.length-1;i>=0;i--){
    const t=finance[i];
    await DB.prepare('INSERT INTO m08_role_finance VALUES (?,?,?,?,?,?,?,?)')
      .bind(tenant,i+2,t['Finance ID'],t['Person ID'],t.Person,
        t['Transaction Type'],safeCents(t.Amount),
        t['Is Deleted']===true || String(t['Is Deleted']).toUpperCase()==='TRUE'?1:0).run();
  }
  for(const p of parties.slice().reverse()){
    await DB.prepare('INSERT INTO m08_role_party VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(tenant,p._rowIndex,p['Ledger ID'],p.kind,p.legacyId,p.Date,
        p.Type,safeCents(p.Debit),safeCents(p.Credit),
        p['Is Deleted']===true || String(p['Is Deleted']).toUpperCase()==='TRUE'?1:0,
        p['Created At'],p.kind==='customer'?'Customer Name':'Supplier Name').run();
  }
}
async function roleSnapshot(){
  const snapshot={};
  for(const [key,query] of Object.entries({
    masters:'SELECT * FROM m08_role_persons ORDER BY tenant_id,legacy_row',
    finance:'SELECT * FROM m08_role_finance ORDER BY tenant_id,legacy_row',
    party:'SELECT * FROM m08_role_party ORDER BY tenant_id,legacy_row'
  }))snapshot[key]=(await DB.prepare(query).all()).results.map(x=>({...x}));
  return snapshot;
}
const roleReq=(overrides={})=>({
  tenantId:'SHOP-A',customerId:'DUAL',supplierId:'DUAL',...overrides
});
function financeGAS(masters,finance){
  const types=[
    ['Owner Investment','owner',1],['Owner Withdrawal','owner',-1],
    ['Loan Received','loanPayable',1],['Loan Repayment','loanPayable',-1],
    ['Borrower Loan','borrowerReceivable',1],
    ['Borrower Repayment','borrowerReceivable',-1],
    ['Opening Owner Capital','owner',1],['Opening Loan','loanPayable',1],
    ['Opening Borrower Loan','borrowerReceivable',1]
  ].map(([key,account,balanceEffect])=>({key,account,balanceEffect}));
  const source=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'FinanceModule.gs':[
      'financeCanonicalRoles_','financePersonRoles_','getAllFinancePersonsForUI_',
      'financePersonNameAliasMap_','financeTransactionType_','financeTxnPersonKey_',
      'financeSignedBalances_','financeBalanceSummary_','financePersonBalancesForUI_'
    ]
  },{
    FINANCE_PERSON_ROLES:['Owner','Lender','Borrower'],
    FINANCE_TRANSACTION_TYPES:types,
    getAllRows_:group=>{
      assert.equal(group,'FINANCE_PERSONS');
      return plain(masters);
    }
  });
  const persons=source.getAllFinancePersonsForUI_();
  const current=finance.filter(t=>t['Is Deleted']!==true &&
    String(t['Is Deleted']||'').toUpperCase()!=='TRUE');
  return plain({
    persons,
    personBalances:source.financePersonBalancesForUI_(persons,plain(current)),
    summary:source.financeBalanceSummary_(plain(current))
  });
}
function partyGAS(kind,legacyId,parts){
  const sourceRows=parts.filter(p=>p.kind===kind).map(p=>({
    'Ledger ID':p['Ledger ID'],
    [kind==='customer'?'Customer ID':'Supplier ID']:p.legacyId,
    Date:p.Date,Type:p.Type,Debit:p.Debit,Credit:p.Credit,
    'Is Deleted':p['Is Deleted'],'Created At':p['Created At'],
    _rowIndex:p._rowIndex
  }));
  const source=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'DeleteEngine.gs':['isDeleted_'],
    'PartyLedger.gs':[
      'partyLedgerConfig_','partyLedgerStableSortKey_','partyLedgerBuildAscendingIndex_'
    ]
  },{
    PARTY_LEDGER_CONFIG_:{
      customer:{partyIdColumn:'Customer ID'},
      supplier:{partyIdColumn:'Supplier ID'}
    },
    partyLedgerReadIndex_:()=>plain(sourceRows)
  });
  return plain(source.partyLedgerBuildAscendingIndex_(kind,legacyId));
}
async function roleParity(masters,finance,parts,request=roleReq()){
  const beforeD1=await roleSnapshot();
  const result=await previewD1RoleAccountIsolation(DB,request);
  assert.deepEqual(result.finance,financeGAS(masters,finance));
  assert.deepEqual(result.customer.rows,
    partyGAS('customer',request.customerId,parts));
  assert.deepEqual(result.supplier.rows,
    partyGAS('supplier',request.supplierId,parts));
  assert.deepEqual(await roleSnapshot(),beforeD1,'read-only role proof mutated D1');
  return result;
}

test('M08 role D1 single original Finance Person retains Owner, Loan and Borrower balances separately',async()=>{
  await roleReset();
  const masters=[fm('P1','Owner and lender',{Roles:'Borrower,Owner,Lender'})];
  const txs=[
    ft('F1','P1','Owner Investment',600),
    ft('F2','P1','Owner Withdrawal',50),
    ft('F3','P1','Loan Received',1000),
    ft('F4','P1','Loan Repayment',150),
    ft('F5','P1','Borrower Loan',400),
    ft('F6','P1','Borrower Repayment',25)
  ];
  await roleSeed('SHOP-A',masters,txs,[]);
  const r=await roleParity(masters,txs,[]);
  assert.deepEqual(r.finance.personBalances.P1,{
    owner:550,loanPayable:850,borrowerReceivable:375
  });
  assert.equal(r.finance.summary.ownerCapital,550);
  assert.equal(r.finance.summary.outstandingLoan,850);
  assert.equal(r.finance.summary.borrowerReceivable,375);
  assert.deepEqual(r.finance.persons[0].roles,['Owner','Lender','Borrower']);
});

test('M08 role D1 historical opening finance positions have no Cash/Bank ledger effect',async()=>{
  await roleReset();
  const masters=[fm('P1','Historical Owner',{Roles:'Owner,Lender,Borrower'})];
  const txs=[
    ft('OP1','P1','Opening Owner Capital',1000),
    ft('OP2','P1','Opening Loan',400),
    ft('OP3','P1','Opening Borrower Loan',300)
  ];
  await roleSeed('SHOP-A',masters,txs,[]);
  const cashBefore=await snapshot(),bankBefore=await bankSnapshot();
  const r=await roleParity(masters,txs,[]);
  assert.deepEqual(r.finance.personBalances.P1,{
    owner:1000,loanPayable:400,borrowerReceivable:300
  });
  assert.deepEqual(await snapshot(),cashBefore);
  assert.deepEqual(await bankSnapshot(),bankBefore);
});

test('M08 role D1 distinct original IDs with same display name never merge or auto-net overpayments',async()=>{
  await roleReset();
  const masters=[
    fm('P1','Same Person',{Phone:'01700000000'}),
    fm('P2','Same Person',{Phone:'01700000000'})
  ];
  const txs=[
    ft('F1','P1','Owner Investment',250),
    ft('F2','P2','Owner Withdrawal',60),
    ft('F3','P1','Loan Repayment',90),
    ft('F4','P2','Loan Received',300),
    ft('F5','P1','Borrower Repayment',20),
    ft('F6','P2','Borrower Loan',70)
  ];
  await roleSeed('SHOP-A',masters,txs,[]);
  const r=await roleParity(masters,txs,[]);
  assert.deepEqual(r.finance.personBalances.P1,{
    owner:250,loanPayable:-90,borrowerReceivable:-20
  });
  assert.deepEqual(r.finance.personBalances.P2,{
    owner:-60,loanPayable:300,borrowerReceivable:70
  });
  assert.deepEqual(r.finance.summary,{
    ownerCapital:250,ownerAdvance:60,
    outstandingLoan:300,lenderCredit:90,
    borrowerReceivable:70,borrowerCredit:20
  });
});

test('M08 role D1 soft-deleted Finance rows are removed without hiding active historical amounts',async()=>{
  await roleReset();
  const masters=[fm('P1')],txs=[
    ft('O1','P1','Opening Owner Capital',100),
    ft('D1','P1','Owner Withdrawal',9999,{'Is Deleted':'TRUE'}),
    ft('D2','P1','Loan Received',999,{'Is Deleted':true}),
    ft('O2','P1','Opening Loan',50)
  ];
  await roleSeed('SHOP-A',masters,txs,[]);
  const r=await roleParity(masters,txs,[]);
  assert.deepEqual(r.finance.personBalances.P1,{
    owner:100,loanPayable:50,borrowerReceivable:0
  });
});

test('M08 role D1 Customer and Supplier with the same literal legacy ID keep independent gross ledger signs',async()=>{
  await roleReset();
  const parties=[
    pl('C3','customer','DUAL',6,0,50,{Type:'Payment Received'}),
    pl('C1','customer','DUAL',2,200,0,{Date:'2026-11-10'}),
    pl('C2','customer','DUAL',3,40,0,{Date:'2026-11-12'}),
    pl('S1','supplier','DUAL',4,500,0,{Date:'2026-11-10'}),
    pl('S2','supplier','DUAL',5,0,750,{Date:'2026-11-13'}),
    pl('DEL','supplier','DUAL',7,900,0,{'Is Deleted':'TRUE'}),
    pl('OTHER','customer','OTHER',8,10000,0)
  ];
  await roleSeed('SHOP-A',[],[],parties);
  const r=await roleParity([],[],parties);
  assert.equal(r.customer.closingBalance,190);
  assert.equal(r.supplier.closingBalance,-250);
  assert.deepEqual(r.customer.rows.map(x=>x['Ledger ID']),['C1','C2','C3']);
  assert.deepEqual(r.supplier.rows.map(x=>x['Ledger ID']),['S1','S2']);
});

test('M08 role D1 original Party date and physical-row ordering outrank import sequence and Created At',async()=>{
  await roleReset();
  const parties=[
    pl('C4','customer','DUAL',12,0,5,{'Created At':'1990-01-01'}),
    pl('C2','customer','DUAL',7,20,0,{'Date':'2026-11-13'}),
    pl('C3','customer','DUAL',10,0,10,{'Created At':'2050-01-01'}),
    pl('C1','customer','DUAL',3,40,0,{'Date':'2026-11-11'})
  ];
  await roleSeed('SHOP-A',[],[],parties);
  const r=await roleParity([],[],parties);
  assert.deepEqual(r.customer.rows.map(x=>x['Ledger ID']),['C1','C2','C3','C4']);
  assert.deepEqual(r.customer.rows.map(x=>x._displayBalance),[40,60,50,45]);
});

test('M08 role D1 same source identity values in two tenants do not share historical balances',async()=>{
  await roleReset();
  const mastersA=[fm('P1','Same',{Roles:'Owner,Lender'})],
    mastersB=[fm('P1','Same',{Roles:'Owner,Lender'})];
  const txsA=[ft('F1','P1','Opening Owner Capital',100)];
  const txsB=[ft('F1','P1','Opening Loan',500)];
  const partiesA=[pl('CL1','customer','DUAL',2,90,0)],
    partiesB=[pl('CL1','customer','DUAL',2,0,30)];
  await roleSeed('SHOP-A',mastersA,txsA,partiesA);
  await roleSeed('SHOP-B',mastersB,txsB,partiesB);
  const a=await roleParity(mastersA,txsA,partiesA);
  const b=await roleParity(mastersB,txsB,partiesB,
    roleReq({tenantId:'SHOP-B'}));
  assert.equal(a.finance.personBalances.P1.owner,100);
  assert.equal(b.finance.personBalances.P1.loanPayable,500);
  assert.equal(a.customer.closingBalance,90);
  assert.equal(b.customer.closingBalance,-30);
});

test('M08 role D1 duplicate Finance Person, transaction or per-role Party Ledger identifiers fail closed',async()=>{
  await roleReset();
  await roleSeed('SHOP-A',[fm('P1')],[ft('F1','P1','Opening Owner Capital',100)],
    [pl('L1','customer','DUAL',2,50,0)]);
  await DB.prepare("INSERT INTO m08_role_persons VALUES ('SHOP-A',100,'P1','Duplicate','Owner','Owner','Active','','')").run();
  await assert.rejects(()=>previewD1RoleAccountIsolation(DB,roleReq()),
    /Duplicate Finance Person ID/);
  await DB.prepare("DELETE FROM m08_role_persons WHERE legacy_row=100").run();
  await DB.prepare("INSERT INTO m08_role_finance VALUES ('SHOP-A',100,'F1','P1','Repeat','Owner Investment',1,0)").run();
  await assert.rejects(()=>previewD1RoleAccountIsolation(DB,roleReq()),
    /Duplicate Finance ID/);
  await DB.prepare("DELETE FROM m08_role_finance WHERE legacy_row=100").run();
  await DB.prepare("INSERT INTO m08_role_party VALUES ('SHOP-A',100,'L1','customer','DUAL','2026-11-15','Opening Balance',100,0,0,'','Customer Name')").run();
  await assert.rejects(()=>previewD1RoleAccountIsolation(DB,roleReq()),
    /Duplicate customer Ledger ID/);
});

test('M08 role D1 unresolved Person ID and malformed type never produce partial gross balance',async()=>{
  await roleReset();
  await roleSeed('SHOP-A',[fm('P1')],[ft('F1','NOT-MAPPED','Opening Loan',900)],[]);
  await assert.rejects(()=>previewD1RoleAccountIsolation(DB,roleReq()),
    /Unresolved finance transaction Person ID/);
  await DB.prepare("UPDATE m08_role_finance SET person_id='P1',transaction_type='Unknown Type'").run();
  await assert.rejects(()=>previewD1RoleAccountIsolation(DB,roleReq()),
    /Unknown source finance transaction type/);
});

test('M08 role D1 ignores soft-deleted Party entries but never silently nets different roles',async()=>{
  await roleReset();
  const parties=[
    pl('C1','customer','DUAL',2,100,0),
    pl('C2','customer','DUAL',3,9999,0,{'Is Deleted':'TRUE'}),
    pl('S1','supplier','DUAL',4,300,0),
    pl('S2','supplier','DUAL',5,0,50,{'Is Deleted':'TRUE'})
  ];
  await roleSeed('SHOP-A',[],[],parties);
  const r=await roleParity([],[],parties);
  assert.equal(r.customer.closingBalance,100);
  assert.equal(r.supplier.closingBalance,300);
});

test('M08 role D1 invalid identity requests, public RPC and unknown role are fail-closed',async()=>{
  await roleReset();
  await roleSeed('SHOP-A',[],[],[]);
  const stable=await roleSnapshot();
  for(const invalid of [
    null,{},roleReq({tenantId:'SHOP-A; DROP TABLE'}),
    roleReq({customerId:''}),roleReq({supplierId:Promise.resolve('DUAL')}),
    {...roleReq(),sql:'DELETE FROM m08_role_finance'}
  ])await assert.rejects(()=>previewD1RoleAccountIsolation(DB,invalid),TypeError);
  await assert.rejects(()=>previewD1RoleAccountIsolation(null,roleReq()),/D1/);
  assert.equal((await worker.fetch('https://m08-role.test/api/rpc',{
    method:'POST',body:JSON.stringify(roleReq())
  })).status,404);
  assert.deepEqual(await roleSnapshot(),stable);
});


// #66 — strict source header/two-leg audit; isolated local D1 reads only.
const th=(id,from,to,amount,fields={})=>({
  'Transfer ID':id,'From Account ID':from,'To Account ID':to,
  Amount:amount,Date:'2026-11-17','Is Deleted':'',
  Notes:'','Created By':'source fixture',...fields
});
const tl=(id,accountId,type,reference,amount,fields={})=>
  bankEntry(id,accountId,'2026-11-17',
    type==='Transfer In'?amount:0,
    type==='Transfer Out'?amount:0,
    {Type:type,Reference:reference,...fields});
const trRequest=(tenantId='SHOP-A')=>({tenantId});
async function transferReset(){
  await bankReset();
  await DB.prepare('DROP TABLE IF EXISTS m08_transfer_headers').run();
  for(const ddl of M08_TRANSFER_DDL)await DB.prepare(ddl).run();
}
async function transferSeed(tenant,accounts,headers,legs){
  await bankSeed(tenant,accounts,legs);
  for(let i=headers.length-1;i>=0;i--){
    const h=headers[i];
    await DB.prepare(
      'INSERT INTO m08_transfer_headers VALUES(?,?,?,?,?,?,?,?,?,?)'
    ).bind(tenant,i+2,h['Transfer ID'],h.Date,
      h['From Account ID'],h['To Account ID'],
      safeCents(h.Amount),
      h['Is Deleted']===true ||
        String(h['Is Deleted']||'').toUpperCase()==='TRUE'?1:0,
      h.Notes,h['Created By']).run();
  }
}
async function transferSnapshot(){
  return {
    bank:await bankSnapshot(),
    cash:await snapshot(),
    headers:(await DB.prepare(
      'SELECT * FROM m08_transfer_headers ORDER BY tenant_id,legacy_row'
    ).all()).results.map(x=>({...x}))
  };
}
async function transferAuditNoWrite(tenantId='SHOP-A'){
  const unchanged=await transferSnapshot();
  const result=await auditD1BankTransfers(DB,trRequest(tenantId));
  assert.deepEqual(await transferSnapshot(),unchanged,
    'Bank transfer reconciliation must never mutate bank/cash/headers');
  return result;
}
const pair=(id,from,to,amount)=>[
  tl('BB-'+id+'-O',from,'Transfer Out',id,amount),
  tl('BB-'+id+'-I',to,'Transfer In',id,amount)
];
const transferAccounts=()=>[
  bankAccount('A',300,300),bankAccount('B',200,200)
];

test('M08 transfer D1 reproduces pinned GAS header, exact opposing legs and no Cash Book leg',async()=>{
  await transferReset();
  const a=transferAccounts(),events={headers:[],legs:[],cash:0,permissions:[],session:0};
  const source=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'BankBook.gs':['transferBetweenBankAccounts']
  },{
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    CONFIG:{LOCK_TIMEOUT_MS:50},
    requirePermission_:(token,module,action)=>{
      events.permissions.push([module,action]);return {'Full Name':'Cashier'};
    },
    requireActiveCashSession_:()=>{events.session++;},
    isValidNonNegativeNumber_:v=>Number.isFinite(v)&&v>=0,
    getAllRows_:group=>{assert.equal(group,'BANK_ACCOUNTS');return a;},
    generateId_:group=>{assert.equal(group,'BANK_TRANSFERS');return 'T-1';},
    appendRow_:(group,row)=>{
      assert.equal(group,'BANK_TRANSFERS');events.headers.push(row);
    },
    addBankBookEntry_:(id,fields,account)=>{
      events.legs.push({id,fields,account});
    },
    addCashBookEntry_:()=>{events.cash++;},
    sanitizeInput_:v=>String(v??''),
    actorName_:v=>v['Full Name'],
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message})
  });
  const posted=source.transferBetweenBankAccounts('synthetic',{
    fromAccountId:'A',toAccountId:'B',amount:125.25,notes:'source'
  });
  assert.equal(posted.success,true);
  assert.deepEqual(events.permissions,[['bank','add']]);
  assert.equal(events.session,1);
  assert.equal(events.cash,0);
  assert.equal(events.headers.length,1);
  assert.deepEqual(events.legs.map(x=>[
    x.id,x.fields.Type,x.fields.Reference,x.fields.Debit,x.fields.Credit
  ]),[
    ['A','Transfer Out','T-1',125.25,''],
    ['B','Transfer In','T-1','',125.25]
  ]);
  const legs=events.legs.map((x,i)=>bankEntry(
    'BB-'+i,x.id,'2026-11-17',x.fields.Credit,x.fields.Debit,
    {Type:x.fields.Type,Reference:x.fields.Reference}
  ));
  await transferSeed('SHOP-A',a,[
    th('T-1','A','B',events.headers[0]['Amount'])
  ],legs);
  const res=await transferAuditNoWrite();
  assert.deepEqual(res.summary,{balanced:1,needsReview:0,orphanLegs:0});
  assert.deepEqual(res.transfers[0],{
    transferId:'T-1',fromAccountId:'A',toAccountId:'B',amount:125.25,
    status:'BALANCED',reasons:[],outEntryId:'BB-0',inEntryId:'BB-1'
  });
});

test('M08 transfer D1 source header row ordering outranks dates and SQL insertion order',async()=>{
  await transferReset();
  const headers=[
    th('FIRST','A','B',10,{Date:'2026-11-17'}),
    th('SECOND','B','A',20,{Date:'2026-01-01'})
  ];
  await transferSeed('SHOP-A',transferAccounts(),headers,[
    ...pair('FIRST','A','B',10),...pair('SECOND','B','A',20)
  ]);
  const r=await transferAuditNoWrite();
  assert.deepEqual(r.transfers.map(x=>x.transferId),['FIRST','SECOND']);
  assert.deepEqual(r.summary,{balanced:2,needsReview:0,orphanLegs:0});
});

test('M08 transfer D1 missing outbound or inbound source leg is never balanced',async()=>{
  await transferReset();
  await transferSeed('SHOP-A',transferAccounts(),[
    th('NOOUT','A','B',25),th('NOIN','A','B',15)
  ],[
    tl('IN','B','Transfer In','NOOUT',25),
    tl('OUT','A','Transfer Out','NOIN',15)
  ]);
  const r=await transferAuditNoWrite();
  assert.deepEqual(r.transfers.map(x=>[x.transferId,x.reasons]),[
    ['NOOUT',['MISSING_OUT_LEG']],
    ['NOIN',['MISSING_IN_LEG']]
  ]);
  assert.equal(r.summary.needsReview,2);
});

test('M08 transfer D1 duplicate outbound direction and wrong amount are deterministic discrepancies',async()=>{
  await transferReset();
  await transferSeed('SHOP-A',transferAccounts(),[th('T1','A','B',20)],[
    ...pair('T1','A','B',20),tl('O-OTHER','A','Transfer Out','T1',20)
  ]);
  const dup=await transferAuditNoWrite();
  assert.deepEqual(dup.transfers[0].reasons,['DUPLICATE_OUT_LEG']);
  await DB.prepare("DELETE FROM m08_bank_book WHERE entry_id='O-OTHER'").run();
  await DB.prepare(
    "UPDATE m08_bank_book SET debit_cents=2100 WHERE entry_id='BB-T1-O'"
  ).run();
  const mismatch=await transferAuditNoWrite();
  assert.deepEqual(mismatch.transfers[0].reasons,['OUT_AMOUNT_MISMATCH']);
});

test('M08 transfer D1 wrong bank account, same account or missing imported bank account need review',async()=>{
  await transferReset();
  await transferSeed('SHOP-A',transferAccounts(),[
    th('WRONG','A','B',20),th('SAME','A','A',10),th('UNKNOWN','A','MISSING',5)
  ],[
    tl('O1','B','Transfer Out','WRONG',20),
    tl('I1','A','Transfer In','WRONG',20),
    ...pair('SAME','A','A',10),
    tl('O3','A','Transfer Out','UNKNOWN',5),
    tl('I3','MISSING','Transfer In','UNKNOWN',5)
  ]);
  const r=await transferAuditNoWrite();
  assert.ok(r.transfers[0].reasons.includes('OUT_ACCOUNT_MISMATCH'));
  assert.ok(r.transfers[0].reasons.includes('IN_ACCOUNT_MISMATCH'));
  assert.ok(r.transfers[1].reasons.includes('SAME_BANK_ACCOUNT'));
  assert.ok(r.transfers[2].reasons.includes('UNKNOWN_TO_ACCOUNT'));
  assert.equal(r.summary.needsReview,3);
});

test('M08 transfer D1 reversed historical leg and extra non-transfer entry cannot claim a clean transfer',async()=>{
  await transferReset();
  await transferSeed('SHOP-A',transferAccounts(),[th('T1','A','B',30)],[
    tl('O','A','Transfer Out','T1',30,{Status:'Reversed'}),
    tl('I','B','Transfer In','T1',30),
    bankEntry('CORRECTION','A','2026-11-17',30,0,{
      Type:'Reversal',Reference:'O','Reversal Of':'O'
    }),
    bankEntry('NOT-TRANSFER','A','2026-11-17',0,30,{
      Type:'Cash Deposit',Reference:'T1'
    })
  ]);
  const r=await transferAuditNoWrite();
  assert.deepEqual(r.transfers[0].reasons,['CORRECTED_OUT_LEG']);
  assert.equal(r.summary.needsReview,1);
  assert.equal(r.summary.orphanLegs,0);
});

test('M08 transfer D1 deleted header and orphan reference preserve original evidence for review',async()=>{
  await transferReset();
  await transferSeed('SHOP-A',transferAccounts(),[
    th('DELETED','A','B',10,{'Is Deleted':'TRUE'}),
    th('ACTIVE','A','B',7)
  ],[
    ...pair('DELETED','A','B',10),
    ...pair('ACTIVE','A','B',7),
    tl('UNLINKED','A','Transfer Out','NEVER-IMPORTED',3)
  ]);
  const r=await transferAuditNoWrite();
  assert.deepEqual(r.transfers.map(x=>x.transferId),['ACTIVE']);
  assert.deepEqual(r.orphanLegs.map(x=>x.entryId),[
    'BB-DELETED-O','BB-DELETED-I','UNLINKED'
  ]);
  assert.equal(r.summary.orphanLegs,3);
  assert.equal(r.summary.balanced,1);
});

test('M08 transfer D1 two tenants can reuse exact source IDs without cross-tenant leg pairing',async()=>{
  await transferReset();
  const a=transferAccounts();
  await transferSeed('SHOP-A',a,[th('T-SAME','A','B',40)],
    pair('T-SAME','A','B',40));
  await transferSeed('SHOP-B',a,[th('T-SAME','A','B',70)],[
    tl('BB-T-SAME-O','A','Transfer Out','T-SAME',70)
  ]);
  const first=await transferAuditNoWrite('SHOP-A');
  const second=await transferAuditNoWrite('SHOP-B');
  assert.deepEqual(first.summary,{balanced:1,needsReview:0,orphanLegs:0});
  assert.deepEqual(second.transfers[0].reasons,['MISSING_IN_LEG']);
});

test('M08 transfer D1 duplicate imported Transfer, Bank Book and Account IDs are rejected',async()=>{
  await transferReset();
  await transferSeed('SHOP-A',transferAccounts(),[th('T1','A','B',10)],
    pair('T1','A','B',10));
  await DB.prepare(
    "INSERT INTO m08_transfer_headers VALUES ('SHOP-A',99,'T1','2026-11-17','A','B',1000,0,'','')"
  ).run();
  await assert.rejects(()=>auditD1BankTransfers(DB,trRequest()),
    /Duplicate Transfer ID/);
  await DB.prepare("DELETE FROM m08_transfer_headers WHERE legacy_row=99").run();
  await DB.prepare(
    "INSERT INTO m08_bank_book VALUES ('SHOP-A',99,'BB-T1-O','A','2026-11-17','Transfer Out','T1','',1000,0,'Active','','','','',0,0,'')"
  ).run();
  await assert.rejects(()=>auditD1BankTransfers(DB,trRequest()),
    /Duplicate Bank Book Entry ID/);
  await DB.prepare("DELETE FROM m08_bank_book WHERE legacy_row=99").run();
  await DB.prepare(
    "INSERT INTO m08_bank_accounts VALUES ('SHOP-A',99,'A','Another','Bank','1',0,0,'Active','Bank')"
  ).run();
  await assert.rejects(()=>auditD1BankTransfers(DB,trRequest()),
    /Duplicate Bank Account ID/);
});

test('M08 transfer D1 rejects malformed source date and request before financial reads or writes',async()=>{
  await transferReset();
  await transferSeed('SHOP-A',transferAccounts(),[th('T1','A','B',10)],
    pair('T1','A','B',10));
  const stable=await transferSnapshot();
  for(const bad of [
    null,{}, {tenantId:'SHOP-A;DROP'}, {tenantId:''},
    {tenantId:Promise.resolve('SHOP-A')},
    {tenantId:'SHOP-A',sql:'DELETE FROM m08_transfer_headers'}
  ])await assert.rejects(()=>auditD1BankTransfers(DB,bad),TypeError);
  await assert.rejects(()=>auditD1BankTransfers(null,trRequest()),/D1/);
  assert.deepEqual(await transferSnapshot(),stable);
  await DB.prepare(
    "UPDATE m08_transfer_headers SET date_text='2026-11-17T00:00:00Z'"
  ).run();
  const malformed=await transferSnapshot();
  await assert.rejects(()=>auditD1BankTransfers(DB,trRequest()),
    /canonical bank transfer date/);
  assert.deepEqual(await transferSnapshot(),malformed);
  assert.equal((await worker.fetch('https://m08-transfer.test/api/rpc',{
    method:'POST',body:JSON.stringify(trRequest())
  })).status,404);
});



// M08 #580: Vendor payable and receivable stay gross; Payee is identity only.
// Disposable local Workerd/D1 source provenance; no production posting.
const vpVendor=(id='V1',name='Same Shop',extra={})=>({
  'Vendor ID':id,'Vendor Name':name,Phone:'01700000001',
  Address:'Source row', 'Current Due':0,'Current Receivable':0,
  Status:'Active','Is Deleted':'',...extra
});
const vpLedger=(id,vendorId='V1',type='Payable',debit=0,credit=0,extra={})=>({
  'Ledger ID':id,'Vendor ID':vendorId,'Vendor Name':'Same Shop',
  'Balance Type':type,Date:'2026-11-17',Type:'Sourcing',Reference:'',
  Debit:debit,Credit:credit,Balance:0,'Is Deleted':'',
  'Created At':'2026-11-17T10:00:00Z',...extra
});
const vpPayee=(id='P1',name='Same Shop',extra={})=>({
  'Payee ID':id,'Payee Name':name,Phone:'01700000001',
  Status:'Active','Is Deleted':'',...extra
});
const vpExpense=(id,payeeId='P1',amount=20,extra={})=>({
  'Expense ID':id,'Ledger ID':payeeId,Amount:amount,
  'Payment Method':'Cash',Status:'Active','Is Deleted':'',...extra
});
const vpReq=(extra={})=>({
  tenantId:'SHOP-A',vendorId:'V1',payeeId:'P1',...extra
});
async function vpReset(){
  for(const table of [
    'm08_vp_expenses','m08_vp_payees','m08_vp_ledger','m08_vp_vendors'
  ])await DB.prepare('DROP TABLE IF EXISTS '+table).run();
  for(const ddl of M08_VENDOR_PAYEE_DDL)await DB.prepare(ddl).run();
}
async function vpSeed(tenant,masters=[],ledger=[],payees=[],expenses=[]){
  const deleted=x=>x['Is Deleted']===true ||
    String(x['Is Deleted']||'').toUpperCase()==='TRUE'?1:0;
  for(let i=masters.length-1;i>=0;i--){
    const m=masters[i];
    await DB.prepare('INSERT INTO m08_vp_vendors VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(tenant,i+2,m['Vendor ID'],m['Vendor Name'],
        m.Phone,m.Address,cents(m['Current Due']),
        cents(m['Current Receivable']),m.Status,deleted(m)).run();
  }
  for(let i=ledger.length-1;i>=0;i--){
    const e=ledger[i];
    await DB.prepare('INSERT INTO m08_vp_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(tenant,i+2,e['Ledger ID'],e['Vendor ID'],
        e['Vendor Name'],e.Date,e.Type,e.Reference,e['Balance Type'],
        cents(e.Debit),cents(e.Credit),cents(e.Balance),
        deleted(e),e['Created At']).run();
  }
  for(let i=payees.length-1;i>=0;i--){
    const p=payees[i];
    await DB.prepare('INSERT INTO m08_vp_payees VALUES(?,?,?,?,?,?,?)')
      .bind(tenant,i+2,p['Payee ID'],p['Payee Name'],
        p.Phone,p.Status,deleted(p)).run();
  }
  for(let i=expenses.length-1;i>=0;i--){
    const x=expenses[i];
    await DB.prepare('INSERT INTO m08_vp_expenses VALUES(?,?,?,?,?,?,?,?)')
      .bind(tenant,i+2,x['Expense ID'],x['Ledger ID'],
        cents(x.Amount),x['Payment Method'],x.Status,deleted(x)).run();
  }
}
async function vpSnapshot(){
  const data={};
  for(const name of [
    'm08_vp_vendors','m08_vp_ledger','m08_vp_payees','m08_vp_expenses'
  ])data[name]=(await DB.prepare(
    'SELECT * FROM '+name+' ORDER BY tenant_id,legacy_row'
  ).all()).results.map(x=>({...x}));
  return data;
}
async function vpRead(request=vpReq()){
  const beforeState=await vpSnapshot();
  const result=await previewD1VendorPayeeIsolation(DB,request);
  assert.deepEqual(await vpSnapshot(),beforeState,
    'M08 Vendor/Payee read must not write any D1 record');
  return result;
}
function vpSource(masters,ledger,payees){
  const src=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_','ledgerSortKey_',
      'recalculateLedgerBalancesForDisplay_'],
    'Vendors.gs':['getAllVendorsForUI_'],
    'ExpenseSettings.gs':['getActiveExpensePayeesForUI_']
  },{
    activeRows_:kind=>({
      VENDORS:masters,EXPENSE_PAYEES:payees
    }[kind]||[]).filter(row=>row['Is Deleted']!==true &&
      String(row['Is Deleted']||'').toUpperCase()!=='TRUE')
  });
  const vendorList=plain(src.getAllVendorsForUI_());
  const payeeList=plain(src.getActiveExpensePayeesForUI_());
  const ledgerDisplay=plain(src.recalculateLedgerBalancesForDisplay_(
    ledger.filter(row=>row['Is Deleted']!==true &&
      String(row['Is Deleted']||'').toUpperCase()!=='TRUE'), 'Balance Type'
  ));
  return {vendorList,payeeList,ledgerDisplay};
}

test('M08 VP vendor gross payable/receivable source running balances never net',async()=>{
  await vpReset();
  const masters=[vpVendor('V1','Same Shop',{
    'Current Due':800,'Current Receivable':250
  })];
  const ledger=[
    vpLedger('L1','V1','Payable',1000,0,{Balance:1000}),
    vpLedger('L2','V1','Receivable',300,0,{Balance:300}),
    vpLedger('L3','V1','Payable',0,200,{Balance:800}),
    vpLedger('L4','V1','Receivable',0,50,{Balance:250})
  ];
  const payees=[vpPayee()];
  await vpSeed('SHOP-A',masters,ledger,payees);
  const r=await vpRead();
  const source=vpSource(masters,ledger,payees);
  assert.deepEqual(r.vendor.profile,source.vendorList[0]);
  assert.deepEqual(r.vendor.ledger,source.ledgerDisplay);
  assert.deepEqual(r.payee.activeList,source.payeeList);
  assert.deepEqual(r.vendor.reconstructed,{payable:800,receivable:250});
  assert.deepEqual(r.vendor.drift,[]);
  assert.equal(r.payee.createsPayable,false);
  assert.equal(r.payee.liabilityAmount,null);
});

test('M08 VP stale stored master and ledger Balance are reported without a correction write',async()=>{
  await vpReset();
  const master=vpVendor('V1','A',{
    'Current Due':999,'Current Receivable':888
  });
  const entry=vpLedger('L1','V1','Payable',100,0,{Balance:3});
  await vpSeed('SHOP-A',[master],[entry],[vpPayee()]);
  const r=await vpRead();
  assert.deepEqual(r.vendor.reconstructed,{payable:100,receivable:0});
  assert.deepEqual(r.vendor.drift,[
    'MASTER_PAYABLE_MISMATCH',
    'MASTER_RECEIVABLE_MISMATCH',
    'LEDGER_STORED_BALANCE_MISMATCH:L1'
  ]);
});

test('M08 VP expense Payee is identity only even with matching Vendor ID and name',async()=>{
  await vpReset();
  const masters=[vpVendor('DUP','Same Name',{
    'Current Due':70,'Current Receivable':25
  })];
  const ledger=[
    vpLedger('LV','DUP','Payable',70,0),
    vpLedger('LR','DUP','Receivable',25,0)
  ];
  const payees=[vpPayee('DUP','Same Name')];
  const expenses=[
    vpExpense('E1','DUP',100),
    vpExpense('E2','DUP',40,{Status:'Cancelled',
      'Payment Method':'Bank'}),
    vpExpense('E3','DUP',50,{'Is Deleted':'TRUE',
      'Payment Method':'Other'})
  ];
  await vpSeed('SHOP-A',masters,ledger,payees,expenses);
  const r=await vpRead(vpReq({vendorId:'DUP',payeeId:'DUP'}));
  assert.deepEqual(r.vendor.reconstructed,{payable:70,receivable:25});
  assert.deepEqual(r.payee.expenses.map(x=>[x.expenseId,x.status,x.isDeleted]),[
    ['E1','Active',false],['E2','Cancelled',false],['E3','Active',true]
  ]);
  assert.equal(r.payee.activeExpenseTotal,100);
  assert.equal(r.payee.createsPayable,false);
  assert.equal(r.payee.liabilityAmount,null);
});

test('M08 VP source created-time ordering and physical rows are stable with reverse SQL inserts',async()=>{
  await vpReset();
  const masters=[vpVendor('V1','A',{'Current Due':45})];
  const rows=[
    vpLedger('L-early','V1','',20,0,{
      'Created At':'2026-11-17T08:00:00Z'}),
    vpLedger('L-tie-A','V1','Payable',10,0,{
      'Created At':'2026-11-17T10:00:00Z'}),
    vpLedger('L-tie-B','V1','Payable',15,0,{
      'Created At':'2026-11-17T10:00:00Z'})
  ];
  await vpSeed('SHOP-A',masters,rows,[vpPayee()]);
  const r=await vpRead();
  assert.deepEqual(r.vendor.ledger,vpSource(masters,rows,[vpPayee()]).ledgerDisplay);
  assert.deepEqual(r.vendor.ledger.map(x=>x['Ledger ID']),[
    'L-tie-A','L-tie-B','L-early'
  ]);
  assert.deepEqual(r.vendor.reconstructed,{payable:45,receivable:0});
});

test('M08 VP inactive masters remain historical and negative gross positions do not cross-net',async()=>{
  await vpReset();
  const m=vpVendor('V1','Inactive Shop',{
    'Current Due':-50,'Current Receivable':0,Status:'Inactive'
  });
  const p=vpPayee('P1','Inactive Payee',{Status:'Inactive'});
  const e=vpLedger('L1','V1','Payable',0,50,{Balance:-50});
  await vpSeed('SHOP-A',[m],[e],[p],[vpExpense('E1','P1',10)]);
  const r=await vpRead();
  assert.equal(r.vendor.profile.status,'Inactive');
  assert.equal(r.payee.selected.status,'Inactive');
  assert.equal(r.payee.selected.selectable,false);
  assert.deepEqual(r.payee.activeList,[]);
  assert.deepEqual(r.vendor.reconstructed,{payable:-50,receivable:0});
  assert.deepEqual(r.vendor.drift,[]);
});

test('M08 VP tenant scoped same source IDs never share vendor or payee transactions',async()=>{
  await vpReset();
  await vpSeed('SHOP-A',[vpVendor('V1','A',{'Current Due':30})],
    [vpLedger('L1','V1','Payable',30,0)],
    [vpPayee('P1','A')],[vpExpense('E1','P1',10)]);
  await vpSeed('SHOP-B',[vpVendor('V1','B',{'Current Due':90})],
    [vpLedger('L1','V1','Payable',90,0)],
    [vpPayee('P1','B')],[vpExpense('E1','P1',50)]);
  const first=await vpRead();
  const second=await vpRead(vpReq({tenantId:'SHOP-B'}));
  assert.equal(first.vendor.profile.name,'A');
  assert.equal(second.vendor.profile.name,'B');
  assert.equal(first.vendor.reconstructed.payable,30);
  assert.equal(second.vendor.reconstructed.payable,90);
  assert.equal(first.payee.activeExpenseTotal,10);
  assert.equal(second.payee.activeExpenseTotal,50);
});

test('M08 VP duplicate source IDs and unknown Vendor or Payee links fail closed',async()=>{
  await vpReset();
  await vpSeed('SHOP-A',[vpVendor()],[vpLedger('L1')],[vpPayee()],
    [vpExpense('E1')]);
  await DB.prepare(
    "INSERT INTO m08_vp_vendors VALUES('SHOP-A',99,'V1','Duplicate','','',0,0,'Active',0)"
  ).run();
  await assert.rejects(()=>previewD1VendorPayeeIsolation(DB,vpReq()),
    /Duplicate Vendor ID/);
  await DB.prepare('DELETE FROM m08_vp_vendors WHERE legacy_row=99').run();
  await DB.prepare(
    "INSERT INTO m08_vp_ledger VALUES('SHOP-A',99,'L1','V1','Same Shop','2026-11-17','Issue','','Receivable',10,0,0,0,'2026-11-17T11:00:00Z')"
  ).run();
  await assert.rejects(()=>previewD1VendorPayeeIsolation(DB,vpReq()),
    /Duplicate Vendor Ledger ID/);
  await DB.prepare('DELETE FROM m08_vp_ledger WHERE legacy_row=99').run();
  await DB.prepare("UPDATE m08_vp_ledger SET vendor_id='MISSING'").run();
  await assert.rejects(()=>previewD1VendorPayeeIsolation(DB,vpReq()),
    /Unresolved Vendor ledger reference/);
  await DB.prepare("UPDATE m08_vp_ledger SET vendor_id='V1'").run();
  await DB.prepare("UPDATE m08_vp_expenses SET payee_id='MISSING'").run();
  await assert.rejects(()=>previewD1VendorPayeeIsolation(DB,vpReq()),
    /Unresolved Expense Payee ID/);
});

test('M08 VP invalid requests, imported cents and public Worker route fail closed without writes',async()=>{
  await vpReset();
  await vpSeed('SHOP-A',[vpVendor()],[vpLedger('L1')],[vpPayee()],
    [vpExpense('E1')]);
  const unchanged=await vpSnapshot();
  for(const bad of [
    null,{}, {tenantId:''}, {tenantId:'SHOP-A;DROP',
      vendorId:'V1',payeeId:'P1'},
    {tenantId:'SHOP-A',vendorId:'V1',payeeId:'P1',sql:'SELECT 1'},
    {tenantId:Promise.resolve('SHOP-A'),vendorId:'V1',payeeId:'P1'},
    Object.defineProperty({tenantId:'SHOP-A',vendorId:'V1'},
      'payeeId',{get(){throw Error('getter');},enumerable:true})
  ])await assert.rejects(()=>previewD1VendorPayeeIsolation(DB,bad),TypeError);
  await assert.rejects(()=>previewD1VendorPayeeIsolation(null,vpReq()),
    /D1/);
  assert.deepEqual(await vpSnapshot(),unchanged);
  await DB.prepare("UPDATE m08_vp_expenses SET amount_cents=-100").run();
  const negative=await vpSnapshot();
  await assert.rejects(()=>previewD1VendorPayeeIsolation(DB,vpReq()),
    /Invalid source Expense amount cents/);
  assert.deepEqual(await vpSnapshot(),negative);
  assert.equal((await worker.fetch('https://m08-vp.test/api/rpc',{
    method:'POST',body:JSON.stringify(vpReq())
  })).status,404);
});
