import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const impl=await import('../src/modules/m09-dashboard-offline-row-parity.js')
  .catch(error=>error.code==='ERR_MODULE_NOT_FOUND'?null:Promise.reject(error));
const audit=input=>{
  assert.equal(typeof impl?.auditM09DashboardOfflineRowParity,'function',
    'M09 source-vs-import row proof not yet implemented');
  return impl.auditM09DashboardOfflineRowParity(input);
};
const GROUPS=['SALES','SALES_RETURN','SALES_RETURN_ITEMS','CUSTOMERS',
  'CUSTOMER_LEDGER','SUPPLIERS','SUPPLIER_LEDGER','FINANCE_TRANSACTIONS'];
const HEX='a'.repeat(64);
const rec=(ordinal,id,extra={})=>({ordinal,id,deleted:false,
  fingerprint:HEX,...extra});
const finance=(ordinal,id,kind,accountId,minor='100')=>rec(ordinal,id,{
  accountKind:kind,accountSourceId:accountId,signedMinor:minor
});
const complete=()=>{
  const sourceGroups=Object.fromEntries(GROUPS.map(g=>[g,[]]));
  sourceGroups.SALES.push(rec(2,'INV-1'));
  sourceGroups.SALES_RETURN.push(rec(2,'SR-1',{invoiceId:'INV-1'}));
  sourceGroups.SALES_RETURN_ITEMS.push(rec(2,null,{
    returnId:'SR-1',invoiceId:'INV-1'
  }));
  sourceGroups.CUSTOMERS.push(rec(2,'C-1'));
  sourceGroups.SUPPLIERS.push(rec(2,'S-1'));
  sourceGroups.CUSTOMER_LEDGER.push(finance(2,'CL-1','CUSTOMER_AR','C-1','15000'));
  sourceGroups.CUSTOMER_LEDGER.push(finance(3,'CL-2','CUSTOMER_ADVANCE','C-1','-2000'));
  sourceGroups.SUPPLIER_LEDGER.push(finance(2,'SL-1','SUPPLIER_AP','S-1','14000'));
  sourceGroups.FINANCE_TRANSACTIONS.push(
    finance(2,'FT-1','OWNER_EQUITY','F-1','50000'));
  sourceGroups.FINANCE_TRANSACTIONS.push(
    finance(3,'FT-2','LENDER_LOAN_AP','F-1','-10000'));
  sourceGroups.FINANCE_TRANSACTIONS.push(
    finance(4,'FT-3','BORROWER_LOAN_AR','F-1','7000'));
  return {sourceGroups,importedGroups:structuredClone(sourceGroups)};
};
const group=(out,name)=>{
  const x=out.groups.find(g=>g.key===name);
  assert.ok(x,'Missing group '+name);
  return x;
};
const codes=(out,name)=>group(out,name).issues;

test('trusted offline historical rows match without authorizing any live dashboard read',()=>{
  const data=complete(),before=structuredClone(data);
  const out=audit(data);
  assert.equal(out.ready,false);
  assert.equal(out.evidenceComplete,true);
  assert.equal(out.status,'ROW_PARITY_ONLY_NOT_AUTHORIZED');
  assert.deepEqual(out.groups.map(g=>g.key),GROUPS);
  for(const item of out.groups){
    assert.equal(item.ready,false);
    assert.equal(item.evidenceComplete,true);
    assert.deepEqual(item.issues,[]);
  }
  assert.deepEqual(data,before,'audit must not modify source/import fixtures');
  assert.doesNotMatch(JSON.stringify(out),/INV-1|C-1|S-1|15000|50000|CL-1/);
});

test('missing groups and missing import rows block; reviewed zero-row pairs are distinct',()=>{
  const data=complete();
  delete data.importedGroups.SALES;
  data.importedGroups.CUSTOMERS=[];
  const out=audit(data);
  assert.ok(codes(out,'SALES').includes('MISSING_IMPORTED_GROUP'));
  assert.ok(codes(out,'CUSTOMERS').includes('MISSING_IMPORTED_ROWS'));
  assert.ok(codes(out,'CUSTOMERS').includes('ROW_COUNT_MISMATCH'));
  assert.deepEqual(codes(out,'SUPPLIERS'),[]);
  const x=complete();
  x.sourceGroups.CUSTOMERS=[];
  x.importedGroups.CUSTOMERS=[];
  assert.deepEqual(codes(audit(x),'CUSTOMERS'),[]);
  const missing=complete();delete missing.sourceGroups.CUSTOMERS;
  assert.ok(codes(audit(missing),'CUSTOMERS').includes('MISSING_SOURCE_GROUP'));
});

