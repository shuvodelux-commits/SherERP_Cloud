/**
 * M02 supplier source-link acceptance, synthetic offline evidence ONLY.
 * No source history, Shop D1 or operational SQL writer is read or modified.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reviewSupplierSourceLinks} from './fixtures/m02-supplier-source-link-rehearsal.mjs';

const base=()=>({
  shopId:'SHOP-A',mode:'NEW_SHOP',
  suppliers:[{'Supplier ID':'SUP-A','Supplier Name':'Same Name',Phone:'01700000000',
    Status:'Active','Is Deleted':'',_rowIndex:2}],
  purchases:[{'Purchase ID':'PUR-A','Supplier ID':'SUP-A'}],
  returns:[{'Return ID':'RET-A','Purchase ID':'PUR-A','Supplier ID':'SUP-A'}],
  supplierLedger:[
    {'Ledger ID':'LED-A','Supplier ID':'SUP-A',Type:'Purchase',Reference:'PUR-A'},
    {'Ledger ID':'LED-B','Supplier ID':'SUP-A',Type:'Purchase Return Credit',Reference:'RET-A'},
    {'Ledger ID':'LED-C','Supplier ID':'SUP-A',Type:'Payment',Reference:'PAYMENT'}
  ]
});
const codes=report=>report.blockers.map(x=>x.code);
const assertBlocked=(input,code)=>{
  const r=reviewSupplierSourceLinks(input);
  assert.equal(r.readyForReview,false);
  assert.ok(codes(r).includes(code),JSON.stringify(r));
  return r;
};
test('exact valid new-shop Supplier -> Purchase -> Return -> Ledger links close without posting',()=>{
  const r=reviewSupplierSourceLinks(base());
  assert.deepEqual(r.blockers,[]);
  assert.equal(r.readyForReview,true);
  assert.deepEqual(r.counts,{suppliers:1,purchases:1,returns:1,supplierLedger:3});
  assert.deepEqual(r.effects,{cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0});
});
test('same names and phones never merge two literal Supplier IDs',()=>{
  const x=base();
  x.suppliers.push({'Supplier ID':'SUP-B','Supplier Name':'Same Name',Phone:'01700000000',
    Status:'Active',_rowIndex:3});
  x.purchases.push({'Purchase ID':'PUR-B','Supplier ID':'SUP-B'});
  x.supplierLedger.push({'Ledger ID':'LED-D','Supplier ID':'SUP-B',
    Type:'Purchase',Reference:'PUR-B'});
  const r=reviewSupplierSourceLinks(x);
  assert.equal(r.readyForReview,true);
  assert.equal(r.counts.suppliers,2);
  assert.deepEqual(r.blockers,[]);
  assert.doesNotMatch(JSON.stringify(r),/Same Name|01700000000|SUP-A|SUP-B|PUR-A/);
});
test('same-looking whitespace Supplier ID is not resolved by trim or phone',()=>{
  const x=base();x.purchases[0]['Supplier ID']=' SUP-A ';
  assertBlocked(x,'PURCHASE_SUPPLIER_LINK_MISSING');
});
test('duplicate or missing original Supplier IDs are quarantine blockers even with unrelated physical rows',()=>{
  const x=base();
  x.suppliers.push({...x.suppliers[0],_rowIndex:9});
  assertBlocked(x,'DUPLICATE_SUPPLIER_SOURCE_ID');
  const y=base();y.suppliers[0]['Supplier ID']='   ';
  assertBlocked(y,'SUPPLIER_SOURCE_ID_REQUIRED');
});
test('missing Purchase or a Return claiming a different Supplier is never linked by name',()=>{
  const a=base();a.returns[0]['Purchase ID']='PUR-OTHER';
  assertBlocked(a,'RETURN_PURCHASE_LINK_MISSING');
  const b=base();b.suppliers.push({'Supplier ID':'SUP-B','Supplier Name':'Same Name',
    Phone:'01700000000',Status:'Active',_rowIndex:3});
  b.returns[0]['Supplier ID']='SUP-B';
  assertBlocked(b,'RETURN_SUPPLIER_MISMATCH');
});
test('Supplier Ledger Purchase and Return references must resolve within exact Supplier lineage',()=>{
  const x=base();x.supplierLedger[0].Reference='PUR-OTHER';
  assertBlocked(x,'LEDGER_PURCHASE_REF_INVALID');
  const y=base();y.supplierLedger[1]['Supplier ID']='SUP-OTHER';
  assertBlocked(y,'LEDGER_SUPPLIER_LINK_MISSING');
  assertBlocked(y,'LEDGER_RETURN_REF_INVALID');
});
test('unknown ledger source type blocks approval without inventing a financial allocation',()=>{
  const x=base();x.supplierLedger[2].Type='Synthetic Unknown Credit';
  assertBlocked(x,'LEDGER_SOURCE_TYPE_UNREVIEWED');
});
test('a newly created purchase rejects retired Supplier; historical reference remains available',()=>{
  const x=base();x.suppliers[0].Status='Inactive';x.suppliers[0]['Is Deleted']='TRUE';
  assertBlocked(x,'PURCHASE_SUPPLIER_INACTIVE_NEW_SHOP');
  x.mode='HISTORICAL_READBACK';
  const legacy=reviewSupplierSourceLinks(x);
  assert.equal(legacy.readyForReview,true);
  assert.equal(legacy.counts.purchases,1);
  assert.deepEqual(legacy.blockers,[]);
});
test('real source Payment and Opening Balance reference labels are not imagined as Purchase IDs',()=>{
  const x=base();x.supplierLedger.push({'Ledger ID':'LED-OPEN','Supplier ID':'SUP-A',
    Type:'Opening Balance',Reference:'SUP-A'});
  const result=reviewSupplierSourceLinks(x);
  assert.equal(result.readyForReview,true);
  assert.equal(result.counts.supplierLedger,4);
});
test('repeated original ledger, return, and purchase IDs fail closed with redacted fixed codes',()=>{
  const x=base();x.supplierLedger.push({...x.supplierLedger[0]});
  assertBlocked(x,'DUPLICATE_LEDGER_ID');
  const y=base();y.purchases.push({...y.purchases[0]});
  assertBlocked(y,'DUPLICATE_PURCHASE_ID');
  const z=base();z.returns.push({...z.returns[0]});
  assertBlocked(z,'DUPLICATE_RETURN_ID');
});
test('source row order does not alter report, and original records remain unchanged',()=>{
  const x=base();x.suppliers.push({'Supplier ID':'SUP-B','Supplier Name':'Other',
    Phone:'',Status:'Active',_rowIndex:3});
  x.purchases.push({'Purchase ID':'PUR-B','Supplier ID':'SUP-B'});
  const before=structuredClone(x);
  const first=reviewSupplierSourceLinks(x);
  x.suppliers.reverse();x.purchases.reverse();x.supplierLedger.reverse();
  const second=reviewSupplierSourceLinks(x);
  assert.deepEqual(first,second);
  assert.deepEqual(before.suppliers[0],x.suppliers[1]);
});
test('malformed snapshots fail closed with generic errors free of source identifiers',()=>{
  for(const candidate of [
    {...base(),suppliers:null},
    {...base(),purchases:null},
    {...base(),shopId:''},
    {...base(),mode:'LIVE_IMPORT'},
    {...base(),supplierLedger:[null]}
  ])assert.throws(()=>reviewSupplierSourceLinks(candidate),err=>
    /Supplier source rehearsal unavailable/.test(err.message)&&
    !/SUP-A|PUR-A|Same Name/.test(err.message));
});
