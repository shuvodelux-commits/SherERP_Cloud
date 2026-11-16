/**
 * M09 INTERNAL, READ-ONLY source-shaped Bank Transfer and Stock Adjustment
 * Day Book display rows. Frozen Mohim_ERP DayBook.gs source blocks.
 *
 * Input is two complete, pre-authorized, shop-local-normalized source lists.
 * This is NOT a D1 reader, posting engine, valuation, RPC or auth gate.
 */
import {reportDefaultRange} from './report-date-range.js';

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const STAMP=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const GROUPS=['bankTransfers','stockMovements'];

function ownRecord(value,label){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     (Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book '+label+' record');
  const result=Object.create(null);
  const fields=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(fields)){
    const entry=fields[key];
    if(typeof key!=='string' || !Object.hasOwn(entry,'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' accessor');
    const scalar=entry.value;
    if(scalar!==undefined && scalar!==null &&
       !['string','number','boolean'].includes(typeof scalar))
      throw new TypeError('Invalid trusted Day Book '+label+' field');
    if(typeof scalar==='number' && !Number.isFinite(scalar))
      throw new TypeError('Invalid finite Day Book '+label+' value');
    result[key]=scalar;
  }
  return result;
}
function completeSnapshot(value){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype &&
     Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book transfer/stock snapshot');
  const fields=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(fields).length!==GROUPS.length ||
    Reflect.ownKeys(fields).some(key=>typeof key!=='string' ||
      !GROUPS.includes(key) || !Object.hasOwn(fields[key],'value')))
    throw new TypeError('Invalid trusted Day Book transfer/stock snapshot groups');
  const result=Object.create(null);
  for(const group of GROUPS){
    const list=fields[group].value;
    if(!Array.isArray(list))
      throw new TypeError('Invalid trusted Day Book '+group+' array');
    const keys=Object.getOwnPropertyDescriptors(list);
    if(Reflect.ownKeys(keys).length!==list.length+1 ||
      Reflect.ownKeys(keys).some(k=>k!=='length' &&
        (typeof k!=='string' || !/^(?:0|[1-9]\d*)$/.test(k) ||
         !Object.hasOwn(keys[k],'value'))))
      throw new TypeError('Invalid trusted Day Book '+group+' array fields');
    result[group]=Array.from(list,item=>ownRecord(item,group));
  }
  return result;
}
function sourceText(value,label){
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid trusted Day Book '+label+' text');
  return value;
}
function sourceId(value,label,required=false){
  const id=sourceText(value,label);
  if((required&&!id) || (id && id in Object.prototype))
    throw new TypeError('Invalid unsafe Day Book '+label+' reference');
  return id;
}
function finiteQuantity(value,label){
  if(value===undefined || value===null || value==='')return 0;
  if(typeof value!=='number' && typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' quantity');
  const parsed=Number(value);
  if(!Number.isFinite(parsed))
    throw new TypeError('Invalid finite Day Book '+label+' quantity');
  return parsed;
}
/** Canonical upstream normalization. No timezone parsing or ambient clock. */
function sourceDateTime(value,label){
  if(typeof value!=='string' || (!DATE.test(value) && !STAMP.test(value)))
    throw new TypeError('Invalid Day Book '+label+' date/timestamp');
  reportDefaultRange(value.slice(0,10));
  return value;
}
function dayBookRow(o){
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
    openPage:o.sourceModule==='Bank Transfer'?'bank':'products',
    openId:o.openId||o.sourceId||'',
    deleteModule:'',deleteId:o.deleteId||o.sourceId||''
  };
}

/**
 * One bank-transfer header and each Adjust-type stock movement in original
 * section/input order. Both are always zero-money display transactions.
 */
export function projectDayBookTransferStockRows(snapshot){
  const data=completeSnapshot(snapshot);
  const rows=[];
  const transferIds=new Set();
  for(const record of data.bankTransfers){
    const id=sourceId(record['Transfer ID'],'Bank Transfer ID');
    if(id && transferIds.has(id))
      throw new TypeError('Duplicate Day Book Bank Transfer source reference');
    if(id)transferIds.add(id);
    const date=sourceDateTime(record.Date,'Bank Transfer');
    const created=record['Created At']===undefined||record['Created At']===null||
      record['Created At']===''?date:sourceDateTime(record['Created At'],'Bank Transfer');
    const from=sourceText(record['From Account Name'],'From Account Name');
    const to=sourceText(record['To Account Name'],'To Account Name');
    rows.push(dayBookRow({
      ts:created,date:date.slice(0,10),
      referenceNo:id,module:'Bank Transfer',
      transactionType:'Bank Transfer',party:from+' → '+to,
      description:sourceText(record.Notes,'Bank Transfer Notes')||'Transfer between accounts',
      paymentMethod:'Bank',createdBy:sourceText(record['Created By'],'Bank Transfer Created By'),
      status:'Active',sourceModule:'Bank Transfer',sourceId:id
    }));
  }
  const movementIds=new Set();
  for(const record of data.stockMovements){
    // Exact pinned GAS predicate: String(Type || '').indexOf('Adjust') !== -1
    if(String(record.Type||'').indexOf('Adjust')===-1)continue;
    const id=sourceId(record['Movement ID'],'Stock Movement ID',true);
    if(movementIds.has(id))
      throw new TypeError('Duplicate Day Book Stock Adjustment source reference');
    movementIds.add(id);
    const productId=sourceId(record['Product ID'],'Stock Product ID');
    const date=sourceDateTime(record.Date,'Stock Adjustment');
    const qtyIn=finiteQuantity(record['Quantity In'],'Stock Quantity In');
    const qtyOut=finiteQuantity(record['Quantity Out'],'Stock Quantity Out');
    const notes=sourceText(record.Notes,'Stock Notes')||'Stock adjusted';
    rows.push(dayBookRow({
      ts:date,date:date.slice(0,10),
      referenceNo:id,module:'Stock Adjustment',
      transactionType:sourceText(record.Type,'Stock Type')||'Stock Adjustment',
      party:sourceText(record['Product Name'],'Stock Product Name'),
      description:notes+' ('+(qtyIn?'+'+qtyIn:'-'+qtyOut)+')',
      paymentMethod:'',status:'Active',
      sourceModule:'Stock Adjustment',sourceId:productId
    }));
  }
  return rows;
}
