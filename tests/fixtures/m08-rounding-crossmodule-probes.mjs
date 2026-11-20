/**
 * M08 Run 4 test-only witness that CALLS the existing M05/M06/M07 and M08
 * functions, not a new posting calculator. Disagreements are intentionally
 * reported, never normalized/mutated or selected as approved policy.
 */
import {readFileSync} from 'node:fs';
import {planSaleUpdateLineTotals} from '../../src/modules/sale-update-line-totals.js';
import {priceTileQuantity} from '../../src/modules/tile-quantity-contract.js';
import {normalizeSalePayments_,salePaymentPaisa_} from '../../src/modules/sale-payments.js';
import {auditPurchaseInvoiceConservation} from '../../src/modules/m05-purchase-invoice-conservation.js';
import {allocateInvoicePaisa,quoteExactLine,quoteCashRefundPaisa} from '../../src/modules/m08-exact-decimal-proposal.js';
import {loadPinnedGASFunctions} from './m08-legacy-source-runner.mjs';

const sourceNumberMinor=x=>{
  const rounded=Math.round((Number(x)+Number.EPSILON)*100);
  if(!Number.isSafeInteger(rounded))throw new RangeError('Source read-only amount outside minor unit comparison');
  return BigInt(rounded);
};
const dataRow=(x,label)=>{
  if(x===null||typeof x!=='object'||Array.isArray(x)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(x))||
      Reflect.ownKeys(x).some(key=>{
        const d=Object.getOwnPropertyDescriptor(x,key);
        return typeof key!=='string'||!d.enumerable||!Object.hasOwn(d,'value');
      }))throw new TypeError('Invalid or accessor-backed '+label+' record');
};

/**
 * Historical sale update uses per-line Math.round and then subtotal rounding;
 * new M08 quote calculates an exact header before apportioning lines.
 */
export function auditSourceSaleEditVsM08(lines,{historicalLineTotals={}}={}){
  if(!Array.isArray(lines)||lines.length<1)throw new TypeError('Explicit comparison lines required');
  for(const row of lines)dataRow(row,'M08 witness input');
  dataRow(historicalLineTotals,'historical source amounts');
  const source=planSaleUpdateLineTotals('QA-INV-1',
    lines.filter(x=>Object.hasOwn(historicalLineTotals,x.id)).map(row=>({
      'Invoice ID':'QA-INV-1','Product ID':row.id,'Quantity':Number(row.quantity),
      'Unit Price':Number(row.unitPrice),'Line Total':historicalLineTotals[row.id]
    })),
    lines.map(row=>({productId:row.id,qty:Number(row.quantity),unitPrice:Number(row.unitPrice)}))
  );
  const candidate=allocateInvoicePaisa({
    lines:lines.map(row=>({id:row.id,quantity:row.quantity,unitPrice:row.unitPrice})),
    discount:'0',roundingMode:'HALF_UP'
  });
  const sourceSubtotal=sourceNumberMinor(source.subtotal);
  const candidateSubtotal=BigInt(candidate.grandPaisa);
  const delta=sourceSubtotal-candidateSubtotal;
  return {
    sourceSubtotalPaisa:String(sourceSubtotal),
    sourceLinesPaisa:source.lines.map(row=>String(sourceNumberMinor(row.lineTotal))),
    sourceLineTotals:source.lines.map(row=>row.lineTotal),
    candidateHeaderPaisa:candidate.grandPaisa,
    candidateLines:candidate.lines,
    deltaPaisa:String(delta),
    classification:delta===0n?'PARITY':'REQUIRES_ROUNDING_SIGNOFF',
    historicalSourceRowsPreserved:true,
    postingAllowed:false
  };
}

