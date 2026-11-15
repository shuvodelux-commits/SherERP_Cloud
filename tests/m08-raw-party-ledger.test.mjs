import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRawLegacyPartyLedger} from '../src/modules/m08-party-raw-ledger.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const snapshot=value=>JSON.parse(JSON.stringify(value));
const row=(ledgerId,kind,legacyId,date,rowIndex,debit='',credit='',extra={})=>({
  'Ledger ID':ledgerId,
  [kind==='customer'?'Customer ID':'Supplier ID']:legacyId,
  [kind==='customer'?'Customer Name':'Supplier Name']:'Example Trade',
  'Date':date,'Type':'Opening Balance',
  'Debit':debit,'Credit':credit,
  'Created At':'2026-11-15T23:59:00+06:00',
  'Is Deleted':'',
  '_rowIndex':rowIndex,
  ...extra
});

function originalIndex(kind,legacyId,sourceRows) {
  const originals=loadPinnedGASFunctions({
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
    partyLedgerReadIndex_:()=>snapshot(sourceRows)
  });
  return snapshot(originals.partyLedgerBuildAscendingIndex_(kind,legacyId));
}
function assertOracle(kind,legacyId,rows,actual) {
  assert.deepEqual(actual.rows,originalIndex(kind,legacyId,rows));
  assert.equal(actual.kind,kind);
  assert.equal(actual.legacyId,legacyId);
}

test('customer audit entries remain ordered by business date and sheet row, with corrections and payments',()=>{
  const rows=[
    row('CL-3','customer','C1','2026-11-13',8,'',20,{Type:'Payment Received'}),
    row('CL-1','customer','C1','2026-11-12',5,150,'',{Type:'Sale','Created At':'2026-11-16T00:00:00Z'}),
    row('CL-2','customer','C1','2026-11-12',6,25,'',{Type:'Sale Update Debit'}),
    row('CL-DELETED','customer','C1','2026-11-12',7,900,'',{'Is Deleted':'TRUE'}),
    row('CL-OTHER','customer','C2','2026-11-12',4,10000),
    row('CL-4','customer','C1','2026-11-14',10,'',80,{Type:'Payment Received'})
  ];
  const actual=projectRawLegacyPartyLedger('customer','C1',rows);
  assertOracle('customer','C1',rows,actual);
  assert.deepEqual(actual.rows.map(x=>x['Ledger ID']),['CL-1','CL-2','CL-3','CL-4']);
  assert.deepEqual(actual.rows.map(x=>x._displayBalance),[150,175,155,75]);
  assert.equal(actual.closingBalance,75);
});

test('supplier payable and advance keep the original debit-minus-credit sign without converting to customer AR',()=>{
  const rows=[
    row('SL-3','supplier','S1','2026-11-14',7,'',200,{Type:'Purchase Return'}),
    row('SL-1','supplier','S1','2026-11-12',2,300,'',{Type:'Purchase'}),
    row('SL-2','supplier','S1','2026-11-13',4,'',150,{Type:'Supplier Payment'})
  ];
  const actual=projectRawLegacyPartyLedger('supplier','S1',rows);
  assertOracle('supplier','S1',rows,actual);
  assert.deepEqual(actual.rows.map(x=>x._displayBalance),[300,150,-50]);
  assert.equal(actual.closingBalance,-50);
});

test('same external identity label or ID in Customer and Supplier ledgers must never combine role balances',()=>{
  const rows=[
    row('C-A','customer','dual-id','2026-11-10',2,500),
    row('S-A','supplier','dual-id','2026-11-10',3,300),
    row('C-B','customer','another','2026-11-10',4,7000),
    row('S-B','supplier','another','2026-11-10',5,9000)
  ];
  const customer=projectRawLegacyPartyLedger('customer','dual-id',rows);
  const supplier=projectRawLegacyPartyLedger('supplier','dual-id',rows);
  assertOracle('customer','dual-id',rows,customer);
  assertOracle('supplier','dual-id',rows,supplier);
  assert.equal(customer.closingBalance,500);
  assert.equal(supplier.closingBalance,300);
  assert.deepEqual(customer.rows.map(x=>x['Ledger ID']),['C-A']);
  assert.deepEqual(supplier.rows.map(x=>x['Ledger ID']),['S-A']);
});

