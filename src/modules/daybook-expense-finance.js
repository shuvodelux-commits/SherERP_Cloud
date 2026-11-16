/**
 * M09 INTERNAL read-only original Expense + Finance Day Book rows.
 * Pinned: Mohim_ERP DayBook.gs Expense/Finance blocks, FinanceModule.gs
 * FINANCE_TRANSACTION_TYPES, and original dayBookRow_ navigation maps.
 *
 * Caller must provide complete, authorized, shop-local-normalized source
 * snapshots. No D1, financial posting, Party netting, RPC or caching.
 */
import {reportDefaultRange} from './report-date-range.js';

const BANK_METHODS=new Set(['Bank','Mobile Banking']);
const STAMP=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const FINANCE_TYPES=new Map([
  ['Owner Investment',{label:'Owner Credit',cashDirection:'in'}],
  ['Owner Withdrawal',{label:'Owner Debit',cashDirection:'out'}],
  ['Loan Received',{label:'Lender Credit',cashDirection:'in'}],
  ['Loan Repayment',{label:'Lender Debit',cashDirection:'out'}],
  ['Borrower Loan',{label:'Borrower Debit',cashDirection:'out'}],
  ['Borrower Repayment',{label:'Borrower Credit',cashDirection:'in'}],
  ['Opening Owner Capital',{label:'Opening Owner Capital',cashDirection:'none'}],
  ['Opening Loan',{label:'Opening Loan',cashDirection:'none'}],
  ['Opening Borrower Loan',{label:'Opening Borrower Loan',cashDirection:'none'}]
]);

