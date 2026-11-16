import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {planSalesReturnCorrectionEvidence} from '../src/modules/sale-return-correction-evidence.js';

// All fixtures are synthetic and source-shaped; financial posting requires
// separate authenticated, real D1 integration and remains blocked.
const copy=value=>structuredClone(value);
function fixture(method='Cash'){
  const amount=75;
  const returnId='RET-000001',customerId='CUS-1',invoiceId='INV-1';
  return {
    returnHeaders:[{'Return ID':returnId,'Invoice ID':invoiceId,'Refund Method':method,
      'Total Return Amount':amount,'Customer ID':customerId,'Edit Version':2,
      'Date':'2026-01-17','Created At':'2026-01-17T10:00:00','Is Deleted':''}],
    sales:[{'Invoice ID':invoiceId,'Customer ID':customerId,'Is Deleted':''}],
    returnItems:[{'Return ID':returnId,'Product ID':'PIPE','Return Quantity':1,'Is Deleted':''}],
    cashBook:[{'Reference':returnId,'Type':'Sales Return','Debit':75,'Credit':'',
      '_rowIndex':4,'Is Deleted':''}],
    customerLedger:[{'Reference':returnId,'Type':'Sales Return Credit','Customer ID':customerId,
      'Credit':75,'_rowIndex':5,'Is Deleted':''}],
    customers:[{'Customer ID':customerId,'Current Due':125,'_rowIndex':6,'Is Deleted':''}],
    cashSessions:[],
    historicalSession:null
  };
}
const args=(mode='Delete',payload={reason:'Product damaged',expectedVersion:2})=>({
  mode,returnId:'RET-000001',payload,activeCashSessionOpen:true
});
function plan(s,options=args()){return planSalesReturnCorrectionEvidence(s,options);}
function fail(s,options,pattern){assert.throws(()=>plan(s,options),pattern);}

// Execute the actual frozen GAS rejection contract with mocked Sheets perimeter
// for *early* preconditions only. A successful native planner proceeds to
// stock mutation planning and cannot be simulated by this evidence test.
function nativeFailure(s,options){
  const source=readFileSync(new URL('../legacy/source/SalesReturn.gs',import.meta.url),'utf8');
  const deleted=row=>row?.['Is Deleted']===true||
    String(row?.['Is Deleted']||'').toUpperCase()==='TRUE';
  const groups={
    SALES_RETURN:s.returnHeaders,SALES:s.sales,SALES_RETURN_ITEMS:s.returnItems,
    CASH_BOOK:s.cashBook,CUSTOMER_LEDGER:s.customerLedger,
    CUSTOMERS:s.customers,CASH_SESSIONS:s.cashSessions
  };
  const state={
    getAllRows_(key){return groups[key]??[];},
    activeRows_(key){return (groups[key]??[]).filter(row=>!deleted(row));},
    activeSalesReturnItems_(){return s.returnItems.filter(row=>!deleted(row));},
    isDeleted_:deleted,
    sanitizeInput_:value=>String(value??'').trim(),
    safeDateOnly_:value=>String(value??'').slice(0,10),
    roundMoney_:value=>Math.round((Number(value)+Number.EPSILON)*100)/100,
    requireActiveCashSession_(){
      if(options.activeCashSessionOpen!==true)throw Error('An active Cash Session is required.');
    },
    requirePermission_:()=>({'User ID':'TEST'}),
    requireDeletePermission_:()=>({'User ID':'TEST'}),
    findSessionForTimestamp_:()=>s.historicalSession,
    findUniqueSalesRow_(id){
      const matches=s.sales.filter(row=>String(row['Invoice ID'])===id);
      if(matches.length>1)throw Error('Duplicate invoice ID detected: '+id+
        '. This invoice must be repaired before View, Update, Delete or Return actions can continue.');
      return matches[0]??null;
    }
  };
  runInNewContext(source,state,{filename:'SalesReturn.gs',timeout:1000});
  try{state.prepareSalesReturnChange_('TEST',options.returnId,options.payload,options.mode);}
  catch(error){return String(error.message);}
  throw Error('Test case must be an early native rejection');
}

