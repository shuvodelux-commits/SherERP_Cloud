/**
 * M09 INTERNAL read-only Day Book Party settlement row projection.
 * Frozen source: Mohim_ERP DayBook.gs Customer/Supplier Payment and
 * Customer Advance Refund sections, SettlementDiscount.gs and Utils.gs.
 *
 * Requires complete, already authorized, shop-local-normalized source ledgers.
 * No D1 queries, postings, Cash Session, public RPC or Party role offset.
 */
import {reportDefaultRange} from './report-date-range.js';

const GROUPS=['customerLedgerRows','supplierLedgerRows'];
const TIMESTAMP=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const BANK_METHODS=new Set(['Bank','Mobile Banking']);
const roundMoney=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;

function copyRow(record,label){
  if(!record || typeof record!=='object' || Array.isArray(record) ||
    (Object.getPrototypeOf(record)!==Object.prototype &&
     Object.getPrototypeOf(record)!==null))
    throw new TypeError('Invalid trusted Day Book '+label+' source record');
  const result=Object.create(null);
  const fields=Object.getOwnPropertyDescriptors(record);
  for(const key of Reflect.ownKeys(fields)){
    const field=fields[key];
    if(typeof key!=='string' || !Object.hasOwn(field,'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' accessor/key');
    const value=field.value;
    if(value!==null && value!==undefined &&
      !['string','number','boolean'].includes(typeof value))
      throw new TypeError('Invalid trusted Day Book '+label+' scalar');
    if(typeof value==='number' && !Number.isFinite(value))
      throw new TypeError('Invalid finite Day Book '+label+' scalar');
    result[key]=value;
  }
  return result;
}

function completeSnapshot(snapshot){
  if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot) ||
    (Object.getPrototypeOf(snapshot)!==Object.prototype &&
     Object.getPrototypeOf(snapshot)!==null))
    throw new TypeError('Invalid trusted Day Book settlement snapshot');
  const desc=Object.getOwnPropertyDescriptors(snapshot);
  if(Reflect.ownKeys(desc).length!==GROUPS.length ||
    Reflect.ownKeys(desc).some(key=>typeof key!=='string' ||
      !GROUPS.includes(key) || !Object.hasOwn(desc[key],'value')))
    throw new TypeError('Invalid trusted Day Book settlement source groups');
  const result=Object.create(null);
  for(const group of GROUPS){
    const values=desc[group].value;
    if(!Array.isArray(values))
      throw new TypeError('Invalid trusted Day Book settlement '+group+' array');
    const fields=Object.getOwnPropertyDescriptors(values);
    if(Reflect.ownKeys(fields).length!==values.length+1 ||
      Reflect.ownKeys(fields).some(key=>key!=='length' &&
        (typeof key!=='string' || !/^(?:0|[1-9]\d*)$/.test(key) ||
         !Object.hasOwn(fields[key],'value'))))
      throw new TypeError('Invalid trusted Day Book '+group+' source array field');
    result[group]=Array.from(values,row=>copyRow(row,group));
  }
  return result;
}