test('source deletion only treats boolean true or text TRUE as voided, not arbitrary truthy flags',()=>{
  const rows=[
    row('D1','customer','C1','2026-11-15',2,100,'',{'Is Deleted':true}),
    row('D2','customer','C1','2026-11-15',3,200,'',{'Is Deleted':'tRuE'}),
    row('D3','customer','C1','2026-11-15',4,30,'',{'Is Deleted':'FALSE'}),
    row('D4','customer','C1','2026-11-15',5,20,'',{'Is Deleted':'Yes'})
  ];
  const actual=projectRawLegacyPartyLedger('customer','C1',rows);
  assertOracle('customer','C1',rows,actual);
  assert.deepEqual(actual.rows.map(x=>x['Ledger ID']),['D3','D4']);
  assert.equal(actual.closingBalance,50);
});

test('backdated business date and same-day sheet row index outrank Created At and Ledger ID',()=>{
  const rows=[
    row('A','customer','C1','2026-11-15',10,'',5,{Type:'Sale Update Credit','Created At':'2026-11-13T01:00:00Z'}),
    row('Z','customer','C1','2026-11-15',2,20,'',{Type:'Sale','Created At':'2026-11-17T00:00:00Z'}),
    row('B','customer','C1','2026-11-13',90,10,'',{Type:'Sale'}),
    row('BB','customer','C1','2026-11-15',10,'',2,{Type:'Sale Update Credit'})
  ];
  const actual=projectRawLegacyPartyLedger('customer','C1',rows);
  assertOracle('customer','C1',rows,actual);
  assert.deepEqual(actual.rows.map(x=>x['Ledger ID']),['B','Z','A','BB']);
  assert.deepEqual(actual.rows.map(x=>x._displayBalance),[10,30,25,23]);
  assert.equal(actual.closingBalance,23);
});

test('round after each debit-credit movement exactly as the source, not only once at the end',()=>{
  const rows=[
    row('A','customer','C1','2026-11-14',2,0.1),
    row('B','customer','C1','2026-11-14',3,0.2),
    row('C','customer','C1','2026-11-14',4,'',0.1)
  ];
  const actual=projectRawLegacyPartyLedger('customer','C1',rows);
  assertOracle('customer','C1',rows,actual);
  assert.deepEqual(actual.rows.map(x=>x._displayBalance),[0.1,0.3,0.2]);
  assert.equal(actual.closingBalance,0.2);
});

test('raw correction chains remain separate audit evidence; do not silently switch to clean/display ledger',()=>{
  const rows=[
    row('SALE','customer','C1','2026-11-12',2,100,'',{Type:'Sale',Reference:'INV-1'}),
    row('UNDO','customer','C1','2026-11-13',3,'',100,{Type:'Sale Update Credit',Reference:'INV-1'}),
    row('REPLACE','customer','C1','2026-11-13',4,80,'',{Type:'Sale Update Debit',Reference:'INV-1'})
  ];
  const actual=projectRawLegacyPartyLedger('customer','C1',rows);
  assertOracle('customer','C1',rows,actual);
  assert.deepEqual(actual.rows.map(x=>x['Ledger ID']),['SALE','UNDO','REPLACE']);
  assert.deepEqual(actual.rows.map(x=>x._displayBalance),[100,0,80]);
});

test('no matching active ledger returns a signed zero without fabricated account activity',()=>{
  const rows=[row('C1','customer','C1','2026-11-15',2,500,'',{'Is Deleted':true})];
  for(const kind of ['customer','supplier']){
    const actual=projectRawLegacyPartyLedger(kind,'C1',rows);
    assertOracle(kind,'C1',rows,actual);
    assert.equal(actual.closingBalance,0);
    assert.deepEqual(actual.rows,[]);
  }
});

test('pure projection never mutates or reorders frozen caller-owned source rows',()=>{
  const source=Object.freeze([
    Object.freeze(row('L2','customer','C1','2026-11-15',9,'',25)),
    Object.freeze(row('L1','customer','C1','2026-11-14',3,100))
  ]);
  const actual=projectRawLegacyPartyLedger('customer','C1',source);
  assertOracle('customer','C1',source,actual);
  assert.deepEqual(source.map(x=>x['Ledger ID']),['L2','L1']);
  assert.equal(actual.closingBalance,75);
  assert.equal(Object.hasOwn(source[0],'_displayBalance'),false);
});

test('unknown finance relationship roles, missing source ID, and leaked pending Promise fail closed',()=>{
  for(const badKind of ['owner','lender','borrower','payee','vendor',null]) {
    assert.throws(()=>projectRawLegacyPartyLedger(badKind,'X',[]),TypeError);
  }
  assert.throws(()=>projectRawLegacyPartyLedger('customer','',[]),TypeError);
  assert.throws(()=>projectRawLegacyPartyLedger('supplier','S',Promise.resolve([])),TypeError);
  assert.throws(()=>projectRawLegacyPartyLedger('supplier','S',null),TypeError);
});