test('Cash Delete preflight preserves original return/invoice and cash debit source references; no writes',()=>{
  const s=fixture(),original=copy(s);
  const p=plan(s);
  assert.deepEqual(p,{
    returnId:'RET-000001',invoiceId:'INV-1',customerId:'CUS-1',
    mode:'Delete',expectedVersion:2,refundMethod:'Cash',oldAmount:75,
    batchId:'',originalItemCount:1,needsStockChange:true,
    moneyUndo:{kind:'Cash',rowIndex:4,amount:75}
  });
  assert.ok(Object.isFrozen(p));assert.ok(Object.isFrozen(p.moneyUndo));
  assert.deepEqual(s,original);
});

test('Store Credit Edit preflight preserves exactly the original customer account and signed-amount evidence',()=>{
  const s=fixture('Store Credit'),original=copy(s);
  const p=plan(s,args('Edit',{editReason:'Correct quantity',expectedVersion:2,
    refundMethod:'Store Credit',items:[{productId:'PIPE',qty:1}]}));
  assert.equal(p.moneyUndo.kind,'Store Credit');
  assert.deepEqual(p.moneyUndo,{kind:'Store Credit',rowIndex:5,amount:75,customerId:'CUS-1'});
  assert.equal(p.needsStockChange,false);
  assert.equal(p.originalItemCount,1);
  assert.deepEqual(s,original);
});

test('Edit with changed quantity requires separate stock reversal planning, not a guessed lot',()=>{
  const s=fixture();
  const p=plan(s,args('Edit',{editReason:'Correct quantity',expectedVersion:2,
    refundMethod:'Cash',items:[{productId:'PIPE',qty:2}]}));
  assert.equal(p.needsStockChange,true);
  assert.equal('stockChanges' in p,false);
});

test('duplicate, missing, or deleted historical Return ID fail closed',()=>{
  const s=fixture();
  s.returnHeaders.push(copy(s.returnHeaders[0]));
  fail(s,args(),/Duplicate Sales Return ID\. Needs Review/);
  s.returnHeaders.pop();
  s.returnHeaders[0]['Is Deleted']='TrUe';
  fail(s,args(),/Sales Return was deleted/);
  s.returnHeaders=[];
  fail(s,args(),/Sales Return not found/);
});

test('duplicate, deleted or missing invoice and empty active return item evidence fail closed',()=>{
  const s=fixture();
  s.sales.push(copy(s.sales[0]));
  fail(s,args(),/Duplicate invoice ID detected/);
  s.sales.pop();
  s.sales[0]['Is Deleted']=true;
  fail(s,args(),/Source invoice is missing or deleted/);
  s.sales=[];
  fail(s,args(),/Source invoice is missing or deleted/);
  s.sales=fixture().sales;
  s.returnItems[0]['Is Deleted']='TRUE';
  fail(s,args(),/no active product lines/);
});

test('Cash correction needs one active matching refund debit with zero credit',()=>{
  const s=fixture();
  for(const altered of [
    [],[...s.cashBook,s.cashBook[0]],
    [{...s.cashBook[0],Debit:74.98}],
    [{...s.cashBook[0],Credit:0.01}],
    [{...s.cashBook[0],'Is Deleted':'TRUE'}]
  ]){
    const invalid={...s,cashBook:altered};
    fail(invalid,args(),/Cash refund evidence is missing or inconsistent/);
  }
});

test('Store Credit correction requires one matching original Customer ledger credit',()=>{
  const s=fixture('Store Credit');
  for(const change of [
    {customerLedger:[]},
    {customerLedger:[...s.customerLedger,s.customerLedger[0]]},
    {customerLedger:[{...s.customerLedger[0],Credit:74}]},
    {customerLedger:[{...s.customerLedger[0],'Customer ID':'CUS-2'}]},
    {returnHeaders:[{...s.returnHeaders[0],'Customer ID':''}]},
    {customers:[]},
    {customers:[...s.customers,s.customers[0]]}
  ]){
    const invalid={...s,...change};
    fail(invalid,args(),/evidence|attribution|customer|ambiguous/i);
  }
});

