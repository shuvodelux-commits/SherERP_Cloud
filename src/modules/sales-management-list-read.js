/**
 * M06 original Sales Management list read model — no D1 access or mutations.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * SalesManagement.gs::getSalesManagementList.
 *
 * M03 must supply tenant-scoped source-shaped rows; M04 must authorize
 * sales:view and the independent reports:view/posCost:view private-cost gate;
 * M07 must resolve ACTIVE return children, M08 must supply per-invoice
 * reconciled Customer settlement, M05 must supply net FIFO/active vendor cost.
 * This projection does NOT grant permission to edit/post transactions.
 */
import {sourceProfitMetric} from './sales-management-detail-read.js';
import {salePaymentPaisa_} from './sale-payments.js';

const plain=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);
const field=(row,key)=>{
  const prop=Object.getOwnPropertyDescriptor(row,key);
  if(prop && !Object.hasOwn(prop,'value'))
    throw new TypeError('Untrusted Sales list accessor: '+key);
  return prop?.value;
};
function assertPlain(row,label){
  if(!plain(row)||
     Object.values(Object.getOwnPropertyDescriptors(row))
       .some(desc=>!Object.hasOwn(desc,'value')))
    throw new TypeError('Untrusted Sales list '+label+' record.');
  return row;
}
function rows(snapshot,key){
  const value=field(snapshot,key);
  if(!Array.isArray(value))throw new TypeError('Missing trusted Sales list '+key+' snapshot.');
  for(const row of value)assertPlain(row,key);
  return value;
}
const number=value=>Number(value)||0;
const active=row=>String(field(row,'Is Deleted')||'').toUpperCase()!=='TRUE';
const sum=(map,key,amount)=>{map[key]=(map[key]||0)+number(amount);};
function dateOnly(value){
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string' ||
     !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new TypeError('Trusted Sales list date must be YYYY-MM-DD.');
  return value;
}
function timeOnly(value){
  if(!value)return '';
  if(typeof value!=='string')throw new TypeError('Invalid Sales list time.');
  const text=value.trim();
  const iso=text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if(iso)return iso[1];
  const simple=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(simple)return simple[1].padStart(2,'0')+':'+simple[2]+':'+(simple[3]||'00');
  throw new TypeError('Invalid canonical Sales list time.');
}
function historicalSession(sessions,createdAt){
  const t=new Date(createdAt).getTime();
  if(!Number.isFinite(t))throw new TypeError('Invalid trusted sale Created At.');
  let match=null,latest=-Infinity;
  for(const session of sessions){
    const opened=new Date(field(session,'Opened At')).getTime();
    if(!Number.isFinite(opened))throw new TypeError('Invalid trusted historical Cash Session.');
    if(opened<=t && opened>latest){latest=opened;match=session;}
  }
  return match;
}
function economicReturn(row,sale){
  const raw=number(field(row,'Line Total'));
  if(field(row,'Pricing Basis')==='NetAfterInvoiceDiscount')return raw;
  const sub=number(field(sale,'Subtotal')),grand=number(field(sale,'Grand Total'));
  return raw*(sub>0?grand/sub:1);
}
function settlementFor(map,id){
  const snapshot=field(map,id);
  assertPlain(snapshot,'Customer settlement');
  for(const key of ['paidAmount','dueAmount','customerCreditUsed']){
    const value=field(snapshot,key);
    if(typeof value!=='number'||!Number.isFinite(value))
      throw new TypeError('Invalid trusted Customer settlement '+key+' for '+id);
  }
  const status=field(snapshot,'paymentStatus');
  if(typeof status!=='string')
    throw new TypeError('Missing trusted Customer settlement paymentStatus for '+id);
  return snapshot;
}

/**
 * Source getSalesManagementList's array data, from independently authorized
 * snapshots. Never rely on editable=true to authorize a subsequent write.
 */