function textField(value,label){
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid trusted Day Book '+label+' field');
  return value;
}
function safeId(value,label,{required=true}={}){
  const id=textField(value,label);
  if(required && !id)throw new TypeError('Invalid Day Book '+label+' reference');
  if(id && id in Object.prototype)
    throw new TypeError('Unsafe Day Book '+label+' reference');
  return id;
}
function cashNumber(value,label){
  if(value===undefined || value===null || value==='')return 0;
  if(typeof value!=='string' && typeof value!=='number')
    throw new TypeError('Invalid trusted Day Book '+label+' money');
  const number=Number(value);
  if(!Number.isFinite(number))
    throw new TypeError('Invalid finite Day Book '+label+' money');
  return number;
}
function canonicalDate(value,label){
  if(typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' date');
  reportDefaultRange(value);
  return value;
}
function createdAt(value,date,label){
  if(value===undefined || value===null || value==='')return date;
  if(typeof value!=='string'||!TIMESTAMP.test(value))
    throw new TypeError('Invalid Day Book '+label+' timestamp');
  canonicalDate(value.slice(0,10),label);
  return value;
}
function deleted(record){
  const raw=record['Is Deleted'];
  if(raw===undefined || raw===null || raw==='' || raw===false || raw==='FALSE')
    return false;
  if(raw===true || raw==='TRUE')return true;
  throw new TypeError('Invalid trusted Day Book delete flag');
}
function backdated(record){
  return {
    isBackdated:!!record['Is Backdated'],
    backdatedDays:cashNumber(record['Backdated Days'],'backdated days'),
    backdatedReason:textField(record['Backdated Reason'],'backdated reason')
  };
}
function settlementMoney(record){
  const payment=record['Payment Amount'];
  const raw=payment===undefined || payment===null || payment===''?
    record.Credit:payment;
  return roundMoney(cashNumber(raw,'settlement Payment Amount/Credit'));
}
function settlementDiscount(record){
  return roundMoney(cashNumber(record['Discount Amount'],'Discount Amount'));
}
function advanceRefundMoney(record){
  return cashNumber(record.Debit,'Advance Refund Debit') ||
    cashNumber(record['Payment Amount'],'Advance Refund Payment Amount') || 0;
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
    openPage:o.sourceModule==='Customer Payment'?'customers':
      o.sourceModule==='Customer Advance Refund'?'customerLedger':'suppliers',
    openId:o.openId||o.sourceId||'',
    deleteModule:o.sourceModule==='Customer Payment'?'customer payment':
      o.sourceModule==='Supplier Payment'?'supplier payment':'',
    deleteId:o.deleteId||o.sourceId||''
  };
}
function common(record,module,personIdField,wasDeleted){
  const id=safeId(record['Ledger ID'],module+' Ledger ID');
  const personId=safeId(record[personIdField],module+' party ID',{required:false});
  const date=canonicalDate(record.Date,module);
  return {
    ts:createdAt(record['Created At'],date,module),
    date,referenceNo:id,sourceModule:module,sourceId:id,openId:personId,
    createdBy:textField(record['Created By'],module+' actor'),
    status:wasDeleted?'Deleted':'Active',isDeleted:wasDeleted,
    deletedBy:textField(record['Deleted By'],module+' deletedBy'),
    deleteReason:textField(record['Delete Reason'],module+' deletion reason'),
    ...backdated(record)
  };
}

/** Source section order: Customer Payment, Advance Refund, Supplier Payment. */
export function projectDayBookPartySettlements(snapshot,isAdmin=false,includeDeleted=false){
  if(typeof isAdmin!=='boolean' || typeof includeDeleted!=='boolean')
    throw new TypeError('Invalid trusted Day Book isAdmin/includeDeleted boolean');
  const source=completeSnapshot(snapshot);
  const showDeleted=isAdmin&&includeDeleted;
  const rows=[];
  const seen={customerLedgerRows:new Set(),supplierLedgerRows:new Set()};
  const sections=[
    {group:'customerLedgerRows',type:'Payment',module:'Customer Payment',
      partyKey:'Customer ID',nameKey:'Customer Name',description:'Payment received'},
    {group:'customerLedgerRows',type:'Advance Refund',module:'Customer Advance Refund',
      partyKey:'Customer ID',nameKey:'Customer Name',description:'Customer advance refunded'},
    {group:'supplierLedgerRows',type:'Payment',module:'Supplier Payment',
      partyKey:'Supplier ID',nameKey:'Supplier Name',description:'Payment made'}
  ];

  for(const s of sections){
    for(const record of source[s.group]){
      if(record.Type!==s.type)continue;
      const id=safeId(record['Ledger ID'],s.module);
      if(seen[s.group].has(id))
        throw new TypeError('Duplicate Day Book '+s.module+' source reference');
      seen[s.group].add(id);
      const wasDeleted=deleted(record);
      const base=common(record,s.module,s.partyKey,wasDeleted);
      const method=textField(record['Payment Method'],s.module+' Payment Method')||'Cash';
      const note=textField(record.Notes,s.module+' Notes')||s.description;
      const amount=s.type==='Advance Refund'?
        advanceRefundMoney(record):settlementMoney(record);
      const discount=s.type==='Advance Refund'?0:settlementDiscount(record);
      const desc=note+(discount>0?' — Discount '+discount:'');
      if(wasDeleted&&!showDeleted)continue;
      rows.push(dayBookRow({
        ...base,
        module:s.module,transactionType:
          s.module==='Customer Payment'?'Due Collection':
          s.module==='Customer Advance Refund'?'Advance Refund':'Due Payment',
        party:textField(record[s.nameKey],s.module+' name'),
        description:desc,paymentMethod:method,
        cashIn:s.module==='Customer Payment'&&method==='Cash'?amount:0,
        cashOut:s.module!=='Customer Payment'&&method==='Cash'?amount:0,
        bankIn:s.module==='Customer Payment'&&BANK_METHODS.has(method)?amount:0,
        bankOut:s.module!=='Customer Payment'&&BANK_METHODS.has(method)?amount:0
      }));
    }
  }
  return rows;
}
