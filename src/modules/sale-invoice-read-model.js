/**
 * M06 posted-invoice source projection (READ ONLY).
 *
 * Mirrors the returned shape of pinned Invoice.gs::buildInvoicePayload_, but
 * takes explicitly supplied, already-authorized source-shaped rows/settings.
 * No GAS global reads, D1 binding, financial writes, hidden actor, RPC or
 * external resource access. The caller must independently verify read access
 * and produce the current settlement + shop/branding snapshots.
 *
 * This is NOT a publicly exposed findInvoice implementation.
 */
import {readSalePaymentBreakdown_,salePaymentPaisa_} from './sale-payments.js';

const record=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null);

function requireTrustedSnapshot(snapshot){
  if(!record(snapshot) || !Array.isArray(snapshot.sales) ||
    !Array.isArray(snapshot.items) || !Array.isArray(snapshot.products) ||
    !Array.isArray(snapshot.customers) || !Array.isArray(snapshot.paymentRows) ||
    !record(snapshot.settings) || !record(snapshot.shop) ||
    (snapshot.settlement!=null && !record(snapshot.settlement))){
    throw new TypeError('Missing trusted posted-invoice snapshot or source-shaped paymentRows');
  }
  return snapshot;
}

// In D1 the Date sheet value is already a reviewed canonical date string or
// timestamp, never an Apps Script Date or a browser-local Date object.
function dateOnly(value){
  if(!value)return '';
  if(typeof value!=='string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)){
    throw new TypeError('Invalid canonical posted-invoice date');
  }
  const [year,month,day]=value.slice(0,10).split('-').map(Number);
  // Date.setUTCFullYear also handles years 0000–0099 without the
  // Date.UTC(0..99) implicit 1900 offset. Reject silently rolled days.
  const calendar=new Date(0);
  calendar.setUTCFullYear(year,month-1,day);
  if(calendar.getUTCFullYear()!==year ||
    calendar.getUTCMonth()!==month-1 ||
    calendar.getUTCDate()!==day){
    throw new TypeError('Invalid canonical posted-invoice date');
  }
  // An imported ISO-shaped Date must also carry a real clock/UTC offset.
  // Keep the calendar day as stored; never shift invoice dates by timezone.
  const timestamp=value.match(/T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if(timestamp){
    const [,hour,minute,second,offset]=timestamp;
    const invalidClock=Number(hour)>23||Number(minute)>59||Number(second)>59;
    const invalidOffset=offset&&offset!=='Z'&&
      (Number(offset.slice(1,3))>23||Number(offset.slice(-2))>59);
    if(invalidClock||invalidOffset)
      throw new TypeError('Invalid canonical posted-invoice date');
  }
  return value.slice(0,10);
}

function timeOnly(value){
  if(!value)return '';
  if(typeof value!=='string')throw new TypeError('Invalid posted-invoice time');
  const text=value.trim();
  const iso=text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if(iso)return iso[1];
  const plain=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(plain)return String(plain[1]).padStart(2,'0')+':'+plain[2]+':'+(plain[3]||'00');
  return text;
}

function dueDate(date,days){
  if(!days || days<=0 || !date)return '';
  const parts=String(date).split('-');
  if(parts.length!==3)return '';
  const base=new Date(Date.UTC(Number(parts[0]),Number(parts[1])-1,Number(parts[2])));
  if(Number.isNaN(base.getTime()))return '';
  base.setUTCDate(base.getUTCDate()+days);
  return base.toISOString().slice(0,10);
}

const relation=value=>String(value||'').trim()==='Husband'?'Husband':'Father';

/**
 * Project a posted invoice for the original print/duplicate-invoice UI.
 *
 * Input rows are original legacy column names (pre-adapted from trusted D1
 * reads). settlement reflects subsequent collections; it MUST NOT replace
 * the historical checkout payment rows or originalPaidAmount.
 */
export function projectPostedSaleInvoice(invoiceId,untrustedSnapshot){
  if(typeof invoiceId!=='string' || !invoiceId.trim()){
    throw new TypeError('Missing posted-invoice ID');
  }
  const snapshot=requireTrustedSnapshot(untrustedSnapshot);
  const matches=snapshot.sales.filter(row=>String(row['Invoice ID'])===invoiceId);
  if(matches.length===0)throw new Error('Invoice not found.');
  if(matches.length>1){
    throw new Error('Duplicate invoice ID detected: '+invoiceId+
      '. Stop posting sales and repair the invoice ID counter/data before reprinting this invoice.');
  }
  const sale=matches[0];
  if(String(sale['Is Deleted']||'').toUpperCase()==='TRUE'){
    throw new Error('Invoice not found or has been deleted.');
  }

  // Validate immutable checkout totals separately from later collections,
  // credits and returns. Never correct an imported invoice while printing.
  try{
    const grand=salePaymentPaisa_(sale['Grand Total'],'Original grand total',false);
    const paid=salePaymentPaisa_(sale['Paid Amount'],'Original paid amount',false);
    const due=salePaymentPaisa_(sale['Due Amount'],'Original due amount',false);
    if(!Number.isSafeInteger(paid+due)||paid+due!==grand)
      throw new Error('Unreconciled original checkout');
  }catch{
    throw new Error('NEEDS_REVIEW: posted invoice original checkout totals mismatch');
  }

  const saleDate=dateOnly(sale['Date']);
  const termDays=Number(snapshot.settings['Invoice Payment Terms Days'])||0;
  const productUnits=Object.create(null);
  snapshot.products.forEach(p=>{productUnits[p['Product ID']]=p['Unit']||'';});

  const hasRelationSnapshot=!!String(sale['Customer Relation Type']||'').trim();
  let fatherName=hasRelationSnapshot?(sale['Customer Relation Name']||''):'';
  if(!hasRelationSnapshot && sale['Customer ID']){
    const matchingCustomer=snapshot.customers.find(c=>
      c['Customer ID']===sale['Customer ID']);
    if(matchingCustomer)fatherName=matchingCustomer['Father Name']||'';
  }

  const detailVersion=String(sale['Payment Detail Version']||'').trim();
  const payments=readSalePaymentBreakdown_(sale,
    detailVersion==='1'?snapshot.paymentRows.filter(row=>
      row['Invoice ID']===invoiceId):[]);
  const settlement=snapshot.settlement||{
    paidAmount:Number(sale['Paid Amount'])||0,
    dueAmount:Number(sale['Due Amount'])||0,
    customerCreditUsed:0,
    paymentType:sale['Payment Type']||'',
    paymentStatus:sale['Payment Status']||''
  };

  return {
    invoiceId:sale['Invoice ID'],
    date:saleDate,
    time:timeOnly(sale['Time']),
    dueDate:dueDate(saleDate,termDays),
    customerName:sale['Customer Name'],
    customerPhone:sale['Customer Phone'],
    customerAddress:sale['Customer Address'],
    customerId:sale['Customer ID'],
    customerFatherName:fatherName,
    customerRelationType:relation(sale['Customer Relation Type']),
    items:snapshot.items.filter(item=>item['Invoice ID']===invoiceId).map(item=>({
      productId:item['Product ID'],
      name:item['Product Name'],
      qty:item['Quantity'],
      unit:productUnits[item['Product ID']]||'',
      unitPrice:item['Unit Price'],
      lineTotal:item['Line Total'],
      supplierId:item['Supplier ID']||'',
      supplierName:item['Supplier Name']||''
    })),
    subtotal:sale['Subtotal'],
    discount:sale['Discount'],
    grandTotal:sale['Grand Total'],
    paidAmount:settlement.paidAmount,
    dueAmount:settlement.dueAmount,
    customerCreditUsed:settlement.customerCreditUsed||0,
    paymentType:settlement.paymentType,
    paymentStatus:settlement.paymentStatus,
    originalPaidAmount:Number(sale['Paid Amount'])||0,
    paymentDetailVersion:detailVersion,
    payments,
    paymentMethod:sale['Payment Method']||'',
    bankAccountId:sale['Bank Account ID']||'',
    bankAccountName:sale['Bank Account Name']||'',
    shop:snapshot.shop
  };
}
