/**
 * M09 INTERNAL Sales/Purchases Day Book source-row projection.
 * Pinned Mohim_ERP DayBook.gs Sales/Purchases blocks and dayBookRow_.
 *
 * Source data must be complete, pre-authorized, pre-normalized to the shop
 * timezone, and deduplicated. This is NOT a D1 reader, public RPC or writer.
 */
import {reportDefaultRange} from './report-date-range.js';

const TS=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const HHMMSS=/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const bankLike=new Set(['Bank','Mobile Banking']);

function trustedRecord(value,label){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     (Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book '+label+' record');
  const result=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    const field=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string' || !field || !Object.hasOwn(field,'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' accessor');
    const item=field.value;
    if(item!==undefined && item!==null &&
       !['string','number','boolean'].includes(typeof item))
      throw new TypeError('Invalid trusted Day Book '+label+' scalar');
    if(typeof item==='number' && !Number.isFinite(item))
      throw new TypeError('Invalid finite Day Book '+label+' scalar');
    result[key]=item;
  }
  return result;
}

function sourceRows(snapshot){
  const data=trustedContainer(snapshot);
  return data;
}
function trustedContainer(snapshot){
  if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot) ||
     (Object.getPrototypeOf(snapshot)!==Object.prototype &&
      Object.getPrototypeOf(snapshot)!==null))
    throw new TypeError('Invalid trusted Day Book Sales/Purchase snapshot');
  const desc=Object.getOwnPropertyDescriptors(snapshot);
  if(Reflect.ownKeys(desc).length!==2 ||
     !Object.hasOwn(desc,'sales') || !Object.hasOwn(desc,'purchases') ||
     !Object.hasOwn(desc.sales,'value') || !Object.hasOwn(desc.purchases,'value'))
    throw new TypeError('Invalid trusted Day Book source snapshot keys');
  const clone=Object.create(null);
  for(const key of ['sales','purchases']){
    const list=desc[key].value;
    if(!Array.isArray(list))
      throw new TypeError('Invalid trusted Day Book '+key+' array');
    const fields=Object.getOwnPropertyDescriptors(list);
    if(Object.keys(fields).length!==list.length+1 ||
       Object.entries(fields).some(([name,d])=>
         name!=='length' && (!/^(?:0|[1-9]\d*)$/.test(name) ||
           !Object.hasOwn(d,'value'))))
      throw new TypeError('Invalid trusted Day Book '+key+' source rows');
    clone[key]=Array.from(list,item=>trustedRecord(item,key));
  }
  return clone;
}

