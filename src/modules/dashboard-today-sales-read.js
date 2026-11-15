/**
 * M09 pure internal Today Sales Dashboard tile, from frozen Dashboard.gs.
 * Expects active, shop-date-filtered Sales and active Sales Return child rows.
 * NO public RPC, D1 storage, authentication, stock or financial posting.
 */
import {reportDefaultRange} from './report-date-range.js';

const SNAPSHOT_FIELDS=new Set(['today','todaySales','activeReturnItems']);
const FORBIDDEN_IDS=new Set(['__proto__','prototype','constructor']);

function plainObject(value,label){
  if(value===null || typeof value!=='object' || Array.isArray(value) ||
     (Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted '+label);
  return value;
}

function trustedData(value,label,arrayKeys){
  const object=plainObject(value,label);
  const fields=Reflect.ownKeys(object);
  if(fields.some(key=>typeof key!=='string'))
    throw new TypeError('Invalid trusted '+label+' symbol key');
  for(const key of fields){
    const descriptor=Object.getOwnPropertyDescriptor(object,key);
    if(!descriptor || !Object.hasOwn(descriptor,'value'))
      throw new TypeError('Invalid trusted '+label+' accessor field');
    const field=descriptor.value;
    if(arrayKeys?.has(key) && Array.isArray(field))continue;
    if(field!==null && (typeof field==='object' ||
       typeof field==='function' || typeof field==='symbol' ||
       typeof field==='bigint'))
      throw new TypeError('Invalid trusted '+label+' field');
    if(typeof field==='number' && !Number.isFinite(field) &&
       !Number.isNaN(field))
      throw new TypeError('Invalid trusted '+label+' nonfinite number');
  }
  return object;
}

function checkedRows(value,label){
  if(!Array.isArray(value))
    throw new TypeError('Invalid trusted '+label+' array');
  return value.map(row=>trustedData(row,label+' row'));
}

function invoiceId(row,label){
  const id=row['Invoice ID'];
  if(typeof id!=='string' || !id.trim() ||
     FORBIDDEN_IDS.has(id.trim()))
    throw new TypeError('Invalid trusted '+label+' Invoice ID');
  return id;
}

function money(raw){
  const numeric=Number(raw)||0; // Frozen Utils.gs/ Dashboard.gs coercion.
  if(!Number.isFinite(numeric))
    throw new TypeError('Invalid trusted Dashboard money');
  return numeric;
}

function roundMoney(value){
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}

/**
 * Returns exactly one number, the source Today Sales total after all
 * source-active, invoice-linked return lines. Return DATE is irrelevant;
 * the invoice DATE controls attribution. Caller must also validate invoice
 * uniqueness against all active source Sales before filtering today's rows.
 */
export function projectDashboardTodayNetSales(snapshot){
  const data=trustedData(snapshot,'Dashboard Today Sales snapshot',
    new Set(['todaySales','activeReturnItems']));
  const keys=Reflect.ownKeys(data);
  if(keys.length!==SNAPSHOT_FIELDS.size ||
     keys.some(key=>!SNAPSHOT_FIELDS.has(key)))
    throw new TypeError('Invalid trusted Dashboard Today Sales snapshot');
  reportDefaultRange(data.today);
  const sales=checkedRows(data.todaySales,'Sales');
  const returns=checkedRows(data.activeReturnItems,'Sales Return');
  const byInvoice=new Map(), seen=new Set();
  let grossSales=0;
  for(const sale of sales){
    const id=invoiceId(sale,'Sales');
    if(reportDefaultRange(sale.Date).to!==data.today)
      throw new TypeError('Invalid trusted Sales invoice date for Today');
    const key=id.trim();
    if(seen.has(key))throw new TypeError('Duplicate Sales Invoice ID');
    seen.add(key);
    byInvoice.set(id,sale);
    grossSales+=money(sale['Grand Total']);
  }

  let returned=0;
  for(const child of returns){
    const id=invoiceId(child,'Sales Return');
    const parent=byInvoice.get(id);
    if(!parent)continue;
    const raw=money(child['Line Total']);
    if(child['Pricing Basis']==='NetAfterInvoiceDiscount'){
      returned+=raw;
    }else{
      const subtotal=money(parent.Subtotal);
      const total=money(parent['Grand Total']);
      returned+=raw*(subtotal>0?total/subtotal:1);
    }
  }
  return roundMoney(grossSales-returned);
}