export function auditTileLineVsM08({coveragePolicy='nominal',pricingUnit,priceText,boxes,extraPieces}){
  const config={
    productId:'QA-TILE',revision:'1',baseUnit:'Pcs',
    boxConversionId:'BOX-25',length:'12',width:'8',
    dimensionUnit:'in',piecesPerBox:'25',coveragePolicy,
    ...(coveragePolicy==='manufacturer'?{
      manufacturerSqftPerBox:'16.668',manufacturerEvidence:'qa-label-only'
    }:{})
  };
  const existing=priceTileQuantity(config,
    {mode:'pack',boxes,extraPieces},pricingUnit,priceText);
  const candidate=quoteExactLine({
    quantity:'1',unitPrice:priceText,
    unitRatio:existing.billingQuantity,roundingMode:'HALF_UP'
  });
  return {
    classification:existing.lineAmountMinor===candidate.amountPaisa?'PARITY':'REQUIRES_ROUNDING_SIGNOFF',
    m05LinePaisa:existing.lineAmountMinor,
    m08LinePaisa:candidate.amountPaisa,
    exactBillingQuantity:existing.billingQuantity,
    displaySqft:existing.quantity.displaySqft,
    postingAllowed:false
  };
}
const accounts=[{
  'Bank Account ID':'BANK-A','Account Name':'QA Bank',
  'Account Type':'Bank','Status':'Active','Is Deleted':'FALSE'
}];
export function auditSplitTenderForCandidate({lines,payments}){
  if(!Array.isArray(lines)||!Array.isArray(payments))
    throw new TypeError('Explicit fixture intent required');
  const candidate=allocateInvoicePaisa({lines,discount:'0',roundingMode:'HALF_UP'});
  const applied=normalizeSalePayments_(
    Number(candidate.grandPaisa)/100,payments,accounts
  );
  const minor=x=>BigInt(salePaymentPaisa_(x,'QA payment',false));
  const bank=applied.payments.filter(x=>x.method==='Bank')
    .reduce((total,x)=>total+minor(x.applied),0n);
  const cash=applied.payments.filter(x=>x.method==='Cash')
    .reduce((total,x)=>total+minor(x.applied),0n);
  const due=minor(applied.dueAmount),grand=BigInt(candidate.grandPaisa);
  return {
    grandPaisa:String(grand),bankAppliedPaisa:String(bank),
    cashAppliedPaisa:String(cash),changePaisa:String(minor(applied.changeAmount)),
    duePaisa:String(due),conserved:bank+cash+due===grand,postingAllowed:false
  };
}
export function auditSourcePurchaseDriftVsM08(){
  const source=auditPurchaseInvoiceConservation({
    purchases:[{
      'Purchase ID':'QA-PUR-1','Supplier ID':'QA-SUP-1',
      'Subtotal':5.005,'Discount':0,'Grand Total':5.005,'Paid Amount':0,
      'Due Amount':5.005,'Payment Status':'Due'
    }],
    purchaseItems:[{
      'Purchase ID':'QA-PUR-1','Product ID':'QA-P-1',
      'Quantity':0.5,'Unit Price':10.005,'Line Total':5.0025
    }]
  });
  const proposed=quoteExactLine({quantity:'0.5',unitPrice:'10.005',roundingMode:'HALF_UP'});
  return {
    sourceAuditReady:source.ready,
    sourceAmountTolerance:source.summary.amountTolerance,
    sourceIssues:source.issues,
    candidateOriginalCost:proposed.priceSource,
    candidateOriginalExactAmount:proposed.exactAmount,
    candidateMoneyPaisa:proposed.amountPaisa,
    historicalRowsModified:false
  };
}

export function auditReturnAndCashPolicyGap(){
  let customerDue=200,sourceCashOut=0;
  const {commitPreparedSalesReturn_}=loadPinnedGASFunctions({
    'SalesReturn.gs':['commitPreparedSalesReturn_']
  },{
    appendRow_(){},appendRows_(){},
    updateRowFields_(table,index,fields){
      if(table==='CUSTOMERS')customerDue=fields['Current Due'];
    },
    restoreStockToLots_:()=>[{qty:1,lotId:'QA-LOT-1',sourceConsumptionLinkId:'QA-LINK'}],
    generateId_:()=> 'QA-MOVE',
    actorName_:()=> 'QA Actor',
    addCashBookEntry_(row){sourceCashOut=Number(row.Debit)},
    roundMoney_:value=>Math.round((Number(value)+Number.EPSILON)*100)/100
  });
  const result=commitPreparedSalesReturn_({
    sale:{'Customer Name':'QA Buyer','Customer Phone':'','Customer Address':''},
    invoiceId:'QA-INV-UNPAID',customerId:'QA-CUS-1',
    creditCustomer:{'Customer ID':'QA-CUS-1','Current Due':200,_rowIndex:2},
    refundMethod:'Cash',totalReturnAmount:75,
    validatedItems:[{productId:'QA-P',name:'QA Item',qty:1,price:75,lineTotal:75}],
    stockChanges:[{productId:'QA-P',name:'QA Item',qty:1,rowIndex:2,newStock:2,sourceSaleProductId:'QA-P'}],
    dateStr:'2026-11-20',txDate:{isBackdated:false,backdatedDays:0,reason:''},
    reason:'QA policy comparison',notes:''
  },{returnId:'QA-RET-1',actingUser:{name:'QA Actor'}});
  const candidate=quoteCashRefundPaisa({
    returnPaisa:'7500',netCashCollectedPaisa:'0',
    priorCashRefundPaisa:'0',requestedCashRefundPaisa:'0'
  });
  if(result.newDue!==null||customerDue!==200)
    throw new Error('Frozen source cash return changed Customer AR');
  return {
    sourceUnpaidCashRefundPaisa:String(sourceNumberMinor(sourceCashOut)),
    sourceCustomerDuePaisa:String(sourceNumberMinor(customerDue)),
    candidateUnpaidCashRefundPaisa:candidate.cashRefundPaisa,
    candidateNocashRemainderPaisa:candidate.storeCreditPaisa,
    classification:'NEW_SHOP_POLICY_DIFFERS_FROM_HISTORIC_SOURCE',
    postingAllowed:false
  };
}
export function auditCartLineLimitGap(){
  const m06=readFileSync(new URL('../../src/modules/m06-posv2-unified-cart-preview.js',import.meta.url),'utf8');
  const m08=readFileSync(new URL('../../src/modules/m08-exact-decimal-proposal.js',import.meta.url),'utf8');
  const old=/intent\.lines\.length===0\|\|intent\.lines\.length>(\d+)/u.exec(m06);
  const proposed=/lines\.length<1\|\|lines\.length>(\d+)/u.exec(m08);
  if(!old||!proposed)throw new Error('Cannot verify both current line-count guards');
  const a=Number(old[1]),b=Number(proposed[1]);
  return {
    m06MaxLines:a,m08CandidateMaxLines:b,
    classification:a===b?'PARITY':'REQUIRES_PRODUCT_LIMIT_SIGNOFF',
    postingAllowed:false
  };
}