function canonicalDate(value,label){
  if(typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' date');
  reportDefaultRange(value);
  return value;
}
function text(value,label){
  if(value===null || value===undefined || value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' field');
  return value;
}
function money(value,label){
  if(value===null || value===undefined || value==='')return 0;
  if(typeof value!=='number' && typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' amount');
  const amount=Number(value);
  if(!Number.isFinite(amount))
    throw new TypeError('Invalid finite Day Book '+label+' amount');
  return amount;
}
function sourceId(value,label){
  const id=text(value,label);
  if(!id || id in Object.prototype)
    throw new TypeError('Invalid unsafe Day Book '+label+' reference');
  return id;
}
function created(value,label){
  if(typeof value!=='string'||!TS.test(value))
    throw new TypeError('Invalid Day Book '+label+' timestamp');
  canonicalDate(value.slice(0,10),label);
  return value;
}
function saleTime(value){
  if(value===null || value===undefined || value==='')return '';
  if(typeof value!=='string' || !HHMMSS.test(value))
    throw new TypeError('Invalid Day Book Sale time');
  return value;
}
function deletion(record){
  const mark=record['Is Deleted'];
  if(mark!==undefined && mark!==null && mark!=='' &&
     mark!==true && mark!==false && mark!=='TRUE' && mark!=='FALSE')
    throw new TypeError('Invalid trusted Day Book deletion flag');
  return mark===true || mark==='TRUE';
}
function backdated(record){
  const days=money(record['Backdated Days'],'backdated days');
  return {isBackdated:!!record['Is Backdated'],
    backdatedDays:days,backdatedReason:text(record['Backdated Reason'],'backdated reason')};
}
function sourceRow(o) {
  const cashIn=o.cashIn||0,cashOut=o.cashOut||0;
  const bankIn=o.bankIn||0,bankOut=o.bankOut||0;
  return {
    ts:o.ts||'',date:o.date||'',time:o.time||'',
    referenceNo:o.referenceNo||'',module:o.module,
    transactionType:o.transactionType||'',party:o.party||'',
    description:o.description||'',paymentMethod:o.paymentMethod||'',
    cashIn,cashOut,bankIn,bankOut,
    amount:(cashIn+bankIn)-(cashOut+bankOut),
    createdBy:o.createdBy||'',status:o.status||'Active',
    isDeleted:!!o.isDeleted,deletedBy:o.deletedBy||'',
    deleteReason:o.deleteReason||'',
    isBackdated:!!o.isBackdated,backdatedDays:o.backdatedDays||0,
    backdatedReason:o.backdatedReason||'',
    sourceModule:o.sourceModule,sourceId:o.sourceId,
    openPage:o.sourceModule==='Sales'?'sales':'purchase',
    openId:o.openId||o.sourceId||'',
    deleteModule:o.sourceModule==='Sales'?'sales':'purchase',
    deleteId:o.deleteId||o.sourceId||''
  };
}
function shared(record,id,label,deleted){
  return {
    referenceNo:sourceId(record[id],label),
    date:canonicalDate(record.Date,label),
    ts:created(record['Created At'],label),
    createdBy:text(record['Created By'],label+' createdBy'),
    isDeleted:deleted,
    deletedBy:text(record['Deleted By'],label+' deletedBy'),
    deleteReason:text(record['Delete Reason'],label+' deleteReason'),
    ...backdated(record)
  };
}

/** Exact source section order: all Sales, then all Purchases. */
export function projectDayBookSalesPurchases(snapshot,isAdmin=false,includeDeleted=false){
  if(typeof isAdmin!=='boolean'||typeof includeDeleted!=='boolean')
    throw new TypeError('Invalid trusted Day Book isAdmin/includeDeleted boolean');
  const inputs=sourceRows(snapshot);
  const visibleDeleted=isAdmin&&includeDeleted;
  const rows=[];
  for(const [group,idKey] of [['sales','Invoice ID'],['purchases','Purchase ID']]){
    const ids=new Set();
    for(const input of inputs[group]){
      const id=sourceId(input[idKey],group);
      if(ids.has(id))throw new TypeError('Duplicate Day Book '+group+' source reference');
      ids.add(id);
      const deleted=deletion(input);
      const paid=money(input['Paid Amount'],group+' paid');
      const common=shared(input,idKey,group,deleted);
      const method=text(input['Payment Method'],group+' payment')||'Cash';
      if(deleted&&!visibleDeleted)continue;
      if(group==='sales'){
        rows.push(sourceRow({
          ...common,time:saleTime(input.Time),
          module:'Sales',
          transactionType:text(input['Payment Type'],'sale type')+' Sale',
          party:text(input['Customer Name'],'customer name'),
          description:'POS sale'+(input['Customer Phone']?
            ' — '+text(input['Customer Phone'],'customer phone'):''),
          paymentMethod:method,
          cashIn:method==='Cash'?paid:0,
          bankIn:bankLike.has(method)?paid:0,
          status:deleted?'Deleted':text(input['Payment Status'],'payment status'),
          sourceModule:'Sales',sourceId:common.referenceNo
        }));
      }else{
        rows.push(sourceRow({
          ...common,time:'',
          module:'Purchase',
          transactionType:text(input['Payment Status'],'purchase status')+' Purchase',
          party:text(input['Supplier Name'],'supplier name'),
          description:text(input.Notes,'purchase notes')||'Stock purchase',
          paymentMethod:method,
          cashOut:method==='Cash'?paid:0,
          bankOut:bankLike.has(method)?paid:0,
          status:deleted?'Deleted':text(input['Payment Status'],'purchase status'),
          sourceModule:'Purchase',sourceId:common.referenceNo
        }));
      }
    }
  }
  return rows;
}
