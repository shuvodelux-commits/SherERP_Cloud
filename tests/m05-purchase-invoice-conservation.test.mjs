import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditPurchaseInvoiceConservation} from '../src/modules/m05-purchase-invoice-conservation.js';

const purchase=(extra={})=>({
  'Purchase ID':'PUR-1','Supplier ID':'SUP-1',
  'Subtotal':110,'Discount':10,'Grand Total':100,
  'Paid Amount':40,'Due Amount':60,'Payment Status':'Partial',
  'Is Deleted':'', ...extra
});
const item=(productId,quantity,price,extra={})=>({
  'Purchase ID':'PUR-1','Product ID':productId,'Quantity':quantity,
  'Unit Price':price,'Line Total':quantity*price,...extra
});
const lines=()=>[item('P-A',2,25),item('P-B',3,20)];
const run=(purchases=[purchase()],purchaseItems=lines())=>
  auditPurchaseInvoiceConservation({purchases,purchaseItems});
const codes=(result)=>result.issues.map(issue=>issue.code);

test('original purchase create and native update source arithmetic are pinned',()=>{
  const root=new URL('../legacy/source/',import.meta.url);
  const create=readFileSync(new URL('Purchase.gs',root),'utf8');
  const update=readFileSync(new URL('PurchaseManagement.gs',root),'utf8');
  for(const source of [create,update]){
    assert.match(source,/subtotal\s*\+=\s*qty\s*\*\s*price/);
    assert.match(source,/Math\.max\(0,\s*subtotal\s*-\s*discount\)/);
    assert.match(source,/dueAmount\s*=\s*grandTotal\s*-\s*paidAmount/);
    assert.match(source,/dueAmount\s*<=\s*0\s*\?\s*'Paid'/);
    assert.match(source,/'Line Total'\s*:\s*(?:line\.)?qty\s*\*\s*(?:line\.)?price/);
  }
});

test('a valid multi-line partial purchase reconciles without mutating snapshots',()=>{
  const purchases=[purchase()],purchaseItems=lines();
  const original=structuredClone({purchases,purchaseItems});
  const result=run(purchases,purchaseItems);
  assert.deepEqual(result,{ready:true,issues:[],summary:{
    purchases:1,items:2,activePurchases:1,deletedPurchases:0,
    amountTolerance:0.004
  }});
  assert.deepEqual({purchases,purchaseItems},original);
});

test('unpaid, fully paid and zero-price purchases retain source status semantics',()=>{
  const p0=purchase({'Purchase ID':'PUR-0','Subtotal':0,'Discount':0,
    'Grand Total':0,'Paid Amount':0,'Due Amount':0,'Payment Status':'Paid'});
  const p2=purchase({'Purchase ID':'PUR-2','Subtotal':50,'Discount':0,
    'Grand Total':50,'Paid Amount':0,'Due Amount':50,'Payment Status':'Due'});
  const p3=purchase({'Purchase ID':'PUR-3','Subtotal':60,'Discount':0,
    'Grand Total':60,'Paid Amount':60,'Due Amount':0,'Payment Status':'Paid'});
  const result=run([p0,p2,p3],[
    item('P-Z',1,0,{'Purchase ID':'PUR-0'}),
    item('P-Q',2,25,{'Purchase ID':'PUR-2'}),
    item('P-R',3,20,{'Purchase ID':'PUR-3'})
  ]);
  assert.equal(result.ready,true);
  assert.deepEqual(result.issues,[]);
});

test('discount above subtotal is not a negative invoice: original source clamps grand to zero',()=>{
  const p=purchase({'Subtotal':50,'Discount':75,'Grand Total':0,
    'Paid Amount':0,'Due Amount':0,'Payment Status':'Paid'});
  assert.equal(run([p],[item('P-A',2,25)]).ready,true);
});

