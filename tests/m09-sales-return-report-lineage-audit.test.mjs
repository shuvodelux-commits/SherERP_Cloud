import test from 'node:test';
import assert from 'node:assert/strict';

const impl=await import('../src/modules/m09-sales-return-report-lineage-audit.js')
  .catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
function audit(snapshot){
  assert.equal(typeof impl?.auditM09SalesReturnLineage,'function',
    'M09 Sales Return report lineage audit not implemented');
  return impl.auditM09SalesReturnLineage(snapshot);
}
const sale=(id,deleted='')=>({
  'Invoice ID':id,'Date':'2026-11-15','Customer ID':'C-1','Is Deleted':deleted
});
const head=(id,invoice='INV-1',deleted='')=>({
  'Return ID':id,'Invoice ID':invoice,'Total Return Amount':50,'Is Deleted':deleted
});
const item=(id,invoice='INV-1',deleted='')=>({
  'Return ID':id,'Invoice ID':invoice,'Product ID':'P-1',
  'Return Quantity':1,'Line Total':50,'Is Deleted':deleted
});
const snapshot=()=>({
  allSales:[sale('INV-1'),sale('INV-2'),sale('OLD','TRUE')],
  returnHeaders:[head('RET-1')],
  returnItems:[item('RET-1')]
});

test('M09 original active return child lineage valid and safe but never authorizes reporting',()=>{
  const s=snapshot();
  s.returnHeaders.push(head('RET-2','INV-2'));
  s.returnItems.push(item('RET-2','INV-2'));
  const before=JSON.stringify(s);
  const r=audit(s);
  assert.deepEqual(r,{ready:false,lineageComplete:true,
    status:'SOURCE_LINEAGE_ONLY',issues:[]});
  assert.equal(JSON.stringify(s),before);
  assert.equal(Object.hasOwn(r,'totals'),false);
});

test('M09 mismatched child Invoice ID is a blocker, not silently charged to another invoice',()=>{
  const s=snapshot();
  s.returnItems[0]['Invoice ID']='INV-2';
  const r=audit(s);
  assert.deepEqual(r.issues,['MISMATCHED_RETURN_INVOICE']);
  assert.equal(r.lineageComplete,false);
  assert.equal(r.ready,false);
});

test('M09 active child lacking an active Return header is not accepted as complete source data',()=>{
  const s=snapshot();
  s.returnItems.push(item('RET-GHOST'));
  assert.deepEqual(audit(s).issues,['ORPHAN_ACTIVE_RETURN_ITEM']);
  assert.equal(audit(s).lineageComplete,false);
});

test('M09 missing/deleted source sale and duplicate active Return IDs fail closed',()=>{
  const missing=snapshot();
  missing.returnHeaders[0]['Invoice ID']='UNKNOWN';
  missing.returnItems[0]['Invoice ID']='UNKNOWN';
  assert.deepEqual(audit(missing).issues,['MISSING_ACTIVE_SALE_INVOICE']);
  const deleted=snapshot();
  deleted.returnHeaders[0]['Invoice ID']='OLD';
  deleted.returnItems[0]['Invoice ID']='OLD';
  assert.deepEqual(audit(deleted).issues,['MISSING_ACTIVE_SALE_INVOICE']);
  const duplicate=snapshot();
  duplicate.returnHeaders.push(head('RET-1'));
  assert.ok(audit(duplicate).issues.includes('DUPLICATE_ACTIVE_RETURN_ID'));
  assert.equal(audit(duplicate).ready,false);
});

test('M09 duplicate active invoice and empty active return are separately flagged',()=>{
  const duplicate=snapshot();
  duplicate.allSales.push(sale('INV-1'));
  assert.deepEqual(audit(duplicate).issues,['DUPLICATE_ACTIVE_SALE_INVOICE']);
  const empty=snapshot();
  empty.returnItems=[];
  assert.deepEqual(audit(empty).issues,['ACTIVE_RETURN_WITHOUT_ITEMS']);
});

test('M09 soft-deleted headers and children do not contribute active return economics',()=>{
  const s=snapshot();
  s.returnHeaders.push(head('RET-DELETED','INVALID-INVOICE','TRUE'));
  s.returnItems.push(item('RET-DELETED','WRONG-INVOICE'));
  s.returnItems.push(item('RET-1','INV-2','TRUE'));
  assert.deepEqual(audit(s).issues,[]);
  s.returnHeaders[0]['Is Deleted']='TRUE';
  assert.deepEqual(audit(s).issues,[]);
});

test('M09 IDs are source strings and missing source references need review',()=>{
  const invalid=snapshot();
  invalid.returnHeaders[0]['Return ID']=null;
  assert.ok(audit(invalid).issues.includes('INVALID_RETURN_ID'));
  const noInvoice=snapshot();
  noInvoice.allSales[0]['Invoice ID']='';
  assert.ok(audit(noInvoice).issues.includes('INVALID_SALE_INVOICE_ID'));
  const badChild=snapshot();
  badChild.returnItems[0]['Return ID']=0;
  assert.ok(audit(badChild).issues.includes('INVALID_CHILD_RETURN_ID'));
});

test('M09 rejects missing arrays and accessor-backed source rows without invoking getters',()=>{
  for(const obj of [undefined,null,[],{}, {allSales:[],returnItems:[]},
    {allSales:[],returnHeaders:[],returnItems:null}])
    assert.throws(()=>audit(obj),/trusted|source|snapshot|array|record/i);
  let calls=0;
  const s=snapshot();
  Object.defineProperty(s.returnItems[0],'Invoice ID',{
    get(){calls++;throw new Error('TOKEN-SECRET');}
  });
  assert.throws(()=>audit(s),/trusted|source|accessor|record/i);
  assert.equal(calls,0);
  assert.equal(JSON.stringify(audit(snapshot())).includes('INV-1'),false);
  assert.equal(JSON.stringify(audit(snapshot())).includes('RET-1'),false);
});
