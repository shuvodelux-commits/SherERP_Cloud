/**
 * Internal, read-only M09 Sales Report projection.
 *
 * Reproduces frozen Reports.gs::getSalesReport from trusted source-shaped
 * Sales rows, active Sales Return child rows, and separately reconciled
 * Customer settlement snapshots. Does not authorize, query D1, infer
 * Party identities, collect money, post returns or register an RPC.
 *
 * Caller must have checked reports:view and filtered active Sales Return
 * children by BOTH the return header and child active flags.
 */
import {normalizeReportRange,dateInReportRange,reportDefaultRange} from './report-date-range.js';

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function field(object,key){
  const desc=Object.getOwnPropertyDescriptor(object,key);
  if(desc && !Object.hasOwn(desc,'value'))
    throw new TypeError('Untrusted Sales Report accessor for '+key);
  return desc?.value;
}
function rows(snapshot,key){
  const value=field(snapshot,key);
  if(!Array.isArray(value))
    throw new TypeError('Trusted Sales Report snapshot requires '+key+' array');
  for(const row of value){
    if(!plain(row) ||
      Object.values(Object.getOwnPropertyDescriptors(row))
        .some(d=>!Object.hasOwn(d,'value')))
      throw new TypeError('Untrusted Sales Report row in '+key);
  }
  return value;
}
function amount(value,label){
  if(value!==null && value!==undefined &&
    !['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid trusted Sales Report '+label+' amount');
  const result=Number(value);
  if(!Number.isFinite(result) && !Number.isNaN(result))
    throw new TypeError('Expected finite Sales Report '+label+' amount');
  return result||0;
}
const roundMoney=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;
function dateOnly(value){
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Sales Report date must be canonical YYYY-MM-DD');
  reportDefaultRange(value);
  return value;
}
function isDeleted(row){
  const status=field(row,'Is Deleted');
  return status===true || status==='TRUE';
}
function sortedByDesc(map,key){
  return Object.keys(map)
    .map(label=>map[label])
    .sort((a,b)=>(Number(b[key])||0)-(Number(a[key])||0));
}
function settlement(settlements,invoice){
  const id=String(field(invoice,'Invoice ID')||'');
  const record=field(settlements,id);
  if(!plain(record))
    throw new TypeError('Missing trusted customer settlement for Sales Report invoice '+id);
  // No getters, inherited settlement fields or computed Party net values.
  const paidLater=field(record,'paidLater');
  const dueAmount=field(record,'dueAmount');
  if(typeof paidLater!=='number'||!Number.isFinite(paidLater)||
     typeof dueAmount!=='number'||!Number.isFinite(dueAmount))
    throw new TypeError('Trusted Sales Report settlement requires finite paidLater and dueAmount');
  return {paidLater,dueAmount};
}

/**
 * Project the original getSalesReport response without exposing an endpoint.
 * \`settlementsByInvoice\` comes from the separately authorized M06/M08
 * Customer settlement read path, not from the HTTP request.
 */
export function projectSalesReport(snapshot,filters,today){
  if(!plain(snapshot))
    throw new TypeError('Missing trusted Sales Report snapshot');
  const allSales=rows(snapshot,'allSales');
  const returnItems=rows(snapshot,'salesReturnItems');
  const settlements=field(snapshot,'settlementsByInvoice');
  if(!plain(settlements) ||
    Object.values(Object.getOwnPropertyDescriptors(settlements))
      .some(d=>!Object.hasOwn(d,'value')))
    throw new TypeError('Trusted Sales Report settlement map is required');

  const range=normalizeReportRange(filters,today);
  const counts=new Map(),selected=[];
  for(const sale of allSales){
    const invoiceId=String(field(sale,'Invoice ID')||'').trim();
    if(invoiceId)counts.set(invoiceId,(counts.get(invoiceId)||0)+1);
    const day=dateOnly(field(sale,'Date'));
    if(!isDeleted(sale) && dateInReportRange(day,range))
      selected.push(sale);
  }
  const selectedIds=new Set(selected.map(s=>String(field(s,'Invoice ID')||'').trim()).filter(Boolean));
  const duplicates=[...counts].filter(([id,n])=>selectedIds.has(id)&&n>1)
    .map(([id])=>id).sort();
  if(duplicates.length)
    throw new Error('Sales report: Duplicate invoice ID detected: '+duplicates.join(', '));

  const invoiceById=new Map();
  for(const sale of selected){
    invoiceById.set(String(field(sale,'Invoice ID')),sale);
  }
  const returnedByInvoice=new Map();
  for(const item of returnItems){
    const id=String(field(item,'Invoice ID'));
    const parent=invoiceById.get(id);
    if(!parent)continue;
    const raw=amount(field(item,'Line Total'),'return line');
    let economic=raw;
    if(field(item,'Pricing Basis')!=='NetAfterInvoiceDiscount'){
      const subtotal=amount(field(parent,'Subtotal'),'subtotal');
      const total=amount(field(parent,'Grand Total'),'grand total');
      economic=raw*(subtotal>0?total/subtotal:1);
    }
    returnedByInvoice.set(id,roundMoney((returnedByInvoice.get(id)||0)+economic));
  }

  let grossSales=0,discount=0,returned=0,paid=0,due=0;
  const byDay=Object.create(null),byPaymentType=Object.create(null),
    byCustomer=Object.create(null);
  for(const sale of selected){
    const id=String(field(sale,'Invoice ID'));
    const day=dateOnly(field(sale,'Date'));
    const gross=amount(field(sale,'Grand Total'),'grand total');
    const ret=returnedByInvoice.get(id)||0;
    const net=gross-ret;

    grossSales=roundMoney(grossSales+gross);
    discount=roundMoney(discount+amount(field(sale,'Discount'),'discount'));
    returned=roundMoney(returned+ret);

    let paidAmount=amount(field(sale,'Paid Amount'),'paid');
    let dueAmount=amount(field(sale,'Due Amount'),'due');
    const customerId=String(field(sale,'Customer ID')||'');
    if(customerId && dueAmount>0.004){
      const settled=settlement(settlements,sale);
      // Actual later Payment money only: exclude non-cash returns / credits.
      paidAmount=roundMoney(paidAmount+settled.paidLater);
      dueAmount=settled.dueAmount;
    }
    paid=roundMoney(paid+paidAmount);
    due=roundMoney(due+dueAmount);

    if(!byDay[day])byDay[day]={label:day,invoices:0,gross:0,returned:0,net:0};
    byDay[day].invoices++;
    byDay[day].gross=roundMoney(byDay[day].gross+gross);
    byDay[day].returned=roundMoney(byDay[day].returned+ret);
    byDay[day].net=roundMoney(byDay[day].net+net);

    const paymentType=field(sale,'Payment Type')||'Unknown';
    if(!byPaymentType[paymentType])
      byPaymentType[paymentType]={label:paymentType,invoices:0,gross:0,net:0};
    byPaymentType[paymentType].invoices++;
    byPaymentType[paymentType].gross=roundMoney(byPaymentType[paymentType].gross+gross);
    byPaymentType[paymentType].net=roundMoney(byPaymentType[paymentType].net+net);

    const customerName=field(sale,'Customer Name')||'Walk-in Customer';
    if(!byCustomer[customerName])
      byCustomer[customerName]={label:customerName,invoices:0,gross:0,net:0};
    byCustomer[customerName].invoices++;
    byCustomer[customerName].gross=roundMoney(byCustomer[customerName].gross+gross);
    byCustomer[customerName].net=roundMoney(byCustomer[customerName].net+net);
  }
  return {
    range,
    totals:{
      invoices:selected.length,grossSales,discount,returned,
      netSales:roundMoney(grossSales-returned),paid,due
    },
    byDay:Object.keys(byDay).sort().map(label=>byDay[label]),
    byPaymentType:sortedByDesc(byPaymentType,'net'),
    topCustomers:sortedByDesc(byCustomer,'net').slice(0,15)
  };
}