test('line totals, stored subtotal, discount grand and paid/due/status drifts are independently flagged',()=>{
  const p=purchase({'Subtotal':111,'Discount':10,'Grand Total':99,
    'Paid Amount':40,'Due Amount':60,'Payment Status':'Paid'});
  const result=run([p],[...lines().slice(0,1),item('P-B',3,20,{'Line Total':59})]);
  for(const code of ['LINE_TOTAL_MISMATCH','SUBTOTAL_MISMATCH',
    'GRAND_TOTAL_MISMATCH','PAID_DUE_MISMATCH','PAYMENT_STATUS_MISMATCH']){
    assert.ok(codes(result).includes(code),code);
  }
  assert.equal(result.ready,false);
});

test('changes below a paisa tolerance are accepted; one-paisa drift is not',()=>{
  const p=purchase({'Subtotal':110.003});
  const good=run([p],[...lines().slice(0,1),item('P-B',3,20,{'Line Total':60.003})]);
  assert.equal(good.ready,true);
  const bad=run([purchase({'Due Amount':60.01})]);
  assert.ok(codes(bad).includes('PAID_DUE_MISMATCH'));
});

test('duplicate purchase IDs never guess which header is financially authoritative',()=>{
  const result=run([purchase(),purchase({'Grand Total':999})]);
  assert.equal(result.ready,false);
  assert.ok(codes(result).includes('DUPLICATE_PURCHASE_ID'));
});

test('orphan purchase items, duplicate product lines and absent items require manual review',()=>{
  const duplicate=run([purchase()],[...lines(),item('P-A',1,5)]);
  assert.ok(codes(duplicate).includes('DUPLICATE_PRODUCT_LINE'));
  const orphan=run([purchase()],[...lines(),item('P-C',1,10,{'Purchase ID':'MISSING'})]);
  assert.ok(codes(orphan).includes('ORPHAN_PURCHASE_ITEM'));
  const noItems=run([purchase()],[]);
  assert.ok(codes(noItems).includes('MISSING_PURCHASE_ITEMS'));
});

test('soft-deleted purchase headers remain historical financial evidence',()=>{
  const result=run([purchase({'Is Deleted':'TRUE'})]);
  assert.equal(result.ready,true);
  assert.equal(result.summary.deletedPurchases,1);
  assert.equal(result.summary.activePurchases,0);
});

test('invalid amounts, quantities and missing source identities never pass a migration audit',()=>{
  const invalidHeader=run([purchase({'Due Amount':Infinity})]);
  assert.ok(codes(invalidHeader).includes('INVALID_PURCHASE_AMOUNT'));
  const invalidLine=run([purchase()],[item('P-A',-2,25),item('P-B',3,20)]);
  assert.ok(codes(invalidLine).includes('INVALID_PURCHASE_ITEM'));
  const missingProduct=run([purchase()],[item('',2,25),item('P-B',3,20)]);
  assert.ok(codes(missingProduct).includes('INVALID_PURCHASE_ITEM'));
  const missingPurchase=run([purchase({'Purchase ID':''})]);
  assert.ok(codes(missingPurchase).includes('INVALID_PURCHASE_ID'));
  const blankMoney=run([purchase({'Paid Amount':''})]);
  assert.ok(codes(blankMoney).includes('INVALID_PURCHASE_AMOUNT'));
});

test('explicit, plain snapshots required and empty source cannot report a successful migration',()=>{
  assert.throws(()=>auditPurchaseInvoiceConservation(),/snapshot|purchases/i);
  assert.throws(()=>auditPurchaseInvoiceConservation({purchases:null,purchaseItems:[]}),/snapshot|purchases/i);
  assert.throws(()=>auditPurchaseInvoiceConservation({purchases:[],purchaseItems:null}),/snapshot|item/i);
  const bad=purchase();
  Object.defineProperty(bad,'Subtotal',{get(){throw new Error('must not execute getter');}});
  assert.throws(()=>run([bad]),/accessor|snapshot/i);
  assert.equal(run([],[]).ready,false);
  assert.ok(codes(run([],[])).includes('EMPTY_PURCHASE_SNAPSHOT'));
});

test('audit is read-only and cannot be called directly as a Worker RPC or D1 writer',()=>{
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker+rpc,/auditPurchaseInvoiceConservation|m05-purchase-invoice-conservation/);
  const result=run();
  assert.equal('sql' in result,false);
  assert.equal('operationId' in result,false);
});