test('Store Credit correction blocks later dependent activity on the same customer, not other customers',()=>{
  const s=fixture('Store Credit');
  s.customerLedger.push({'Reference':'PAY-2','Type':'Customer Payment','Customer ID':'CUS-1',
    'Credit':10,'_rowIndex':6,'Is Deleted':''});
  fail(s,args(),/Later customer settlement\/ledger entries exist/);
  s.customerLedger[1]['Customer ID']='CUS-2';
  assert.equal(plan(s).moneyUndo.customerId,'CUS-1');
});

test('stale version, missing explanation, invalid immutable operation ID and unsupported mode fail',()=>{
  const s=fixture();
  fail(s,args('Delete',{reason:'Fix',expectedVersion:1}),/changed since it was opened/);
  fail(s,args('Delete',{reason:'  ',expectedVersion:2}),/Delete reason is required/);
  fail(s,args('Delete',{reason:'Fix',operationId:'unsafe!'}),/immutable return correction operation ID/);
  fail(s,args('Update',{reason:'Fix'}),/Unsupported return correction operation/);
});

test('current and historical Cash Session evidence both fail closed when unavailable',()=>{
  const s=fixture();
  fail(s,{...args(),activeCashSessionOpen:false},/active Cash Session/i);
  s.cashSessions=[{'Session ID':'CS-1','Status':'Open'}];
  fail(s,args(),/Original return Cash Session is closed/);
  s.historicalSession={'Status':'Closed'};
  fail(s,args(),/Original return Cash Session is closed/);
  s.historicalSession={'Status':'Open'};
  assert.equal(plan(s).returnId,'RET-000001');
});

test('batch child Edit cannot diverge from sibling refund method; Delete leaves sibling alone',()=>{
  const s=fixture();
  s.returnHeaders[0]['Batch ID']='SRB-1';
  s.returnHeaders.push({'Return ID':'RET-SIB','Invoice ID':'INV-2','Customer ID':'CUS-1',
    'Batch ID':'SRB-1','Refund Method':'Cash','Is Deleted':''});
  const request=args('Edit',{editReason:'Fix',expectedVersion:2,refundMethod:'Store Credit',
    items:[{productId:'PIPE',qty:1}]});
  fail(s,request,/Mixed-method Sales Return batch is not supported/);
  assert.equal(plan(s).mode,'Delete');
});

test('source parity: native early preflight rejection messages match across critical Cash and Store Credit paths',()=>{
  const samples=[];
  {const s=fixture();s.returnHeaders.push(copy(s.returnHeaders[0]));samples.push([s,args()]);}
  {const s=fixture();s.returnHeaders[0]['Is Deleted']='TRUE';samples.push([s,args()]);}
  {const s=fixture();s.returnItems=[];samples.push([s,args()]);}
  {const s=fixture();s.cashBook=[];samples.push([s,args()]);}
  {const s=fixture('Store Credit');s.customerLedger[0]['Customer ID']='WRONG';samples.push([s,args()]);}
  {const s=fixture('Store Credit');s.customerLedger.push({
    'Reference':'PAY-2','Type':'Customer Payment','Customer ID':'CUS-1',
    '_rowIndex':8,'Is Deleted':''});samples.push([s,args()]);}
  {const s=fixture();s.cashSessions=[{'Status':'Open'}];samples.push([s,args()]);}
  {const s=fixture();samples.push([s,args('Delete',{reason:' ',expectedVersion:2})]);}
  {const s=fixture();samples.push([s,args('Delete',{reason:'Fix',expectedVersion:3})]);}
  for(const [s,options] of samples){
    const expected=nativeFailure(s,options);
    assert.throws(()=>plan(s,options),error=>{
      assert.equal(error.message,expected);
      return true;
    });
  }
});
