/**
 * M08 SOURCE ORACLE ONLY — execute pinned Mohim_ERP purchase functions against
 * synthetic, in-memory GAS stubs. NOT a D1 posting kernel or staging test.
 * Source is read from immutable legacy/source/*.gs verified by verify:source.
 * M03 owns every operational SQL writer, binding and migration.
 */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareGrossPartyBalances} from '../../src/party/gross-balance-preflight.js';

function pinnedFunction(filename,name,stubs){
  if(!['Purchase.gs','Suppliers.gs','PurchaseReturn.gs'].includes(filename))
    throw new Error('Unreviewed financial source selection');
  const source=readFileSync(new URL('../../legacy/source/'+filename,import.meta.url),'utf8');
  const functions=parse(source,{ecmaVersion:'latest',sourceType:'script'}).body;
  const matches=functions.filter(node=>node.type==='FunctionDeclaration'&&node.id?.name===name);
  assert.equal(matches.length,1,'Pinned source function must exist exactly once: '+name);
  return runInNewContext(source.slice(matches[0].start,matches[0].end)+'\n'+name,
    Object.assign(Object.create(null),stubs),
    {timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});
}

function sourceHarness(){
  const state={sessionOpen:true,errors:[],seq:{},cash:[],bank:[],
    tables:{
      SUPPLIERS:[{'Supplier ID':'SUP-001','Supplier Name':'Synthetic Supplier',
        'Current Due':0,'Opening Balance':0,Status:'Active',_rowIndex:2}],
      PRODUCTS:[{'Product ID':'PRD-001','Product Name':'Synthetic Pipe',
        'Current Stock':0,'Selling Price':0,_rowIndex:2}],
      PURCHASES:[],PURCHASE_ITEMS:[],SUPPLIER_LEDGER:[],
      STOCK_LOTS:[],STOCK_MOVEMENT:[],PURCHASE_RETURN:[],PURCHASE_RETURN_ITEMS:[]
    }
  };
  const t=name=>state.tables[name]??(state.tables[name]=[]);
  const issueId=table=>table+'-'+String(state.seq[table]=(state.seq[table]||0)+1).padStart(4,'0');
  const stubs={
    CONFIG:{LOCK_TIMEOUT_MS:100},
    LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
    requirePermission_:(token,module,action)=>{
      if(token!=='synthetic-owner')throw new Error('Permission denied');
      if(!(['purchase','suppliers'].includes(module)))throw new Error('Unexpected permission');
      if(!(['add','edit'].includes(action)))throw new Error('Unexpected action');
      return {name:'Synthetic Owner'};
    },
    requireActiveCashSession_:()=>{if(!state.sessionOpen)throw new Error('Cash Session closed');},
    resolveTransactionDate_:(token,module,date)=>({
      dateStr:date||'2026-11-10',isBackdated:false,backdatedDays:0,reason:''
    }),
    activeRows_:name=>t(name).filter(row=>row['Is Deleted']!=='TRUE'&&row.Status!=='Inactive'),
    getAllRows_:name=>t(name),
    findFirstRow_:(name,key,id)=>t(name).find(row=>row[key]===id),
    findRowIndex_:(name,key,id)=>t(name).find(row=>row[key]===id)?._rowIndex??-1,
    isDeleted_:row=>row?.['Is Deleted']==='TRUE',
    isValidNonNegativeNumber_:x=>Number.isFinite(Number(x))&&Number(x)>=0,
    bundleProductType_:()=> 'Standard',
    generateId_:issueId,
    appendRow_:(name,row)=>t(name).push({...row,_rowIndex:t(name).length+2}),
    appendRows_:(name,rows)=>rows.forEach(row=>stubs.appendRow_(name,row)),
    updateRowFields_:(name,index,fields)=>{
      const record=t(name).find(row=>row._rowIndex===index);
      if(!record)throw new Error('Missing source row for update');
      Object.assign(record,fields);
    },
    createLot_:(productId,productName,purchaseId,date,cost,qty,supplierId,supplierName,sell)=>{
      const lotId=issueId('STOCK_LOTS');
      stubs.appendRow_('STOCK_LOTS',{'Lot ID':lotId,'Purchase ID':purchaseId,
        'Product ID':productId,'Supplier ID':supplierId,'Purchase Date':date,
        'Unit Cost':cost,'Original Quantity':qty,'Remaining Quantity':qty,'Selling Price':sell});
      return lotId;
    },
    planPurchaseReturnLotReduction_:(purchaseId,productId,qty)=>{
      const lot=t('STOCK_LOTS').find(row=>row['Purchase ID']===purchaseId&&
        row['Product ID']===productId&&row['Remaining Quantity']>=qty);
      if(!lot)throw new Error('Original lot unavailable');
      return {lotId:lot['Lot ID'],qty};
    },
    applyPurchaseReturnLotReduction_:plan=>{
      const lot=t('STOCK_LOTS').find(row=>row['Lot ID']===plan.lotId);
      lot['Remaining Quantity']-=plan.qty;
      return [{lotId:plan.lotId,qty:plan.qty}];
    },
    activePurchaseReturnItems_:()=>t('PURCHASE_RETURN_ITEMS'),
    effectiveTransactionUnitPrice_:(gross,subtotal,grand)=>
      subtotal?gross*grand/subtotal:0,
    resolveBankAccount_:(method,id)=>({
      id:method==='Bank'?id||'':'',name:method==='Bank'?'Synthetic Bank':''
    }),
    isBankLikePaymentMethod_:method=>method==='Bank',
    addBankBookEntry_:(bankId,row)=>state.bank.push({bankId,...row}),
    addCashBookEntry_:row=>state.cash.push({...row}),
    validateSettlementDiscount_:(token,module,currentDue,amount,discount=0)=>{
      const payment=Number(amount),adjustment=Number(discount)||0;
      return {payment,discount:adjustment,total:payment+adjustment,reason:''};
    },
    roundMoney_:amount=>Math.round((Number(amount)+Number.EPSILON)*100)/100,
    sanitizeInput_:value=>String(value??''),
    actorName_:user=>user.name,
    ok_:value=>({success:true,data:value}),
    fail_:message=>({success:false,error:message}),
    logError_:(method,error)=>state.errors.push({method,error:String(error.message)})
  };
  return {state,stubs,
    create:pinnedFunction('Purchase.gs','createPurchase',stubs),
    pay:pinnedFunction('Suppliers.gs','paySupplier',stubs),
    ret:pinnedFunction('PurchaseReturn.gs','completePurchaseReturn',stubs)
  };
}
const item=(qty,cost)=>({productId:'PRD-001',name:'Synthetic Pipe',qty,
  unitPrice:cost,sellingPrice:80});
