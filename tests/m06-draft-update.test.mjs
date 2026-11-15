import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeUpdateSalesDraft} from './fixtures/m06-draft-update-oracle.mjs';
import {planSaleDraftUpdate} from '../src/modules/sale-draft-update-plan.js';

const timestamp='2026-11-15T15:05:00.000Z';
const bankAccounts=[
  {'Bank Account ID':'B-1','Account Name':'Bank One','Account Type':'Bank',Status:'Active','Is Deleted':'FALSE'}
];
const actor={
  actorId:'STAFF-A',actorName:'Cashier A',
  canAddPos:true,canViewPos:true,canEditSales:false,
  settings:{'POS Multi Payment Enabled':'true'},
  bankAccounts,updatedAt:timestamp
};
const manager={...actor,actorId:'MANAGER-X',actorName:'Manager X',canAddPos:false,canEditSales:true};
const item=(overrides={})=>({productId:'P-1',name:'Wire',unit:'ft',qty:4,unitPrice:30,lineTotal:120,...overrides});
const payload=(overrides={})=>({
  customerId:'CUSTOMER-VALID-ID',customerName:' New Buyer ',customerPhone:'01700000000',
  customerFatherName:'Old Family',customerRelationType:'Father',customerAddress:'Shop Road',
  items:[item()],subtotal:120,discount:5,grandTotal:115,
  payment:{amountReceived:'100',paymentMethod:'Cash',bankAccountId:''},
  notes:'bring warranty card',...overrides
});
const row=(overrides={})=>({
  'Draft ID':'SD-1','Draft No':'DRAFT-015',
  'Created By ID':'STAFF-A','Created By Name':'Cashier A',
  'Customer ID':'CUSTOMER-OLD-ID','Customer Name':'Existing Buyer',
  'Customer Relation Type':'Husband','Customer Phone':'01712345678',
  'Version':3,'Updated At':'2026-11-14T08:00:00Z',
  ...overrides
});
const clone=value=>JSON.parse(JSON.stringify(value));

function parity(id='SD-1',expected=3,incoming=payload(),rows=[row()],credentials=actor) {
  const native=nativeUpdateSalesDraft(id,expected,incoming,rows,credentials);
  let result;
  try { result={success:true,...planSaleDraftUpdate(id,expected,incoming,rows,credentials)}; }
  catch(error) { result={success:false,message:error.message,fields:null,audit:null}; }
  assert.deepEqual(clone(result),native);
  return result;
}

