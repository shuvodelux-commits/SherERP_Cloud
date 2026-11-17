import test from 'node:test';
import assert from 'node:assert/strict';
// RED: missing M07-owned, read-only Purchase Return correction source-evidence adapter.
import {reviewHistoricalPurchaseReturnCorrection}
 from '../src/modules/m07-purchase-return-correction-evidence.js';

function source(method='Cash'){
 const header={'Return ID':'PRET-1','Purchase ID':'PUR-1','Supplier ID':'SUP-A',
  'Refund Method':method,'Total Return Amount':125,
  'Is Deleted':'FALSE',_rowIndex:4};
 return {
  tenantId:'SHOP-A',purchaseId:'PUR-1',returnId:'PRET-1',
  sourceHash:'a'.repeat(64),returnHeader:header,
  returnItems:[
   {'Return ID':'PRET-1','Purchase ID':'PUR-1','Product ID':'PIPE',
    'Return Quantity':5,'Line Total':75,'Return Price':15,'Is Deleted':'FALSE',_rowIndex:9},
   {'Return ID':'PRET-1','Purchase ID':'PUR-1','Product ID':'SWITCH',
    'Return Quantity':2,'Line Total':50,'Return Price':25,'Is Deleted':'FALSE',_rowIndex:10}
  ],
  stockMovements:[
   {'Movement ID':'MOVE-1',Type:'Purchase Return',Reference:'PRET-1',
    'Product ID':'PIPE','Lot ID':'LOT-A','Quantity Out':3,'Quantity In':'',_rowIndex:12},
   {'Movement ID':'MOVE-2',Type:'Purchase Return',Reference:'PRET-1',
    'Product ID':'PIPE','Lot ID':'LOT-C','Quantity Out':2,'Quantity In':'',_rowIndex:13},
   {'Movement ID':'MOVE-3',Type:'Purchase Return',Reference:'PRET-1',
    'Product ID':'SWITCH','Lot ID':'LOT-B','Quantity Out':2,'Quantity In':'',_rowIndex:14}
  ],
  purchaseLots:[
   {'Lot ID':'LOT-A','Purchase ID':'PUR-1','Product ID':'PIPE','Supplier ID':'SUP-A',
    'Original Quantity':10,'Remaining Quantity':4,_rowIndex:50},
   {'Lot ID':'LOT-C','Purchase ID':'PUR-1','Product ID':'PIPE','Supplier ID':'SUP-A',
    'Original Quantity':6,'Remaining Quantity':2,_rowIndex:51},
   {'Lot ID':'LOT-B','Purchase ID':'PUR-1','Product ID':'SWITCH','Supplier ID':'SUP-A',
    'Original Quantity':12,'Remaining Quantity':8,_rowIndex:52},
   {'Lot ID':'FOREIGN','Purchase ID':'PUR-OTHER','Product ID':'PIPE','Supplier ID':'SUP-X',
    'Original Quantity':100,'Remaining Quantity':100,_rowIndex:53}
  ],
  cashBook:method==='Cash'?
   [{'Reference':'PRET-1','Type':'Purchase Return','Credit':125,'Debit':'',
     'Is Deleted':'FALSE',_rowIndex:31}]:[],
  supplierLedger:method==='Supplier Credit'?
   [{'Reference':'PRET-1','Type':'Purchase Return Credit','Supplier ID':'SUP-A',
     Credit:125,Debit:'','Is Deleted':'FALSE',_rowIndex:32}]:[]
 };
}
const intent=(patch={})=>({
 tenantId:'SHOP-A',purchaseId:'PUR-1',returnId:'PRET-1',
 correctionId:'PUR-RETURN-CANCEL-001',expectedSourceHash:'a'.repeat(64),
 reason:'Correct erroneous supplier return',mode:'Delete',...patch
});
const plan=(s=source(),i=intent())=>reviewHistoricalPurchaseReturnCorrection(s,i);

test('Cash return original source lines, exact return movements and original lots produce immutable, read-only lineage',()=>{
 const s=source(),i=intent(),before=structuredClone({s,i});
 const result=plan(s,i);
 assert.deepEqual(result,{
  status:'PLAN_ONLY',data:{
   tenantId:'SHOP-A',purchaseId:'PUR-1',returnId:'PRET-1',
   correctionId:'PUR-RETURN-CANCEL-001',sourceHash:'a'.repeat(64),
   originalReturnRowIndex:4,
   originalBaseQty:7,
   restoreOriginalLots:[
    {productId:'PIPE',lotId:'LOT-A',sourceRowIndex:50,baseQty:3,remainingAfterRestore:7},
    {productId:'PIPE',lotId:'LOT-C',sourceRowIndex:51,baseQty:2,remainingAfterRestore:4},
    {productId:'SWITCH',lotId:'LOT-B',sourceRowIndex:52,baseQty:2,remainingAfterRestore:10}
   ],
   stockMovementRowIndices:[12,13,14],
   returnItemRowIndices:[9,10],
   financialEvidence:{kind:'Cash',sourceRowIndex:31},
   nativeMutationAvailable:false,readOnly:true,commitAuthorized:false,
   financialCalculationAuthorized:false,replayResolved:false,accountingReconciled:false
  }
 });
 assert.deepEqual({s,i},before);
});