export function projectSalesManagementList(snapshot,{canViewSales,canViewProfit}={}){
  if(canViewSales!==true)throw new Error('Permission denied: sales.view');
  assertPlain(snapshot,'snapshot');
  const sales=rows(snapshot,'sales').filter(active);
  // The original checkout is immutable financial history. Never silently
  // coerce a corrupt imported header to zero or mix later collections into it.
  for(const sale of sales){
    try{
      const grand=salePaymentPaisa_(field(sale,'Grand Total'),'Grand total',false);
      const paid=salePaymentPaisa_(field(sale,'Paid Amount'),'Paid amount',false);
      const due=salePaymentPaisa_(field(sale,'Due Amount'),'Due amount',false);
      if(!Number.isSafeInteger(paid+due)||paid+due!==grand)
        throw new Error('Unreconciled original checkout');
    }catch{
      throw new Error('NEEDS_REVIEW: Sales list original checkout totals mismatch');
    }
  }
  const items=rows(snapshot,'items');
  const returns=rows(snapshot,'returnItems');
  const sessions=rows(snapshot,'sessions');
  rows(snapshot,'bundleComponents');
  rows(snapshot,'saleItemLots');
  rows(snapshot,'vendorSourcing');
  const settlements=assertPlain(field(snapshot,'settlementsByInvoice'),'settlement map');
  const counts=new Map();
  for(const sale of sales){
    const id=String(field(sale,'Invoice ID')||'').trim();
    if(id)counts.set(id,(counts.get(id)||0)+1);
  }
  const duplicates=new Set([...counts].filter(([,n])=>n>1).map(([id])=>id));
  const soldByInvoice=new Map(),saleByInvoice=new Map();
  for(const item of items){
    const id=field(item,'Invoice ID'),pid=field(item,'Product ID');
    if(!soldByInvoice.has(id))soldByInvoice.set(id,new Map());
    const map=soldByInvoice.get(id);
    map.set(pid,(map.get(pid)||0)+number(field(item,'Quantity')));
  }
  for(const sale of sales)saleByInvoice.set(field(sale,'Invoice ID'),sale);
  const returnedByInvoice=new Map();
  for(const row of returns){
    const id=field(row,'Invoice ID');
    if(duplicates.has(id))continue;
    const sale=saleByInvoice.get(id);
    if(!sale)continue;
    if(!returnedByInvoice.has(id))
      returnedByInvoice.set(id,{amount:0,byProduct:new Map()});
    const result=returnedByInvoice.get(id);
    result.amount+=economicReturn(row,sale);
    const pid=field(row,'Product ID');
    result.byProduct.set(pid,(result.byProduct.get(pid)||0)+
      number(field(row,'Return Quantity')));
  }

  return sales.map(sale=>{
    const id=field(sale,'Invoice ID');
    const duplicate=duplicates.has(id);
    const sold=soldByInvoice.get(id)||new Map();
    const returned=duplicate?
      {amount:null,byProduct:new Map()}:
      (returnedByInvoice.get(id)||{amount:0,byProduct:new Map()});
    let returnStatus=duplicate?'Integrity Error':'No Return';
    if(!duplicate && sold.size && returned.amount>0){
      returnStatus=[...sold].every(([pid,qty])=>
        (returned.byProduct.get(pid)||0)>=qty)
        ?'Fully Returned':'Partially Returned';
    }
    const session=historicalSession(sessions,field(sale,'Created At'));
    const editable=!duplicate && !returnedByInvoice.has(id) &&
      !!session && field(session,'Status')==='Open';

    let settlement=null;
    if(!duplicate &&
       String(field(sale,'Customer ID')||'') &&
       number(field(sale,'Due Amount'))>0.004)
      settlement=settlementFor(settlements,id);

    const result={
      invoiceId:id,
      date:dateOnly(field(sale,'Date')),time:timeOnly(field(sale,'Time')),
      customerId:field(sale,'Customer ID'),
      customerName:field(sale,'Customer Name'),
      customerPhone:field(sale,'Customer Phone'),
      grandTotal:number(field(sale,'Grand Total')),
      paidAmount:settlement?field(settlement,'paidAmount'):number(field(sale,'Paid Amount')),
      dueAmount:settlement?field(settlement,'dueAmount'):number(field(sale,'Due Amount')),
      customerCreditUsed:settlement?field(settlement,'customerCreditUsed'):0,
      returnedAmount:returned.amount,
      netSale:duplicate?null:number(field(sale,'Grand Total'))-returned.amount,
      paymentStatus:settlement?field(settlement,'paymentStatus'):field(sale,'Payment Status'),
      returnStatus,editable,duplicateInvoiceId:duplicate
    };
    if(canViewProfit===true && !duplicate){
      const metric=sourceProfitMetric(id,sale,
        items.filter(item=>field(item,'Invoice ID')===id),
        returns.filter(row=>field(row,'Invoice ID')===id),
        snapshot);
      result.profit=metric.profit;
      result.profitMarginPercent=metric.profitMarginPercent;
      result.profitCostComplete=metric.profitCostComplete;
    }
    return result;
  }).sort((a,b)=>String(b.date+' '+b.time).localeCompare(String(a.date+' '+a.time)));
}