test('extra imported rows, duplicates and historical Sale invoice ambiguity are explicit',()=>{
  const data=complete();
  data.importedGroups.CUSTOMERS.push(rec(99,'NEW-CUSTOMER'));
  data.sourceGroups.SUPPLIERS.push(rec(2,'S-2'));
  data.importedGroups.SALES.push(rec(2,'INV-2'));
  const out=audit(data);
  assert.ok(codes(out,'CUSTOMERS').includes('EXTRA_IMPORTED_ROWS'));
  assert.ok(codes(out,'SUPPLIERS').includes('DUPLICATE_SOURCE_ORDINAL'));
  assert.ok(codes(out,'SALES').includes('DUPLICATE_IMPORTED_ORDINAL'));
  const history=complete();
  history.sourceGroups.SALES.push(rec(3,'INV-1',{deleted:true}));
  history.importedGroups.SALES.push(rec(3,'INV-1',{deleted:true}));
  assert.ok(codes(audit(history),'SALES').includes('AMBIGUOUS_HISTORICAL_SOURCE_ID'));
});

test('same count never excuses wrong original ID, deleted flag or canonical source hash',()=>{
  const data=complete();
  data.importedGroups.SALES[0].id='INV-RENAMED';
  data.importedGroups.SALES[0].deleted=true;
  data.importedGroups.SALES[0].fingerprint='b'.repeat(64);
  const out=audit(data);
  for(const k of ['SOURCE_ID_DRIFT','DELETION_STATE_DRIFT','SOURCE_PAYLOAD_DRIFT'])
    assert.ok(codes(out,'SALES').includes(k),k);
  assert.ok(out.groups.every(g=>g.ready===false));
  assert.equal(out.evidenceComplete,false);
});

test('return ancestry detects missing active parent or child invoice drift, not deleted history',()=>{
  const data=complete();
  data.sourceGroups.SALES_RETURN_ITEMS[0].invoiceId='INV-WRONG';
  data.importedGroups.SALES_RETURN_ITEMS[0].invoiceId='INV-WRONG';
  const out=audit(data);
  assert.ok(codes(out,'SALES_RETURN_ITEMS')
    .includes('SOURCE_RETURN_INVOICE_MISMATCH'));
  const missing=complete();
  missing.importedGroups.SALES_RETURN=[];
  assert.ok(codes(audit(missing),'SALES_RETURN_ITEMS')
    .includes('IMPORTED_ORPHAN_ACTIVE_RETURN_ITEM'));
  const historical=complete();
  historical.sourceGroups.SALES_RETURN[0].deleted=true;
  historical.importedGroups.SALES_RETURN[0].deleted=true;
  // Full physical deleted-parent child history is preserved, but children of
  // deleted return headers are not counted in an active economic return.
  assert.deepEqual(codes(audit(historical),'SALES_RETURN_ITEMS'),[]);
});

test('gross Party role account dimensions and signed amounts cannot silently net',()=>{
  const data=complete();
  // Equal net balance does not make Customer AR, Customer advance and
  // Supplier AP interchangeable when the same Party has multiple roles.
  data.importedGroups.CUSTOMER_LEDGER[0].accountKind='CUSTOMER_ADVANCE';
  data.importedGroups.CUSTOMER_LEDGER[0].accountSourceId='C-OTHER';
  data.importedGroups.CUSTOMER_LEDGER[0].signedMinor='-15000';
  data.importedGroups.FINANCE_TRANSACTIONS[1].accountKind='OWNER_EQUITY';
  const out=audit(data);
  for(const k of ['PARTY_ACCOUNT_KIND_DRIFT','PARTY_SOURCE_LINK_DRIFT',
    'SIGNED_AMOUNT_DRIFT'])
    assert.ok(codes(out,'CUSTOMER_LEDGER').includes(k),k);
  assert.ok(codes(out,'FINANCE_TRANSACTIONS').includes('PARTY_ACCOUNT_KIND_DRIFT'));
  assert.deepEqual(codes(out,'SUPPLIER_LEDGER'),[]);
});