const purchase=(items,extra={})=>({
  supplierId:'SUP-001',items,discount:0,paidAmount:0,date:'2026-11-10',...extra
});
const rows=(h,name)=>h.state.tables[name];

test('pinned createPurchase: credit and cash purchase preserve due, native debits, lot cost/date and source IDs',()=>{
  const h=sourceHarness();
  const credit=h.create('synthetic-owner',purchase([item(10,60)]));
  assert.equal(credit.success,true);
  assert.equal(credit.data.grandTotal,600);
  assert.equal(credit.data.dueAmount,600);
  assert.equal(h.state.tables.SUPPLIERS[0]['Current Due'],600);
  assert.equal(rows(h,'SUPPLIER_LEDGER')[0].Debit,600);
  assert.equal(rows(h,'SUPPLIER_LEDGER')[0].Credit,'');
  assert.equal(rows(h,'SUPPLIER_LEDGER')[0].Reference,credit.data.purchaseId);
  assert.equal(h.state.cash.length,0);
  const cash=h.create('synthetic-owner',purchase([item(10,75)],{
    date:'2026-11-11',paidAmount:750,paymentMethod:'Cash'
  }));
  assert.equal(cash.success,true);
  assert.equal(cash.data.dueAmount,0);
  assert.equal(rows(h,'PRODUCTS')[0]['Current Stock'],20);
  assert.equal(rows(h,'SUPPLIER_LEDGER').length,1,'fully paid purchase adds no payable ledger');
  assert.equal(h.state.tables.SUPPLIERS[0]['Current Due'],600);
  assert.equal(h.state.cash.length,1);
  assert.equal(h.state.cash[0].Debit,750);
  assert.equal(h.state.cash[0].Reference,cash.data.purchaseId);
  assert.equal(h.state.cash[0].Date,'2026-11-11');
  assert.deepEqual(rows(h,'STOCK_LOTS').map(l=>[l['Supplier ID'],l['Purchase ID'],
    l['Unit Cost'],l['Original Quantity'],l['Purchase Date']]),[
    ['SUP-001',credit.data.purchaseId,60,10,'2026-11-10'],
    ['SUP-001',cash.data.purchaseId,75,10,'2026-11-11']
  ]);
  assert.deepEqual(rows(h,'STOCK_MOVEMENT').map(m=>[m.Reference,m['Lot ID'],m['Quantity In']]),[
    [credit.data.purchaseId,rows(h,'STOCK_LOTS')[0]['Lot ID'],10],
    [cash.data.purchaseId,rows(h,'STOCK_LOTS')[1]['Lot ID'],10]
  ]);
});