test('Supplier Credit requires original Supplier ID and only the original credit ledger',()=>{
 const r=plan(source('Supplier Credit'));
 assert.equal(r.status,'PLAN_ONLY');
 assert.deepEqual(r.data.financialEvidence,{kind:'Supplier Credit',sourceRowIndex:32});
 assert.equal(r.data.accountingReconciled,false);
});

test('native Purchase Return edit is unsupported: decline, do not silently replace the absent original handler',()=>{
 assert.deepEqual(plan(source(),intent({mode:'Edit'})),{
  status:'DECLINED',reason:'NATIVE_PURCHASE_RETURN_EDIT_UNSUPPORTED'
 });
});

test('financial source must match exact saved header line totals; never infer current-price refunds',()=>{
 for(const mutate of [
  s=>{s.returnItems[0]['Line Total']=75.01;},
  s=>{s.returnHeader['Total Return Amount']=124;},
  s=>{s.returnItems[0]['Line Total']=-1;},
  s=>{s.returnItems[1]['Line Total']=Number.NaN;},
  s=>{s.returnHeader['Refund Method']='Bank Transfer';}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|money|refund|source/i);
 }
 const copy=source();copy.returnItems[0]['Return Price']=999999;
 assert.deepEqual(plan(copy),plan(source()));
});

test('reversal movements are source-linked, not reconstructed from current FIFO or unrelated Purchase lots',()=>{
 for(const mutate of [
  s=>{s.stockMovements[0].Reference='OTHER';},
  s=>{s.stockMovements[0].Type='Sale Return';},
  s=>{s.stockMovements[0]['Lot ID']='FOREIGN';},
  s=>{s.stockMovements[0]['Lot ID']='UNKNOWN';},
  s=>{s.stockMovements[0]['Product ID']='SWITCH';},
  s=>{s.stockMovements[0]['Quantity In']=1;},
  s=>{s.stockMovements[0]['Quantity Out']=0;},
  s=>{s.stockMovements[1]['Quantity Out']=3;},
  s=>{s.stockMovements.pop();}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|source|stock|movement|lot/i);
 }
});

test('original lot ownership, uniqueness, safe quantity and restore capacity must reconcile',()=>{
 for(const mutate of [
  s=>{s.purchaseLots[0]['Purchase ID']='OTHER';},
  s=>{s.purchaseLots[0]['Supplier ID']='SUP-OTHER';},
  s=>{s.purchaseLots[1]['Product ID']='SWITCH';},
  s=>{s.purchaseLots[1]['Lot ID']='LOT-A';},
  s=>{s.purchaseLots[1]._rowIndex=50;},
  s=>{s.purchaseLots[0]['Remaining Quantity']=8;},
  s=>{s.purchaseLots[0]['Original Quantity']=1;},
  s=>{s.purchaseLots[0]['Remaining Quantity']=-1;},
  s=>{s.purchaseLots[0]['Original Quantity']=2.5;},
  s=>{s.purchaseLots[0]['Remaining Quantity']=Number.MAX_SAFE_INTEGER;}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|lot|source|quantity|stock/i);
 }
});

test('duplicates and missing original Return item or movement identity decline, never partial-plan',()=>{
 for(const mutate of [
  s=>{s.returnItems.push(structuredClone(s.returnItems[0]));},
  s=>{s.returnItems[0]['Product ID']='SWITCH';},
  s=>{s.returnItems[1]['Purchase ID']='OTHER';},
  s=>{s.returnItems[0]._rowIndex=10;},
  s=>{s.stockMovements[1]['Movement ID']='MOVE-1';},
  s=>{s.stockMovements[1]._rowIndex=12;},
  s=>{s.returnItems=[];},
  s=>{s.stockMovements=[];}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|duplicate|source|return|movement/i);
 }
});

test('Cash original proof requires exactly one real credit entry and excludes Supplier Credit',()=>{
 for(const mutate of [
  s=>{s.cashBook=[];},
  s=>{s.cashBook[0].Credit=124;},
  s=>{s.cashBook[0].Debit=1;},
  s=>{s.cashBook[0].Type='Cash Sale';},
  s=>{s.cashBook[0]['Is Deleted']='TRUE';},
  s=>{s.cashBook.push(structuredClone(s.cashBook[0]));},
  s=>{s.supplierLedger=[source('Supplier Credit').supplierLedger[0]];}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|cash|credit|finance|source/i);
 }
});

