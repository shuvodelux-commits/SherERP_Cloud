/**
 * M09 original Purchase Report pure read projection.
 *
 * Source: frozen Reports.gs::getPurchaseReport and Utils.gs.
 * The future caller must independently authorize reports:view and provide
 * active Purchases, active Purchase Return children (with active parents),
 * and independently reconciled supplier payment/due evidence.
 * This module never queries D1, posts money, or registers an RPC.
 */
import {normalizeReportRange,dateInReportRange,reportDefaultRange} from './report-date-range.js';

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function field(row,key){
  const property=Object.getOwnPropertyDescriptor(row,key);
  if(property && !Object.hasOwn(property,'value'))
    throw new TypeError('Untrusted Purchase Report accessor: '+key);
  return property?.value;
}
function rows(snapshot,key){
  const value=field(snapshot,key);
  if(!Array.isArray(value))
    throw new TypeError('Trusted Purchase Report snapshot needs '+key+' array');
  for(const row of value){
    if(!plain(row) ||
      Object.values(Object.getOwnPropertyDescriptors(row)).some(p=>!Object.hasOwn(p,'value')))
      throw new TypeError('Untrusted Purchase Report row in '+key);
  }
  return value;
}
function money(value,label){
  if(value!==null && value!==undefined &&
     !['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid trusted Purchase Report '+label+' amount');
  const numeric=Number(value);
  if(!Number.isFinite(numeric) && !Number.isNaN(numeric))
    throw new TypeError('Expected finite Purchase Report '+label+' amount');
  return numeric||0;
}
const roundMoney=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;
function businessDate(value){
  if(value==null||value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Purchase Report date must be canonical YYYY-MM-DD');
  reportDefaultRange(value); // Validate a shop-local date, not a UTC timestamp.
  return value;
}
function sortedByDesc(map,key){
  return Object.keys(map).map(label=>map[label])
    .sort((a,b)=>(Number(b[key])||0)-(Number(a[key])||0));
}
function settlement(settlements,purchase){
  const id=String(field(purchase,'Purchase ID')||'');
  const record=field(settlements,id);
  if(!plain(record))
    throw new TypeError('Missing trusted supplier settlement for purchase '+id);
  const paidLater=field(record,'paidLater');
  const dueAmount=field(record,'dueAmount');
  if(typeof paidLater!=='number'||!Number.isFinite(paidLater)||
     typeof dueAmount!=='number'||!Number.isFinite(dueAmount))
    throw new TypeError('Trusted supplier settlement requires finite paidLater and dueAmount');
  return {paidLater,dueAmount};
}

/**
 * Source-compatible {range,totals,byDay,topSuppliers}.
 * Cash payment figures are supplied from an independently reconciled
 * Supplier ledger, never inferred from return credits or Party netting.
 */
export function projectPurchaseReport(snapshot,filters,today){
  if(!plain(snapshot))
    throw new TypeError('Missing trusted Purchase Report snapshot');
  const activePurchases=rows(snapshot,'activePurchases');
  const returnItems=rows(snapshot,'purchaseReturnItems');
  const settlements=field(snapshot,'settlementsByPurchase');
  if(!plain(settlements) ||
     Object.values(Object.getOwnPropertyDescriptors(settlements))
       .some(p=>!Object.hasOwn(p,'value')))
    throw new TypeError('Trusted Purchase Report settlement map required');

  const range=normalizeReportRange(filters,today);
  const selected=[];
  const selectedIds=new Set();
  for(const purchase of activePurchases){
    const date=businessDate(field(purchase,'Date'));
    if(!dateInReportRange(date,range))continue;
    const id=String(field(purchase,'Purchase ID')||'');
    if(selectedIds.has(id))
      throw new Error('Duplicate Purchase ID in selected Purchase Report: '+id);
    selectedIds.add(id);
    selected.push(purchase);
  }

  const purchaseById=new Map();
  for(const purchase of selected)
    purchaseById.set(String(field(purchase,'Purchase ID')||''),purchase);
  const returnedByPurchase=new Map();
  for(const item of returnItems){
    const id=String(field(item,'Purchase ID')||'');
    const parent=purchaseById.get(id);
    if(!parent)continue;
    const raw=money(field(item,'Line Total'),'return line');
    let economic=raw;
    if(field(item,'Pricing Basis')!=='NetAfterInvoiceDiscount'){
      const subtotal=money(field(parent,'Subtotal'),'subtotal');
      const total=money(field(parent,'Grand Total'),'grand total');
      economic=raw*(subtotal>0?total/subtotal:1);
    }
    returnedByPurchase.set(id,roundMoney((returnedByPurchase.get(id)||0)+economic));
  }

  const byDay=Object.create(null),bySupplier=Object.create(null);
  let grossPurchases=0,discount=0,returned=0,paid=0,due=0;
  for(const purchase of selected){
    const id=String(field(purchase,'Purchase ID')||'');
    const day=businessDate(field(purchase,'Date'));
    const gross=money(field(purchase,'Grand Total'),'grand total');
    const ret=returnedByPurchase.get(id)||0;
    const net=gross-ret;

    grossPurchases=roundMoney(grossPurchases+gross);
    discount=roundMoney(discount+money(field(purchase,'Discount'),'discount'));
    returned=roundMoney(returned+ret);
    let paidAmount=money(field(purchase,'Paid Amount'),'paid');
    let dueAmount=money(field(purchase,'Due Amount'),'due');
    const supplierId=String(field(purchase,'Supplier ID')||'');
    if(supplierId && dueAmount>0.004){
      const settled=settlement(settlements,purchase);
      // Purchase Return and noncash credits reduce due but are not money paid.
      paidAmount=roundMoney(paidAmount+settled.paidLater);
      dueAmount=settled.dueAmount;
    }
    paid=roundMoney(paid+paidAmount);
    due=roundMoney(due+dueAmount);

    if(!byDay[day])
      byDay[day]={label:day,purchases:0,gross:0,returned:0,net:0};
    byDay[day].purchases++;
    byDay[day].gross=roundMoney(byDay[day].gross+gross);
    byDay[day].returned=roundMoney(byDay[day].returned+ret);
    byDay[day].net=roundMoney(byDay[day].net+net);

    const supplierName=field(purchase,'Supplier Name')||'Unknown';
    if(!bySupplier[supplierName])
      bySupplier[supplierName]={label:supplierName,purchases:0,gross:0,net:0,due:0};
    bySupplier[supplierName].purchases++;
    bySupplier[supplierName].gross=roundMoney(bySupplier[supplierName].gross+gross);
    bySupplier[supplierName].net=roundMoney(bySupplier[supplierName].net+net);
    bySupplier[supplierName].due=roundMoney(bySupplier[supplierName].due+dueAmount);
  }
  return {
    range,
    totals:{
      purchases:selected.length,grossPurchases,discount,returned,
      netPurchases:roundMoney(grossPurchases-returned),paid,due
    },
    byDay:Object.keys(byDay).sort().map(day=>byDay[day]),
    topSuppliers:sortedByDesc(bySupplier,'net').slice(0,15)
  };
}