test('pinned createPurchase: Bank uses bank debit but still requires active Cash Session at entry',()=>{
  const h=sourceHarness();
  h.state.sessionOpen=false;
  const before=h.create('synthetic-owner',purchase([item(2,75)],{
    paidAmount:150,paymentMethod:'Bank',bankAccountId:'BANK-1'
  }));
  assert.equal(before.success,false);
  assert.equal(rows(h,'PURCHASES').length,0);
  h.state.sessionOpen=true;
  const accepted=h.create('synthetic-owner',purchase([item(2,75)],{
    paidAmount:150,paymentMethod:'Bank',bankAccountId:'BANK-1'
  }));
  assert.equal(accepted.success,true);
  assert.equal(h.state.bank.length,1);
  assert.equal(h.state.bank[0].bankId,'BANK-1');
  assert.equal(h.state.bank[0].Debit,150);
  assert.equal(h.state.cash.length,0);
  assert.equal(rows(h,'SUPPLIER_LEDGER').length,0);
  h.state.sessionOpen=false;
  const unpaid=h.create('synthetic-owner',purchase([item(1,60)]));
  assert.equal(unpaid.success,false,'zero-paid purchase is not exempt from source session entry');
  assert.equal(rows(h,'PURCHASES').length,1);
});

test('pinned createPurchase: unrecognized original Supplier ID is rejected with no new records',()=>{
  const h=sourceHarness();
  const result=h.create('synthetic-owner',purchase([item(1,60)],{supplierId:'NAME-MATCH-ONLY'}));
  assert.equal(result.success,false);
  assert.equal(rows(h,'PURCHASES').length,0);
  assert.equal(rows(h,'STOCK_LOTS').length,0);
  assert.equal(rows(h,'SUPPLIER_LEDGER').length,0);
});

test('pinned paySupplier: payment posts Supplier Ledger credit and Cash Book debit, overpayment is advance',()=>{
  const h=sourceHarness();
  h.state.tables.SUPPLIERS[0]['Current Due']=600;
  const result=h.pay('synthetic-owner','SUP-001',700,'Cash','','', '2026-11-12','',0,'');
  assert.equal(result.success,true);
  assert.equal(result.data.newDue,-100);
  const ledger=rows(h,'SUPPLIER_LEDGER')[0];
  assert.equal(ledger.Credit,700);
  assert.equal(ledger.Debit,'');
  assert.equal(ledger.Reference,'PAYMENT');
  assert.equal(h.state.cash[0].Debit,700);
  assert.equal(h.state.cash[0].Reference,ledger['Ledger ID']);
  assert.equal(rows(h,'SUPPLIERS')[0]['Current Due'],-100);
});

