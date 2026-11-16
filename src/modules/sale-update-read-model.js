/**
 * M06 internal, READ-ONLY Sales → POS Update Mode source projection.
 *
 * Frozen authority: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * SalesManagement.gs::getSaleForUpdate, Bundles.gs, CashSession.gs.
 * All snapshot rows MUST be tenant-filtered by M03 and canEditSales MUST be
 * granted by M04, server-side. This is never permission to execute updateSale:
 * a future D1 writer must re-authorize, recheck returns/session/version and
 * post Cash/Bank/stock/Customer effects atomically using the shared kernel.
 *
 * No D1 reads/writes, RPC, hidden actor, external resources or UI changes.
 */
import {readSalePaymentBreakdown_} from './sale-payments.js';

const record=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);
const deleted=row=>String(row?.['Is Deleted']||'').toUpperCase()==='TRUE';
const amount=value=>Number(value)||0;
const roundMoney=value=>{
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
};
const nonNegative=value=>{
  const n=Number(value);
  return !Number.isNaN(n) && Number.isFinite(n) && n>=0;
};
function dateOnly(value){
  if(!value)return '';
  if(typeof value!=='string' ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)){
    throw new TypeError('Invalid canonical sale date in trusted snapshot.');
  }
  return value.slice(0,10);
}
function timeOnly(value){
  if(!value)return '';
  if(typeof value!=='string')throw new TypeError('Invalid sale time.');
  const text=value.trim();
  const iso=text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if(iso)return iso[1];
  const plain=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(plain)return String(plain[1]).padStart(2,'0')+':'+plain[2]+':'+(plain[3]||'00');
  return text;
}
function historicalSession(sessions,createdAt){
  const created=Date.parse(createdAt);
  if(!Number.isFinite(created))throw new Error('Invalid original sale creation time.');
  let match=null, latest=-Infinity;
  sessions.forEach(session=>{
    const opened=Date.parse(session['Opened At']);
    if(!Number.isFinite(opened))throw new Error('Invalid historical Cash Session time.');
    if(opened<=created && opened>latest){
      match=session;
      latest=opened;
    }
  });
  return match;
}
function bundleSnapshots(invoiceId,rows){
  const definitions=Object.create(null);
  rows.forEach(row=>{
    if(String(row['Invoice ID'])!==invoiceId)return;
    const id=String(row['Bundle Product ID']||'');
    if(!id)throw new Error('Historical bundle component is missing a bundle ID.');
    if(!definitions[id])definitions[id]={
      bundleId:id,revision:Number(row['Bundle Revision']),
      setsSold:Number(row['Sets Sold']),components:[]
    };
    const definition=definitions[id];
    if(definition.revision!==Number(row['Bundle Revision']) ||
       definition.setsSold!==Number(row['Sets Sold'])){
      throw new Error('Inconsistent historical bundle snapshot.');
    }
    const qty=Number(row['Quantity Per Set']);
    if(!Number.isFinite(qty) || qty<=0)throw new Error('Invalid historical bundle quantity.');
    definition.components.push({
      productId:String(row['Component Product ID']||''),
      qtyPerSet:qty,unit:String(row.Unit||'')
    });
  });
  return definitions;
}

/** Return the original getSaleForUpdate success.data shape, without writes. */
export function projectSaleForUpdate(invoiceId,snapshot,{canEditSales}={}){
  if(canEditSales!==true)throw new Error('Permission denied: sales.edit');
  if(typeof invoiceId!=='string' || !invoiceId.trim()){
    throw new TypeError('Missing invoice ID for Sales Update Mode.');
  }
  if(!record(snapshot) ||
     !['sales','items','paymentRows','returnItems','sessions',
       'bundleComponents','vendorSourcing'].every(name=>Array.isArray(snapshot[name]))){
    throw new TypeError('Missing trusted source-shaped sale edit snapshot.');
  }

  const sales=snapshot.sales.filter(row=>String(row['Invoice ID'])===invoiceId);
  if(sales.length>1){
    throw new Error('Duplicate invoice ID detected: '+invoiceId+
      '. This invoice must be repaired before View, Update, Delete or Return actions can continue.');
  }
  const sale=sales[0];
  if(!sale)throw new Error('Invoice not found.');
  if(deleted(sale))throw new Error('This invoice has been deleted.');
  const detailVersion=String(sale['Payment Detail Version']||'').trim();
  const payments=detailVersion==='1'
    ?readSalePaymentBreakdown_(sale,snapshot.paymentRows.filter(row=>String(row['Invoice ID'])===invoiceId))
    :[];

  if(snapshot.returnItems.some(row=>String(row['Invoice ID'])===invoiceId)){
    throw new Error('This invoice has Sales Return records and can no longer be updated. Use Sales Return for further corrections.');
  }
  const session=historicalSession(snapshot.sessions,sale['Created At']);
  if(!session || session['Status']!=='Open'){
    throw new Error('This invoice belongs to a closed Cash Session and can no longer be edited. Please use Sales Return to make corrections.');
  }

  const bundleDefs=bundleSnapshots(invoiceId,snapshot.bundleComponents);
  const vendorByProduct=Object.create(null);
  snapshot.vendorSourcing.forEach(row=>{
    if(String(row['Invoice ID'])===invoiceId && !deleted(row)){
      const productId=row['Product ID'];
      if(Object.hasOwn(vendorByProduct,productId)){
        throw new Error('NEEDS_REVIEW: ambiguous historical vendor sourcing for Sales Update Mode');
      }
      vendorByProduct[productId]=row;
    }
  });
  return {
    invoiceId:sale['Invoice ID'],date:dateOnly(sale['Date']),time:timeOnly(sale['Time']),
    customerId:sale['Customer ID'],customerName:sale['Customer Name'],
    customerPhone:sale['Customer Phone'],customerAddress:sale['Customer Address'],
    discount:amount(sale['Discount']),paidAmount:amount(sale['Paid Amount']),
    paymentDetailVersion:detailVersion,payments,
    paymentMethod:sale['Payment Method']||(amount(sale['Paid Amount'])>0?'Cash':''),
    bankAccountId:sale['Bank Account ID']||'',
    items:snapshot.items.filter(row=>String(row['Invoice ID'])===invoiceId).map(row=>{
      const vendor=vendorByProduct[row['Product ID']];
      const bundle=bundleDefs[row['Product ID']];
      return {
        productId:row['Product ID'],name:row['Product Name'],
        qty:amount(row['Quantity']),unitPrice:amount(row['Unit Price']),
        productType:bundle?'Bundle':(row['Sold Product Type']||'Standard'),
        bundleRevision:bundle?bundle.revision:0,
        lineTotal:row['Line Total']!=='' &&
          row['Line Total']!==null && row['Line Total']!==undefined &&
          nonNegative(row['Line Total'])
          ?Number(row['Line Total'])
          :roundMoney(amount(row['Quantity'])*amount(row['Unit Price'])),
        vendorId:vendor?vendor['Vendor ID']:'',
        vendorName:vendor?vendor['Vendor Name']:'',
        vendorUnitCost:vendor?amount(vendor['Unit Cost']):0,
        vendorQty:vendor?amount(vendor['Quantity']):0
      };
    })
  };
}