function plainRecord(record,label){
  if(!record || typeof record!=='object' || Array.isArray(record) ||
     (Object.getPrototypeOf(record)!==Object.prototype &&
      Object.getPrototypeOf(record)!==null))
    throw new TypeError('Invalid trusted Day Book '+label+' record');
  const out=Object.create(null);
  const fields=Object.getOwnPropertyDescriptors(record);
  for(const key of Reflect.ownKeys(fields)){
    const desc=fields[key];
    if(typeof key!=='string'||!Object.hasOwn(desc,'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' accessor');
    const value=desc.value;
    if(value!==undefined&&value!==null&&
      !['string','number','boolean'].includes(typeof value))
      throw new TypeError('Invalid trusted Day Book '+label+' scalar');
    if(typeof value==='number'&&!Number.isFinite(value))
      throw new TypeError('Invalid finite Day Book '+label+' scalar');
    out[key]=value;
  }
  return out;
}
function completeSnapshot(snapshot){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||
    (Object.getPrototypeOf(snapshot)!==Object.prototype &&
     Object.getPrototypeOf(snapshot)!==null))
    throw new TypeError('Invalid trusted Day Book Expense Finance snapshot');
  const desc=Object.getOwnPropertyDescriptors(snapshot);
  if(Reflect.ownKeys(desc).length!==2 ||
    Reflect.ownKeys(desc).some(key=>typeof key!=='string' ||
      !['expenses','financeTransactions'].includes(key) ||
      !Object.hasOwn(desc[key],'value')))
    throw new TypeError('Invalid trusted Day Book Expense Finance snapshot groups');
  const out=Object.create(null);
  for(const key of ['expenses','financeTransactions']){
    const values=desc[key].value;
    if(!Array.isArray(values))
      throw new TypeError('Invalid trusted Day Book '+key+' array');
    const fields=Object.getOwnPropertyDescriptors(values);
    if(Reflect.ownKeys(fields).length!==values.length+1 ||
      Reflect.ownKeys(fields).some(k=>k!=='length' &&
        (typeof k!=='string'||!/^(?:0|[1-9]\d*)$/.test(k)||
          !Object.hasOwn(fields[k],'value'))))
      throw new TypeError('Invalid trusted Day Book '+key+' array fields');
    out[key]=Array.from(values,row=>plainRecord(row,key));
  }
  return out;
}
function text(value,label){
  if(value===null||value===undefined||value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid trusted Day Book '+label+' field');
  return value;
}
function sourceId(value,label){
  const id=text(value,label);
  if(!id||id in Object.prototype)
    throw new TypeError('Invalid unsafe Day Book '+label+' source reference');
  return id;
}
function finiteAmount(value,label){
  if(value===undefined||value===null||value==='')return 0;
  if(typeof value!=='string'&&typeof value!=='number')
    throw new TypeError('Invalid Day Book '+label+' amount');
  const num=Number(value);
  if(!Number.isFinite(num))
    throw new TypeError('Invalid finite Day Book '+label+' amount');
  return num;
}
function businessDate(value,label){
  if(typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' date');
  reportDefaultRange(value);
  return value;
}
function sourceTimestamp(value,date,label,{fallback=false}={}){
  if(fallback && (value===null||value===undefined||value===''))return date;
  if(typeof value!=='string'||!STAMP.test(value))
    throw new TypeError('Invalid Day Book '+label+' timestamp');
  businessDate(value.slice(0,10),label);
  return value;
}
function isDeleted(record){
  const value=record['Is Deleted'];
  if(value===undefined||value===null||value===''||
    value===false||value==='FALSE')return false;
  if(value===true||value==='TRUE')return true;
  throw new TypeError('Invalid trusted Day Book delete flag');
}
function flags(record){
  return {
    isBackdated:!!record['Is Backdated'],
    backdatedDays:finiteAmount(record['Backdated Days'],'backdated days'),
    backdatedReason:text(record['Backdated Reason'],'backdated reason')
  };
}
function sourceRow(o){
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
    openPage:o.sourceModule==='Expense'?'expenseList':'financeLedger',
    openId:o.openId||o.sourceId||'',
    deleteModule:o.sourceModule==='Expense'?'expense':'finance',
    deleteId:o.deleteId||o.sourceId||''
  };
}
function common(record,idKey,module,deleted,{fallbackTimestamp=false}={}){
  const id=sourceId(record[idKey],module);
  const date=businessDate(record.Date,module);
  return {
    ts:sourceTimestamp(record['Created At'],date,module,{fallback:fallbackTimestamp}),
    date,referenceNo:id,sourceModule:module,sourceId:id,
    createdBy:text(record['Created By'],module+' Created By'),
    isDeleted:deleted,
    deletedBy:text(record['Deleted By'],module+' Deleted By'),
    deleteReason:text(record['Delete Reason'],module+' Delete Reason'),
    ...flags(record)
  };
}

/** Exact source order: all Expense documents followed by Finance entries. */
export function projectDayBookExpenseFinanceRows(snapshot,isAdmin=false,includeDeleted=false){
  if(typeof isAdmin!=='boolean'||typeof includeDeleted!=='boolean')
    throw new TypeError('Invalid trusted Day Book isAdmin/includeDeleted boolean');
  const inputs=completeSnapshot(snapshot);
  const showDeleted=isAdmin&&includeDeleted;
  const rows=[];
  const seenExpense=new Set();
  for(const record of inputs.expenses){
    const id=sourceId(record['Expense ID'],'Expense');
    if(seenExpense.has(id))throw new TypeError('Duplicate Day Book Expense source reference');
    seenExpense.add(id);
    const wasDeleted=isDeleted(record);
    const original=common(record,'Expense ID','Expense',wasDeleted);
    const cancelled=record.Status==='Cancelled';
    const method=text(record['Payment Method'],'Expense payment method')||'Cash';
    const amount=finiteAmount(record.Amount,'Expense');
    const live=!cancelled&&!wasDeleted;
    if(wasDeleted&&!showDeleted)continue;
    rows.push(sourceRow({
      ...original,module:'Expense',
      transactionType:text(record['Category Name'],'Expense category')||'Expense',
      party:text(record['Ledger Name'],'Expense ledger name'),
      description:text(record.Description,'Expense description'),
      paymentMethod:method,
      cashOut:live&&method==='Cash'?amount:0,
      bankOut:live&&BANK_METHODS.has(method)?amount:0,
      status:wasDeleted?'Deleted':cancelled?'Cancelled':'Active'
    }));
  }
  const seenFinance=new Set();
  for(const record of inputs.financeTransactions){
    const id=sourceId(record['Finance ID'],'Finance');
    if(seenFinance.has(id))throw new TypeError('Duplicate Day Book Finance source reference');
    seenFinance.add(id);
    const wasDeleted=isDeleted(record);
    const original=common(record,'Finance ID','Finance',wasDeleted,{fallbackTimestamp:true});
    const rawType=text(record['Transaction Type'],'Finance Transaction Type');
    const type=FINANCE_TYPES.get(rawType);
    const direction=type?.cashDirection||'none';
    const method=direction==='none'?'':text(record['Payment Method'],'Finance payment method')||'Cash';
    const amount=finiteAmount(record.Amount,'Finance');
    const isIn=direction==='in',isOut=direction==='out';
    const label=type?.label||rawType;
    const notes=text(record.Notes,'Finance notes')||(type?.label||'Finance entry');
    const ref=text(record['Reference No'],'Finance Reference No');
    if(wasDeleted&&!showDeleted)continue;
    rows.push(sourceRow({
      ...original,module:'Finance',transactionType:label,
      party:text(record.Person,'Finance Person'),
      description:notes+(ref?' — '+ref:''),
      paymentMethod:method,
      cashIn:method==='Cash'&&isIn?amount:0,
      cashOut:method==='Cash'&&isOut?amount:0,
      bankIn:BANK_METHODS.has(method)&&isIn?amount:0,
      bankOut:BANK_METHODS.has(method)&&isOut?amount:0,
      status:wasDeleted?'Deleted':'Active'
    }));
  }
  return rows;
}