test('owner updates draft using pos.add and pos.view; preserves exact source reply',()=>{
  const r=parity();
  assert.equal(r.success,true);
  assert.deepEqual(r.reply,{draftId:'SD-1',draftNo:'DRAFT-015',version:4});
});
test('sales.edit manager with pos.view but no pos.add can update another owner draft',()=>{
  const r=parity('SD-1',3,payload(),[row()],manager);
  assert.equal(r.success,true);
  assert.equal(r.fields['Updated By ID'],'MANAGER-X');
});
test('manager with sales.edit and no pos.view cannot update a draft',()=>{
  const r=parity('SD-1',3,payload(),[row()],{...manager,canViewPos:false});
  assert.match(r.message,/permission to view POS/);
});
test('owner with pos.add but no pos.view cannot update a draft',()=>{
  const r=parity('SD-1',3,payload(),[row()],{...actor,canViewPos:false});
  assert.match(r.message,/permission to view POS/);
});
test('feature access is denied without pos.add OR sales.edit even if pos.view exists',()=>{
  const r=parity('SD-1',3,payload(),[row()],{...actor,canAddPos:false});
  assert.match(r.message,/permission to access draft invoices/);
});
test('another staff member is not the source owner despite matching customer ID and phone',()=>{
  const r=parity('SD-1',3,payload(),[row()],{...actor,actorId:'OTHER-STAFF'});
  assert.match(r.message,/permission to manage this draft/);
});
test('source Version comparison accepts same numeric value as string',()=>{
  const r=parity(' SD-1 ', '3',payload(),[row()],actor);
  assert.equal(r.reply.version,4);
  assert.equal(r.reply.draftId,'SD-1');
});
test('stale Version rejects without any planned update or audit',()=>{
  for(const expected of [2,4,null,'oops']){
    const r=parity('SD-1',expected,payload(),[row()],actor);
    assert.equal(r.success,false);
    assert.match(r.message,/draft was changed by another user/);
    assert.equal(r.fields,null);
    assert.equal(r.audit,null);
  }
});
test('source checks owner before stale Version, preserving permission error order',()=>{
  const r=parity('SD-1',1,payload(),[row()],{...actor,actorId:'OTHER'});
  assert.match(r.message,/permission to manage this draft/);
});
test('missing draft ID fails rather than matching Draft No or Customer ID',()=>{
  for(const id of ['UNKNOWN','DRAFT-015','']) {
    const r=parity(id,3,payload(),[row()],actor);
    assert.match(r.message,/Draft not found/);
  }
});
test('updates exactly source row fields and does not alter Created By fields',()=>{
  const r=parity();
  assert.deepEqual(Object.keys(r.fields),[
    'Customer ID','Customer Name','Customer Phone','Customer Father Name',
    'Customer Relation Type','Customer Address','Items JSON','Payment JSON',
    'Notes','Subtotal','Discount','Grand Total','Updated By ID',
    'Updated By Name','Updated At','Version'
  ]);
  assert.equal(r.fields['Customer ID'],'CUSTOMER-VALID-ID');
  assert.equal(r.fields['Customer Name'],'New Buyer');
  assert.equal(r.fields['Version'],4);
  assert.equal(r.fields['Updated At'],timestamp);
  assert.equal('Created By ID' in r.fields,false);
});
test('audit is UPDATED for correct owner and immutable old Draft No',()=>{
  const r=parity();
  assert.deepEqual(r.audit,{
    action:'UPDATED',draftId:'SD-1',draftNo:'DRAFT-015',
    version:4,actorId:'STAFF-A',actorName:'Cashier A',sourceOwnerId:'STAFF-A',
    invoiceId:'',note:'',timestamp
  });
});
test('omitted old customerRelationType preserves saved Husband instead of resetting Father',()=>{
  const incoming=payload();
  delete incoming.customerRelationType;
  const r=parity('SD-1',3,incoming,[row()],actor);
  assert.equal(r.fields['Customer Relation Type'],'Husband');
});
test('explicit blank customerRelationType resets to Father as native source does',()=>{
  const r=parity('SD-1',3,payload({customerRelationType:''}),[row()],actor);
  assert.equal(r.fields['Customer Relation Type'],'Father');
});
test('omitted relationship falls back to Father for older blank saved draft',()=>{
  const incoming=payload();delete incoming.customerRelationType;
  const r=parity('SD-1',3,incoming,[row({'Customer Relation Type':''})],actor);
  assert.equal(r.fields['Customer Relation Type'],'Father');
});
test('split-payment draft normalization returns exactly stored serialized payment rows',()=>{
  const p=payload({payment:{payments:[
    {id:'cash-1',method:'Cash',amount:'15.00',accountId:''},
    {id:'bank-1',method:'Bank',amount:'100.00',accountId:'B-1'}
  ]}});
  const r=parity('SD-1',3,p,[row()],actor);
  assert.equal(r.success,true);
  assert.deepEqual(JSON.parse(r.fields['Payment JSON']).payments.map(p=>p.id),['cash-1','bank-1']);
});
test('invalid split account and invalid saved quantity fail before a planned update',()=>{
  for(const invalid of [
    payload({payment:{payments:[{id:'bank',method:'Bank',amount:'115',accountId:'NOT-FOUND'}]}}),
    payload({items:[item({qty:0})]}),
    payload({items:[]})
  ]) {
    const r=parity('SD-1',3,invalid,[row()],actor);
    assert.equal(r.success,false);
    assert.equal(r.fields,null);
    assert.equal(r.audit,null);
  }
});
test('does not mutate trusted source rows, permissions, payload or bank snapshot',()=>{
  const rows=[row()],credentials=structuredClone(actor),incoming=payload();
  const before=clone({rows,credentials,incoming});
  parity('SD-1',3,incoming,rows,credentials);
  assert.deepEqual(clone({rows,credentials,incoming}),before);
});
test('duplicate active Draft IDs fail closed rather than source first-row access',()=>{
  const duplicate=[row(),row({'Created By ID':'OTHER','Version':99})];
  assert.throws(()=>planSaleDraftUpdate('SD-1',3,payload(),duplicate,actor),/Duplicate draft ID/);
});
test('rejects untrusted actor flags, bank data and invalid UTC clock before operation planning',()=>{
  assert.throws(()=>planSaleDraftUpdate('SD-1',3,payload(),[row()],{...actor,actorName:''}),/trusted/i);
  assert.throws(()=>planSaleDraftUpdate('SD-1',3,payload(),[row()],{...actor,canViewPos:'true'}),/trusted/i);
  assert.throws(()=>planSaleDraftUpdate('SD-1',3,payload(),[row()],{...actor,bankAccounts:undefined}),/trusted/i);
  assert.throws(()=>planSaleDraftUpdate('SD-1',3,payload(),[row()],{...actor,updatedAt:'2026-11-15'}),/trusted/i);
});
