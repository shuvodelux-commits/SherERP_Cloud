import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeGetSalesDraft} from './fixtures/m06-draft-detail-oracle.mjs';
import {projectSaleDraftDetail} from '../src/modules/sale-draft-detail.js';

const make=(id='D-1',extra={})=>({
  'Draft ID':id,'Draft No':'DRAFT-2026-001','Draft Date':'2026-11-15T10:30:00',
  'Created By ID':'STAFF-1','Created By Name':'Cashier',
  'Created At':'2026-11-14T11:30:00','Updated By ID':'STAFF-2',
  'Updated By Name':'Supervisor','Updated At':'2026-11-15T17:12:00',
  'Customer ID':'CUSTOMER-7','Customer Name':'Different Buyers Same Name',
  'Customer Phone':'01700000001','Customer Father Name':'Family Name',
  'Customer Relation Type':'Husband','Customer Address':'Rural Road',
  'Items JSON':JSON.stringify([{productId:'P-1',name:'Pipe',unit:'ft',qty:12,unitPrice:5,lineTotal:60}]),
  'Payment JSON':JSON.stringify({payments:[{method:'Cash',amount:30},{method:'Bank',amount:30,bankAccountId:'B-1'}]}),
  'Notes':'Call before delivery',Subtotal:60,Discount:0,'Grand Total':60,Version:3,
  ...extra
});
const owner={actorId:'STAFF-1',canAddPos:true,canViewPos:true,canEditSales:false};
const manager={actorId:'MANAGER-2',canAddPos:false,canViewPos:true,canEditSales:true};

function parity(id,rows,access) {
  const source=nativeGetSalesDraft(id,rows,access);
  let actual;
  try {
    actual={success:true,data:projectSaleDraftDetail(id,rows,access)};
  }catch(error){actual={success:false,message:error.message};}
  assert.deepEqual(actual,source);
  return actual;
}

test('source owner with pos.add and pos.view can open draft for editing',()=>{
  const out=parity('D-1',[make()],owner).data;
  assert.equal(out.mine,true);
  assert.equal(out.canManage,true);
  assert.equal(out.draftId,'D-1');
});
test('source manager with sales.edit and pos.view opens another owner draft even without pos.add',()=>{
  const out=parity('D-1',[make()],manager).data;
  assert.equal(out.mine,false);
  assert.equal(out.canManage,true);
});
test('sales.edit manager who owns draft gets mine true without pos.add',()=>{
  const out=parity('D-1',[make('D-1',{'Created By ID':'MANAGER-2'})],manager).data;
  assert.equal(out.mine,true);
});
test('different staff cannot load another owner draft with same customer ID and phone',()=>{
  const out=parity('D-1',[make()],{actorId:'STAFF-OTHER',canAddPos:true,canViewPos:true,canEditSales:false});
  assert.match(out.message,/permission to manage this draft/);
});
test('manager with sales.edit but without pos.view cannot load detail',()=>{
  const out=parity('D-1',[make()],{...manager,canViewPos:false});
  assert.match(out.message,/permission to view POS/);
});
test('owner with pos.add but without pos.view cannot load detail',()=>{
  const out=parity('D-1',[make()],{...owner,canViewPos:false});
  assert.match(out.message,/permission to view POS/);
});
test('feature access requires pos.add OR sales.edit, even when pos.view granted',()=>{
  const out=parity('D-1',[make()],{...owner,canAddPos:false,canEditSales:false});
  assert.match(out.message,/permission to access draft invoices/);
});
test('detail includes saved items, split payments and exact original customer ID',()=>{
  const out=parity('D-1',[make()],owner).data;
  assert.equal(out.items.length,1);
  assert.equal(out.items[0].productId,'P-1');
  assert.equal(out.payment.payments[1].bankAccountId,'B-1');
  assert.equal(out.customerId,'CUSTOMER-7');
  assert.equal(out.customerRelationType,'Husband');
  assert.equal(out.customerFatherName,'Family Name');
  assert.equal(out.notes,'Call before delivery');
});
test('invalid saved JSON falls back to [] and {} exactly as pinned original',()=>{
  const out=parity('D-1',[make('D-1',{'Items JSON':'[broken','Payment JSON':'{broken'})],owner).data;
  assert.deepEqual(out.items,[]);
  assert.deepEqual(out.payment,{});
});
test('legacy missing relation, fields, money and version retain source defaults',()=>{
  const out=parity('D-1',[make('D-1',{
    'Customer Relation Type':'', 'Customer Father Name':null,
    Subtotal:'',Discount:null,'Grand Total':undefined,Version:'',
    'Notes':undefined,'Draft Date':''
  })],owner).data;
  assert.equal(out.customerRelationType,'Father');
  assert.equal(out.customerFatherName,'');
  assert.equal(out.version,1);
  assert.equal(out.grandTotal,0);
  assert.equal(out.draftDate,'');
});
test('trimmed exact draft ID finds the source row without looking up by draft number',()=>{
  const out=parity('  D-1  ',[make()],owner).data;
  assert.equal(out.draftId,'D-1');
});
test('missing draft ID and blank selection match native Draft not found',()=>{
  for(const id of ['unknown','',null]) {
    const out=parity(id,[make()],owner);
    assert.match(out.message,/Draft not found/);
  }
});
test('same draft ID across two source rows is refused rather than picking first owner',()=>{
  const rows=[make(),make('D-1',{'Created By ID':'MANAGER-2',Version:99})];
  assert.throws(()=>projectSaleDraftDetail('D-1',rows,owner),/Duplicate draft ID/);
});
test('original JSON and draftRows are never mutated by viewing details',()=>{
  const rows=[make()],before=structuredClone(rows);
  parity('D-1',rows,owner);
  parity('D-1',rows,manager);
  assert.deepEqual(rows,before);
});
test('trusted actor, permission flags and prefiltered source rows are mandatory',()=>{
  assert.throws(()=>projectSaleDraftDetail('D-1',undefined,owner),/trusted/i);
  assert.throws(()=>projectSaleDraftDetail('D-1',[make()],{}),/trusted/i);
  assert.throws(()=>projectSaleDraftDetail('D-1',[make()],{...owner,actorId:''}),/trusted/i);
  assert.throws(()=>projectSaleDraftDetail('D-1',[make()],{...owner,canEditSales:'true'}),/trusted/i);
});