test('pinned completePurchaseReturn: supplier credit reverses the original lot and payable with source-linked IDs',()=>{
  const h=sourceHarness();
  const created=h.create('synthetic-owner',purchase([item(10,60)]));
  assert.equal(created.success,true);
  const purchaseId=created.data.purchaseId;
  const lotId=rows(h,'STOCK_LOTS')[0]['Lot ID'];
  const returned=h.ret('synthetic-owner',{
    purchaseId,items:[{productId:'PRD-001',qty:2}],refundMethod:'Supplier Credit',
    reason:'Synthetic return',date:'2026-11-12'
  });
  assert.equal(returned.success,true);
  assert.equal(returned.data.totalReturnAmount,120);
  assert.equal(rows(h,'STOCK_LOTS')[0]['Remaining Quantity'],8);
  assert.equal(rows(h,'PRODUCTS')[0]['Current Stock'],8);
  assert.equal(rows(h,'SUPPLIERS')[0]['Current Due'],480);
  const ledger=rows(h,'SUPPLIER_LEDGER').at(-1);
  assert.equal(ledger.Credit,120);
  assert.equal(ledger.Reference,returned.data.returnId);
  assert.equal(rows(h,'PURCHASE_RETURN_ITEMS')[0]['Purchase ID'],purchaseId);
  assert.equal(rows(h,'PURCHASE_RETURN_ITEMS')[0]['Pricing Basis'],'NetAfterInvoiceDiscount');
  const movement=rows(h,'STOCK_MOVEMENT').at(-1);
  assert.equal(movement.Reference,returned.data.returnId);
  assert.equal(movement['Lot ID'],lotId);
  assert.equal(movement['Quantity Out'],2);
  assert.equal(h.state.cash.length,0);
});

function gross(due){
  const sourceRows={
    CUSTOMERS:[{'Customer ID':'CUS-001','Customer Name':'Synthetic Combined Party',
      'Current Due':'90.00','Opening Balance':'0.00',_rowIndex:2}],
    SUPPLIERS:[{'Supplier ID':'SUP-001','Supplier Name':'Synthetic Combined Party',
      'Current Due':due,'Opening Balance':'-40.00',_rowIndex:2}],
    VENDORS:[],FINANCE_PERSONS:[],EXPENSE_PAYEES:[]
  };
  const approvedGroups=[{members:[
    {sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},
    {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'}
  ],reviewedBy:'synthetic-reviewer',reviewedAt:'2026-11-19T00:00:00Z',
  approvalRef:'SYNTHETIC-SAME-PARTY'}];
  return prepareGrossPartyBalances({sourceRows,approvedGroups,financeRows:[]});
}
test('approved same-Party identity keeps Supplier payable, advance, customer AR and historical opening independent',()=>{
  const owing=gross('600.00');
  assert.equal(owing.readyForAccountDesignReview,true);
  assert.deepEqual(owing.blockingIssues,[]);
  const payable=owing.currentCheckpoints.find(x=>x.kind==='SUPPLIER_PAYABLE');
  const customer=owing.currentCheckpoints.find(x=>x.kind==='CUSTOMER_RECEIVABLE');
  const opening=owing.openingCheckpoints.find(x=>x.kind==='SUPPLIER_ADVANCE');
  assert.equal(payable.amountMinor,60000);
  assert.equal(customer.amountMinor,9000);
  assert.equal(opening.amountMinor,4000);
  assert.equal(payable.sourceGroup,'SUPPLIERS');
  assert.equal(customer.sourceGroup,'CUSTOMERS');
  assert.equal(payable.partyId,customer.partyId);
  const advance=gross('-100.00');
  assert.equal(advance.currentCheckpoints.some(x=>x.kind==='SUPPLIER_PAYABLE'),false);
  assert.equal(advance.currentCheckpoints.find(x=>x.kind==='SUPPLIER_ADVANCE').amountMinor,10000);
  assert.equal(advance.currentCheckpoints.find(x=>x.kind==='CUSTOMER_RECEIVABLE').amountMinor,9000);
  assert.equal(advance.openingCheckpoints.find(x=>x.kind==='SUPPLIER_ADVANCE').amountMinor,4000);
});
