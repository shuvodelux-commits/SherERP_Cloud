import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import ensures the test-first commit produces an intentional assertion
// failure rather than a Node ESM loader error.
const impl=await import('../src/modules/m09-purchase-return-report-lineage-audit.js')
  .catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
function audit(snapshot){
  assert.equal(typeof impl?.auditM09PurchaseReturnLineage,'function',
    'M09 Purchase Return report lineage audit not implemented');
  return impl.auditM09PurchaseReturnLineage(snapshot);
}
const purchase=(id,deleted='')=>({
  'Purchase ID':id,'Date':'2026-11-16','Supplier ID':'S-1',
  'Subtotal':200,'Grand Total':180,'Is Deleted':deleted
});
const header=(returnId,purchaseId='PO-1',deleted='')=>({
  'Return ID':returnId,'Purchase ID':purchaseId,
  'Total Return Amount':50,'Is Deleted':deleted
});
const child=(returnId,purchaseId='PO-1')=>({
  'Return ID':returnId,'Purchase ID':purchaseId,
  'Product ID':'TILE-1','Return Quantity':1,
  'Line Total':50,'Pricing Basis':'NetAfterInvoiceDiscount'
});
const fixture=()=>({
  allPurchases:[purchase('PO-1'),purchase('PO-2'),purchase('OLD','TRUE')],
  returnHeaders:[header('PR-1')],
  returnItems:[child('PR-1')]
});

test('M09 authentic Purchase Return lineage is diagnostic only, never report authorization',()=>{
  const data=fixture();
  data.returnHeaders.push(header('PR-2','PO-2'));
  data.returnItems.push(child('PR-2','PO-2'));
  const before=JSON.stringify(data);
  assert.deepEqual(audit(data),{
    ready:false,lineageComplete:true,status:'SOURCE_LINEAGE_ONLY',issues:[]
  });
  assert.equal(JSON.stringify(data),before);
  assert.equal(Object.hasOwn(audit(data),'totals'),false);
});

test('M09 mismatch cannot shift returned money to another Purchase ID in report',()=>{
  const data=fixture();
  data.returnItems[0]['Purchase ID']='PO-2';
  const r=audit(data);
  assert.deepEqual(r.issues,['MISMATCHED_RETURN_PURCHASE']);
  assert.equal(r.lineageComplete,false);
  assert.equal(r.ready,false);
});

test('M09 orphan active return child is blocked instead of silently skipped',()=>{
  const data=fixture();
  data.returnItems.push(child('ORPHAN-RETURN'));
  assert.deepEqual(audit(data).issues,['ORPHAN_ACTIVE_RETURN_ITEM']);
});

test('M09 absent or deleted original purchase is reported independently',()=>{
  const missing=fixture();
  missing.returnHeaders[0]['Purchase ID']='UNKNOWN';
  missing.returnItems[0]['Purchase ID']='UNKNOWN';
  assert.deepEqual(audit(missing).issues,['MISSING_ACTIVE_PURCHASE']);
  const deleted=fixture();
  deleted.returnHeaders[0]['Purchase ID']='OLD';
  deleted.returnItems[0]['Purchase ID']='OLD';
  assert.deepEqual(audit(deleted).issues,['MISSING_ACTIVE_PURCHASE']);
});

test('M09 duplicate active original Purchase ID and Return ID are blockers',()=>{
  const duplicatedPurchase=fixture();
  duplicatedPurchase.allPurchases.push(purchase('PO-1'));
  assert.deepEqual(audit(duplicatedPurchase).issues,['DUPLICATE_ACTIVE_PURCHASE_ID']);
  const duplicatedReturn=fixture();
  duplicatedReturn.returnHeaders.push(header('PR-1'));
  assert.ok(audit(duplicatedReturn).issues.includes('DUPLICATE_ACTIVE_RETURN_ID'));
});

test('M09 empty active return header and invalid source identifiers remain review-required',()=>{
  const empty=fixture();
  empty.returnItems=[];
  assert.deepEqual(audit(empty).issues,['ACTIVE_RETURN_WITHOUT_ITEMS']);
  const badPurchase=fixture();
  badPurchase.allPurchases[0]['Purchase ID']='';
  assert.ok(audit(badPurchase).issues.includes('INVALID_PURCHASE_ID'));
  const badHeader=fixture();
  badHeader.returnHeaders[0]['Return ID']=0;
  assert.ok(audit(badHeader).issues.includes('INVALID_RETURN_ID'));
  const badChild=fixture();
  badChild.returnItems[0]['Return ID']=null;
  assert.ok(audit(badChild).issues.includes('INVALID_CHILD_RETURN_ID'));
});

test('M09 frozen deletion markers exclude deleted parents and children',()=>{
  const data=fixture();
  data.returnHeaders.push(header('PR-DELETED','UNKNOWN','true'));
  data.returnItems.push(child('PR-DELETED','PO-2'));
  assert.deepEqual(audit(data).issues,[]);
  data.returnItems.push({...child('PR-1','PO-2'),'Is Deleted':'TRUE'});
  assert.deepEqual(audit(data).issues,[]);
  data.returnHeaders[0]['Is Deleted']='True';
  assert.deepEqual(audit(data).issues,[]);
  const sourceDeleted=fixture();
  sourceDeleted.allPurchases[0]['Is Deleted']='true';
  assert.deepEqual(audit(sourceDeleted).issues,['MISSING_ACTIVE_PURCHASE']);
  const explicitFalse=fixture();
  explicitFalse.returnHeaders[0]['Is Deleted']='false';
  assert.deepEqual(audit(explicitFalse).issues,[]);
  explicitFalse.returnHeaders[0]['Is Deleted']=0;
  assert.deepEqual(audit(explicitFalse).issues,[]);
});

test('M09 original optional child Is Deleted does not mask a live header with zero active lines',()=>{
  const data=fixture();
  data.returnItems[0]['Is Deleted']='TrUe';
  assert.deepEqual(audit(data).issues,['ACTIVE_RETURN_WITHOUT_ITEMS']);
});

test('M09 rejects malformed, sparse and accessor-backed source receipts without invoking getters',()=>{
  for(const malformed of [undefined,null,[],{},
    {allPurchases:[],returnHeaders:[],returnItems:null},
    {allPurchases:[],returnHeaders:[]}])
    assert.throws(()=>audit(malformed),/trusted|source|array|snapshot|record/i);
  const hole=fixture();
  hole.returnItems.length=2;
  assert.throws(()=>audit(hole),/trusted|source|incomplete|array/i);
  let getterCalls=0;
  const guarded=fixture();
  Object.defineProperty(guarded.returnItems[0],'Purchase ID',{
    get(){getterCalls++;throw Error('EXPOSED-SECRET');}
  });
  assert.throws(()=>audit(guarded),/trusted|source|accessor|record/i);
  assert.equal(getterCalls,0);
  const json=JSON.stringify(audit(fixture()));
  assert.equal(json.includes('PO-1'),false);
  assert.equal(json.includes('PR-1'),false);
  assert.equal(json.includes('EXPOSED-SECRET'),false);
});
