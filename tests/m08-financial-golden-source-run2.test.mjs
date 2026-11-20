/**
 * M08 Run 2: executable source-oracle golden cases G09-G12/G16-G17.
 * Functions below are the exact verified Mohim GAS bodies under synthetic
 * stubs. No operational accounting implementation or D1 schema is imported.
 * See docs/reviews/2026-11-20-m02-m08-run1-policy-golden-cases.md.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const own=x=>JSON.parse(JSON.stringify(x));
function supplierHarness({canDiscount=true,sessionOpen=true}={}) {
  const state={
    canDiscount,sessionOpen,permissions:[],cash:[],bank:[],errors:[],
    suppliers:[{'Supplier ID':'SUP-1','Supplier Name':'Fixture Supplier',
      'Current Due':100,'Opening Balance':0,Status:'Active',_rowIndex:2}],
    ledger:[]
  };
  const stubs={
    CONFIG:{LOCK_TIMEOUT_MS:100},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    sanitizeInput_:v=>String(v??''),
    requirePermission_:(token,module,action)=>{
      state.permissions.push([module,action]);
      if(token!=='fixture-actor'||action!=='edit'||
          !['suppliers','settlementDiscount'].includes(module)||
          (module==='settlementDiscount'&&!state.canDiscount)) {
        throw new Error('Permission denied');
      }
      return {name:'Fixture Actor'};
    },
    requireActiveCashSession_:()=>{if(!state.sessionOpen)throw new Error('Cash Session closed');},
    resolveTransactionDate_:()=>({dateStr:'2026-11-16',isBackdated:false,backdatedDays:0,reason:''}),
    findRowIndex_:(table,key,value)=>table==='SUPPLIERS'&&
      state.suppliers[0][key]===value?2:-1,
    getAllRows_:table=>table==='SUPPLIERS'?state.suppliers:[],
    isDeleted_:row=>row?.['Is Deleted']==='TRUE',
    updateRowFields_:(table,index,fields)=>{
      assert.equal(table,'SUPPLIERS');assert.equal(index,2);
      Object.assign(state.suppliers[0],fields);
    },
    generateId_:()=> 'SUP-LEDGER-1',
    appendRow_:(table,row)=>{
      assert.equal(table,'SUPPLIER_LEDGER');state.ledger.push({...row});
    },
    resolveBankAccount_:(method,id)=>({id:method==='Bank'?(id||'BANK-1'):'',name:'Fixture Bank'}),
    isBankLikePaymentMethod_:method=>method==='Bank'||method==='Mobile Banking',
    addCashBookEntry_:row=>state.cash.push({...row}),
    addBankBookEntry_:(id,row)=>state.bank.push({bankId:id,...row}),
    actorName_:u=>u.name,
    ok_:data=>({success:true,data}),
    fail_:error=>({success:false,error}),
    logError_:(area,err)=>state.errors.push([area,String(err.message)])
  };
  const source=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_','isValidNonNegativeNumber_'],
    'SettlementDiscount.gs':[
      'settlementPaymentAmount_','settlementDiscountAmount_',
      'settlementTotalAmount_','validateSettlementDiscount_'
    ],
    'Suppliers.gs':['paySupplier']
  },stubs);
  const pay=({payment,discount=0,method='Cash',reason=''})=>
    source.paySupplier('fixture-actor','SUP-1',payment,method,'BANK-1','',
      '2026-11-16','',discount,reason);
  return {state,source,pay};
}

test('G10: actual pinned Supplier Payment splits ৳100 ledger credit into ৳80 cash and ৳20 discount',()=>{
  const {state,pay}=supplierHarness();
  const result=pay({payment:80,discount:20});
  assert.equal(result.success,true);
  assert.equal(result.data.newDue,0);
  assert.equal(state.suppliers[0]['Current Due'],0);
  assert.equal(state.ledger.length,1);
  assert.equal(state.ledger[0].Credit,100);
  assert.equal(state.ledger[0]['Payment Amount'],80);
  assert.equal(state.ledger[0]['Discount Amount'],20);
  assert.equal(state.cash.length,1);
  assert.equal(state.cash[0].Debit,80);
  assert.equal(state.cash[0].Reference,state.ledger[0]['Ledger ID']);
  assert.equal(state.bank.length,0);
  assert.ok(state.permissions.some(([area])=>area==='settlementDiscount'));
});

test('G11: over-due discount is refused before any Supplier Ledger or Cash/Bank entry',()=>{
  const {state,pay}=supplierHarness();
  const result=pay({payment:90,discount:20});
  assert.equal(result.success,false);
  assert.match(result.error,/Payment plus discount cannot exceed the current due/);
  assert.equal(state.suppliers[0]['Current Due'],100);
  assert.deepEqual(state.ledger,[]);
  assert.deepEqual(state.cash,[]);
  assert.deepEqual(state.bank,[]);
});

test('G11: discount requires the actual Settlement Discount permission; no partial write',()=>{
  const {state,pay}=supplierHarness({canDiscount:false});
  const result=pay({payment:80,discount:20});
  assert.equal(result.success,false);
  assert.match(result.error,/Permission denied/);
  assert.equal(state.suppliers[0]['Current Due'],100);
  assert.deepEqual(state.ledger,[]);
  assert.deepEqual(state.cash,[]);
});

test('G09: zero-discount Bank overpayment becomes supplier advance without changing Cash',()=>{
  const {state,pay}=supplierHarness();
  const result=pay({payment:130,method:'Bank'});
  assert.equal(result.success,true);
  assert.equal(result.data.newDue,-30);
  assert.equal(state.ledger[0].Credit,130);
  assert.equal(state.bank.length,1);
  assert.equal(state.bank[0].Debit,130);
  assert.equal(state.cash.length,0);
  assert.equal(state.permissions.some(([area])=>area==='settlementDiscount'),false);
});

test('closed Cash Session rejects even a Bank supplier payment before all writes',()=>{
  const {state,pay}=supplierHarness({sessionOpen:false});
  assert.equal(pay({payment:20,method:'Bank'}).success,false);
  assert.equal(state.suppliers[0]['Current Due'],100);
  assert.deepEqual(state.ledger,[]);
  assert.deepEqual(state.bank,[]);
});

test('original settlement helper distinguishes historical blank Payment Amount and noncash discount',()=>{
  const {source}=supplierHarness();
  assert.equal(source.settlementPaymentAmount_({'Payment Amount':'',Credit:70}),70);
  assert.equal(source.settlementDiscountAmount_({'Discount Amount':''}),0);
  assert.equal(source.settlementTotalAmount_({'Payment Amount':80,'Discount Amount':20,Credit:100}),100);
  assert.equal(source.settlementTotalAmount_({'Payment Amount':'',Credit:90}),90);
});

const replayFunctions=[
  'supplierSettlementStableSortKey_','supplierSettlementIsCashBackedMethod_',
  'supplierSettlementCashAdvanceTotal_','supplierSettlementSupplierCreditTotal_',
  'supplierSettlementRecordPurchasePayment_','supplierSettlementRecordPurchaseCredit_',
  'supplierSettlementAddCashAdvance_','supplierSettlementConsumeCashAdvance_',
  'supplierSettlementConsumePurchase_','supplierSettlementConsumeOldest_',
  'supplierSettlementAddDebit_','supplierSettlementApplyNonCashCredit_',
  'supplierSettlementProcessPayment_','supplierSettlementState_'
];
function sourceSettlement(rows,returns=[]) {
  const source=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_'],
    'SettlementDiscount.gs':['settlementPaymentAmount_','settlementDiscountAmount_'],
    'SupplierSettlement.gs':replayFunctions
  },{isDeleted_:row=>row?.['Is Deleted']==='TRUE'});
  return own(source.supplierSettlementState_('SUP-1',{ledgerRows:rows,returnRows:returns}));
}
const ledger=(id,type,date,rowIndex,{debit='',credit='',reference='',method='',payment='',discount='',supplier='SUP-1'}={})=>({
  'Ledger ID':id,'Supplier ID':supplier,'Date':date,'Type':type,_rowIndex:rowIndex,
  'Debit':debit,'Credit':credit,'Reference':reference,
  'Payment Method':method,'Payment Amount':payment,'Discount Amount':discount
});

test('G12: tagged Supplier Return credit settles source Purchase first, then oldest obligation',()=>{
  const rows=[
    ledger('LED-B','Purchase','2026-11-12',4,{debit:60,reference:'PUR-B'}),
    ledger('LED-RETURN','Purchase Return Credit','2026-11-13',6,{credit:120,reference:'RET-B'}),
    ledger('LED-A','Purchase','2026-11-11',2,{debit:100,reference:'PUR-A'}),
    ledger('OTHER','Purchase','2026-11-01',1,{debit:900,reference:'PUR-X',supplier:'SUP-2'})
  ];
  const result=sourceSettlement(rows,[{'Return ID':'RET-B','Purchase ID':'PUR-B'}]);
  assert.equal(result.purchaseRemaining['PUR-B']??0,0);
  assert.equal(result.purchaseRemaining['PUR-A'],40);
  assert.equal(result.nonCashCreditByPurchase['PUR-B'],60);
  assert.equal(result.nonCashCreditByPurchase['PUR-A'],60);
  assert.equal(result.computedNetDue,40);
  assert.equal(result.cashAdvance,0);
  assert.equal(result.storeCredit,0);
});

test('Supplier Return excess remains noncash credit; does not become refundable cash advance',()=>{
  const rows=[
    ledger('LED-A','Purchase','2026-11-11',2,{debit:100,reference:'PUR-A'}),
    ledger('LED-RET','Purchase Return Credit','2026-11-12',3,{credit:130,reference:'RET-A'})
  ];
  const result=sourceSettlement(rows,[{'Return ID':'RET-A','Purchase ID':'PUR-A'}]);
  assert.equal(result.computedNetDue,-30);
  assert.equal(result.storeCredit,30);
  assert.equal(result.cashAdvance,0);
  assert.equal(result.cashByPurchase['PUR-A']??0,0);
  assert.equal(result.nonCashCreditByPurchase['PUR-A'],100);
});

test('source settlement consumes noncash credit before money-backed supplier advance',()=>{
  const rows=[
    ledger('LED-CREDIT','Purchase Return Credit','2026-11-10',1,{credit:50,reference:'RET-ORPHAN'}),
    ledger('LED-PAY','Payment','2026-11-11',2,{credit:100,method:'Cash',payment:100}),
    ledger('LED-PUR','Purchase','2026-11-12',3,{debit:120,reference:'PUR-1'})
  ];
  const result=sourceSettlement(rows,[]);
  assert.equal(result.purchaseRemaining['PUR-1']??0,0);
  assert.equal(result.storeCredit,0);
  assert.equal(result.cashAdvance,30);
  assert.equal(result.cashByPurchase['PUR-1'],70);
  assert.equal(result.nonCashCreditByPurchase['PUR-1'],50);
  assert.equal(result.computedNetDue,-30);
});

function returnHarness(method) {
  const state={
    customer:{'Customer ID':'CUS-1','Current Due':200,_rowIndex:2},
    product:{'Product ID':'PRD-1','Current Stock':10,_rowIndex:2},
    cash:[],books:[],headers:[],items:[],moves:[]
  };
  const stubs={
    appendRow_:(table,row)=>{
      if(table==='SALES_RETURN')state.headers.push({...row});
      else if(table==='CUSTOMER_LEDGER')state.books.push({...row});
      else assert.fail('Unexpected return table: '+table);
    },
    appendRows_:(table,rows)=>{
      const target=table==='SALES_RETURN_ITEMS'?state.items:table==='STOCK_MOVEMENT'?state.moves:null;
      assert.ok(target);target.push(...rows.map(r=>({...r})));
    },
    updateRowFields_:(table,index,fields)=>{
      assert.equal(index,2);
      Object.assign(table==='CUSTOMERS'?state.customer:state.product,fields);
    },
    restoreStockToLots_:()=>[{qty:1,lotId:'LOT-ORIGINAL',sourceConsumptionLinkId:'LINK-1'}],
    generateId_:()=> 'MOVE-1',
    actorName_:u=>u.name,
    addCashBookEntry_:row=>state.cash.push({...row}),
    roundMoney_:n=>Math.round((Number(n)+Number.EPSILON)*100)/100
  };
  const {commitPreparedSalesReturn_}=loadPinnedGASFunctions({
    'SalesReturn.gs':['commitPreparedSalesReturn_']
  },stubs);
  const prepared={
    sale:{'Customer Name':'Synthetic Buyer','Customer Phone':'','Customer Address':''},
    invoiceId:'INV-1',customerId:'CUS-1',creditCustomer:state.customer,
    refundMethod:method,totalReturnAmount:75,
    validatedItems:[{productId:'PRD-1',name:'Fixture Product',qty:1,price:75,lineTotal:75}],
    stockChanges:[{productId:'PRD-1',name:'Fixture Product',qty:1,rowIndex:2,
      newStock:11,sourceSaleProductId:'PRD-1'}],
    dateStr:'2026-11-16',txDate:{isBackdated:false,backdatedDays:0,reason:''},
    reason:'Fixture return',notes:''
  };
  const result=commitPreparedSalesReturn_(prepared,{returnId:'RETURN-1',actingUser:{name:'Fixture Cashier'}});
  return {result,state};
}

test('G16 source Cash return on an unpaid Customer invoice records money out but does not reduce AR',()=>{
  const {result,state}=returnHarness('Cash');
  assert.equal(result.newDue,null);
  assert.equal(state.customer['Current Due'],200);
  assert.equal(state.cash.length,1);
  assert.equal(state.cash[0].Debit,75);
  assert.equal(state.cash[0].Credit,'');
  assert.equal(state.cash[0].Reference,'RETURN-1');
  assert.equal(state.moves[0]['Lot ID'],'LOT-ORIGINAL');
  assert.equal(state.moves[0]['Source Consumption Link ID'],'LINK-1');
  assert.equal(state.books.length,0);
});

test('G17 source Store Credit return reduces only Customer AR without a cash movement',()=>{
  const {result,state}=returnHarness('Store Credit');
  assert.equal(result.newDue,125);
  assert.equal(state.customer['Current Due'],125);
  assert.deepEqual(state.cash,[]);
  assert.equal(state.headers[0]['Refund Method'],'Store Credit');
  assert.equal(state.product['Current Stock'],11);
  assert.equal(state.books[0].Credit,75);
  assert.equal(state.books[0].Balance,125);
});