test('Supplier Credit proof cannot borrow another supplier ledger or coexist with Cash refund',()=>{
 for(const mutate of [
  s=>{s.supplierLedger=[];},
  s=>{s.supplierLedger[0].Credit=124;},
  s=>{s.supplierLedger[0].Debit=1;},
  s=>{s.supplierLedger[0]['Supplier ID']='SUP-B';},
  s=>{s.supplierLedger[0].Type='Purchase';},
  s=>{s.cashBook=[source().cashBook[0]];},
  s=>{s.supplierLedger.push(structuredClone(s.supplierLedger[0]));}
 ]){
  const s=source('Supplier Credit');mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|supplier|credit|finance|source/i);
 }
});

test('return already deleted or bearing correction marker never claims new cancellation',()=>{
 for(const mutate of [
  s=>{s.returnHeader['Is Deleted']='TrUe';},
  s=>{s.returnHeader['Reversal Operation ID']='REV-OLD';},
  s=>{s.returnHeader['Correction State']='Committed';},
  s=>{s.returnItems[0]['Is Deleted']='TRUE';},
  s=>{s.purchaseLots[0]['Is Deleted']='TRUE';}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/NEEDS_REVIEW|already|reversal|deleted|corrected|source/i);
 }
});

test('invalid tenant, Purchase, Return, source marker or correction ID cannot select a source',()=>{
 for(const i of [
  intent({tenantId:'SHOP-B'}),
  intent({purchaseId:'PUR-B'}),
  intent({returnId:'PRET-OTHER'}),
  intent({expectedSourceHash:'b'.repeat(64)}),
  intent({correctionId:'x'}),
  intent({reason:'  '})
 ])assert.throws(()=>plan(source(),i),/invalid|NEEDS_REVIEW|source|identity/i);
 for(const mutate of [
  s=>{s.returnHeader['Return ID']='PRET-OTHER';},
  s=>{s.returnHeader['Purchase ID']='PUR-OTHER';},
  s=>{s.returnHeader['Supplier ID']='SUP-B';},
  s=>{s.sourceHash='g'.repeat(64);}
 ]){
  const s=source();mutate(s);
  assert.throws(()=>plan(s),/invalid|NEEDS_REVIEW|source|identity/i);
 }
});

test('untrusted caller amount, lot, factor, auth, SQL or status cannot be added to intent',()=>{
 for(const extra of [
  {refundPaisa:12500},{lotId:'LOT-A'},{unitFactor:20},
  {actorId:'ADMIN'},{permission:'purchase.delete'},{sql:'DELETE FROM lots'},
  {commitAuthorized:true},{replayResolved:true}
 ])assert.throws(()=>plan(source(),{...intent(),...extra}),/invalid|shape|untrusted/i);
});

test('nonplain/accessor-bearing nested source and sparse arrays reject before invoking getters',()=>{
 for(const modify of [
  s=>Object.defineProperty(s.purchaseLots[0],'Original Quantity',{enumerable:true,get(){throw Error('ACCESSOR_EXECUTED')}}),
  s=>Object.defineProperty(s.stockMovements[0],'Quantity Out',{enumerable:true,get(){throw Error('ACCESSOR_EXECUTED')}}),
  s=>Object.defineProperty(s.returnItems[0],'Line Total',{enumerable:true,get(){throw Error('ACCESSOR_EXECUTED')}}),
  s=>{s.returnItems=[s.returnItems[0],,s.returnItems[1]];}
 ]){
  const s=source();modify(s);
  assert.throws(()=>plan(s),e=>e.message!=='ACCESSOR_EXECUTED'&&/invalid|NEEDS_REVIEW|source|accessor/i.test(e.message));
 }
});

test('all proposed references are immutable, with no financial posting or replay authority',()=>{
 const r=plan();
 assert.equal(r.status,'PLAN_ONLY');
 for(const x of [r,r.data,r.data.restoreOriginalLots,r.data.restoreOriginalLots[0],
  r.data.stockMovementRowIndices,r.data.financialEvidence])
  assert.ok(Object.isFrozen(x));
 const encoded=JSON.stringify(r);
 for(const forbidden of ['refundPaisa','cashSessionId','bankBook','supplierDue',
  'sourceSql','unitPrice','Purchase Price','unitCost'])
  assert.equal(encoded.includes('"'+forbidden+'"'),false);
 assert.equal(r.data.commitAuthorized,false);
 assert.equal(r.data.replayResolved,false);
 assert.equal(r.data.nativeMutationAvailable,false);
});