test('malformed, sparse, accessor and input prototype tricks fail closed without getter execution',()=>{
  for(const input of [null,undefined,[],{},Promise.resolve({}),
    {sourceGroups:{},importedGroups:null}]){
    assert.throws(()=>audit(input),/Invalid trusted M09/i);
  }
  let calls=0;
  const root=complete();
  Object.defineProperty(root,'sourceGroups',{
    get(){calls++;throw Error('PRIVATE_LEDGER_TOKEN');}
  });
  assert.throws(()=>audit(root),err=>!String(err).includes('PRIVATE_LEDGER_TOKEN'));
  assert.equal(calls,0);
  const bad=complete();
  Object.defineProperty(bad.importedGroups,'SALES',{
    get(){calls++;throw Error('PRIVATE_CUSTOMER_ID');}
  });
  const result=audit(bad);
  assert.equal(calls,0);
  assert.ok(codes(result,'SALES').includes('INVALID_IMPORTED_GROUP'));
  const sparse=complete();
  sparse.importedGroups.SALES.length=4;
  assert.ok(codes(audit(sparse),'SALES').includes('INVALID_IMPORTED_ROWS'));
  const invalid=complete();
  invalid.sourceGroups.CUSTOMER_LEDGER[0].signedMinor='150.00';
  assert.ok(codes(audit(invalid),'CUSTOMER_LEDGER').includes('INVALID_SOURCE_ROWS'));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_LEDGER_TOKEN|PRIVATE_CUSTOMER_ID/);
});

test('no DB, RPC, financial projection or raw source values can leave this M09 proof',()=>{
  const js=readFileSync(new URL(
    '../src/modules/m09-dashboard-offline-row-parity.js',import.meta.url),'utf8');
  for(const forbidden of [/\b(?:fetch|prepare|batch|exec|serverCall)\s*\(/i,
      /\bgetDashboardStats\s*\(/,/from ['"](?:\.\.\/)?(?:db|rpc)\//i])
    assert.doesNotMatch(js,forbidden);
  const out=audit(complete());
  assert.equal(out.ready,false);
  for(const value of Object.values(out))
    assert.notEqual(value,undefined);
  assert.doesNotMatch(JSON.stringify(out),/accountSourceId|signedMinor|fingerprint|id":/);
});

test('equal source/import snapshots still reject orphan Customer and Supplier ledger source links',()=>{
  const data=complete();
  for(const side of ['sourceGroups','importedGroups']){
    data[side].CUSTOMER_LEDGER[0].accountSourceId='C-ORPHAN';
    data[side].SUPPLIER_LEDGER[0].accountSourceId='S-ORPHAN';
  }
  const out=audit(data);
  assert.equal(out.ready,false);
  assert.equal(out.evidenceComplete,false,
    'matching orphan source IDs cannot establish even offline referential parity');
  for(const side of ['SOURCE','IMPORTED']){
    assert.ok(codes(out,'CUSTOMER_LEDGER').includes(side+'_ORPHAN_ACCOUNT_LINK'));
    assert.ok(codes(out,'SUPPLIER_LEDGER').includes(side+'_ORPHAN_ACCOUNT_LINK'));
  }
  assert.doesNotMatch(JSON.stringify(out),/C-ORPHAN|S-ORPHAN/);

  // A soft-deleted historical master is a valid original identity for
  // preserved ledger audit history, not a reason to erase the transaction.
  const history=complete();
  for(const side of ['sourceGroups','importedGroups']){
    history[side].CUSTOMERS[0].deleted=true;
    history[side].SUPPLIERS[0].deleted=true;
  }
  assert.deepEqual(codes(audit(history),'CUSTOMER_LEDGER'),[]);
  assert.deepEqual(codes(audit(history),'SUPPLIER_LEDGER'),[]);
});
