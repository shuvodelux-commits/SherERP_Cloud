/**
 * M09 INTERNAL, READ-ONLY standalone Bank Book Day Book row projection.
 * Pinned source: Mohim_ERP DayBook.gs::ownedReferences_,
 * getDayBookTransactions (Standalone bank activity) and dayBookRow_.
 *
 * Caller MUST supply complete already-authorized/source-filtered document
 * arrays, full Bank Book and dates normalized to business YYYY-MM-DD.
 * There is no D1 query, permission check, cash movement or public RPC here.
 */
import {reportDefaultRange} from './report-date-range.js';

const GROUPS=Object.freeze([
  'sales','purchases','expenses','customerPayments',
  'customerAdvanceRefunds','supplierPayments','financeTransactions',
  'bankTransfers','bankEntries'
]);

function plainRecord(value,label){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype &&
     Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book '+label);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  const copy=Object.create(null);
  for(const key of Reflect.ownKeys(descriptors)){
    const field=descriptors[key];
    if(typeof key!=='string' || !Object.hasOwn(field,'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' accessor/key');
    const item=field.value;
    if(item!==null && item!==undefined &&
       !['string','number','boolean'].includes(typeof item))
      throw new TypeError('Invalid trusted Day Book '+label+' scalar');
    if(typeof item==='number' && !Number.isFinite(item))
      throw new TypeError('Invalid finite Day Book '+label+' scalar');
    copy[key]=item;
  }
  return copy;
}

function completeSnapshot(snapshot){
  if(!snapshot || typeof snapshot!=='object' || Array.isArray(snapshot) ||
    (Object.getPrototypeOf(snapshot)!==Object.prototype &&
     Object.getPrototypeOf(snapshot)!==null))
    throw new TypeError('Invalid trusted Day Book snapshot');
  const descriptors=Object.getOwnPropertyDescriptors(snapshot);
  const keys=Reflect.ownKeys(descriptors);
  if(keys.length!==GROUPS.length || keys.some(key=>typeof key!=='string' ||
    !GROUPS.includes(key) || !Object.hasOwn(descriptors[key],'value')))
    throw new TypeError('Invalid trusted Day Book snapshot groups');
  const result=Object.create(null);
  for(const group of GROUPS){
    const value=descriptors[group].value;
    if(!Array.isArray(value))
      throw new TypeError('Invalid trusted Day Book snapshot array: '+group);
    const elements=Object.getOwnPropertyDescriptors(value);
    for(const [key,field] of Object.entries(elements)){
      if(key==='length')continue;
      if(!/^(?:0|[1-9]\d*)$/.test(key) || !Object.hasOwn(field,'value'))
        throw new TypeError('Invalid trusted Day Book snapshot array field');
    }
    result[group]=Array.from(value,record=>plainRecord(record,group+' row'));
  }
  return result;
}

function safeId(value,label){
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string' &&
     !(typeof value==='number' && Number.isFinite(value)))
    throw new TypeError('Invalid Day Book '+label+' reference');
  const id=String(value);
  // The pinned GAS used a normal {} index; inherited names can impersonate
  // an owned reference. Fail closed instead of silently losing bank money.
  if(id in Object.prototype)
    throw new TypeError('Unsafe Day Book '+label+' reference');
  return id;
}
function textField(row,key){
  const value=row[key];
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid Day Book Bank '+key);
  return value;
}
function amount(row,key){
  const value=row[key];
  if(value===undefined || value===null || value==='')return 0;
  if(typeof value!=='number' && typeof value!=='string')
    throw new TypeError('Invalid Day Book Bank money '+key);
  const parsed=Number(value);
  if(!Number.isFinite(parsed))
    throw new TypeError('Invalid finite Day Book Bank money '+key);
  return parsed;
}

function ownedReferences(source){
  const owned=new Set();
  const add=(group,column)=>{
    for(const row of source[group]){
      const id=safeId(row[column],group+' '+column);
      if(id)owned.add(id);
    }
  };
  add('sales','Invoice ID');
  add('purchases','Purchase ID');
  add('expenses','Expense ID');
  add('customerPayments','Ledger ID');
  add('customerPayments','Customer ID');
  add('customerAdvanceRefunds','Ledger ID');
  add('customerAdvanceRefunds','Customer ID');
  add('supplierPayments','Ledger ID');
  add('supplierPayments','Supplier ID');
  add('financeTransactions','Finance ID');
  add('bankTransfers','Transfer ID');
  return owned;
}

function validatedBankRows(entries){
  const ids=new Set();
  return entries.map(entry=>{
    const id=safeId(entry['Entry ID'],'Bank Entry ID');
    if(!id || ids.has(id))
      throw new TypeError('Invalid or duplicate Day Book Bank Entry ID');
    ids.add(id);
    const date=textField(entry,'Date');
    if(!date)throw new TypeError('Invalid Day Book Bank business date');
    reportDefaultRange(date); // Canonical calendar YYYY-MM-DD; never reparse timestamps.
    for(const field of ['Reference','Reversal Of']){
      safeId(entry[field],'Bank '+field);
    }
    for(const field of ['Status','Created At','Type','Bank Account Name',
      'Description','Created By','Notes','Backdated Reason']){
      textField(entry,field);
    }
    amount(entry,'Credit');
    amount(entry,'Debit');
    amount(entry,'Backdated Days');
    return entry;
  });
}

/**
 * Return only source-shaped standalone Bank rows, in raw Bank Book order.
 * isAdmin must be the upstream authenticated actor's literal boolean;
 * includeDeleted alone is never permission.
 */
export function projectDayBookBankRows(snapshot,isAdmin=false,includeDeleted=false){
  if(typeof isAdmin!=='boolean' || typeof includeDeleted!=='boolean')
    throw new TypeError('Invalid trusted Day Book actor/includeDeleted boolean');
  const source=completeSnapshot(snapshot);
  const owned=ownedReferences(source);
  const banks=validatedBankRows(source.bankEntries);
  const reversalTargets=new Set();
  for(const entry of banks){
    const target=safeId(entry['Reversal Of'],'Bank reversal target');
    if(target)reversalTargets.add(target);
  }
  const result=[];
  for(const entry of banks){
    const ref=safeId(entry.Reference,'Bank Reference');
    if(ref && owned.has(ref))continue;
    const id=safeId(entry['Entry ID'],'Bank Entry ID');
    const manuallyReversed=entry.Status==='Reversed' && reversalTargets.has(id);
    const deleteVoided=entry.Status==='Reversed' && !manuallyReversed;
    if(deleteVoided && !(isAdmin && includeDeleted))continue;
    const bankIn=deleteVoided?0:amount(entry,'Credit');
    const bankOut=deleteVoided?0:amount(entry,'Debit');
    // Exact original DayBook.gs::dayBookRow_ property order and Bank mapping.
    result.push({
      ts:textField(entry,'Created At') || entry.Date,
      date:entry.Date,
      time:'',
      referenceNo:id,
      module:'Bank',
      transactionType:textField(entry,'Type') || 'Bank Entry',
      party:textField(entry,'Bank Account Name'),
      description:textField(entry,'Description'),
      paymentMethod:'Bank',
      cashIn:0,
      cashOut:0,
      bankIn,
      bankOut,
      amount:bankIn-bankOut,
      createdBy:textField(entry,'Created By'),
      status:deleteVoided?'Deleted':(manuallyReversed?'Reversed':'Active'),
      isDeleted:deleteVoided,
      deletedBy:'',
      deleteReason:textField(entry,'Notes'),
      isBackdated:!!entry['Is Backdated'],
      backdatedDays:amount(entry,'Backdated Days'),
      backdatedReason:textField(entry,'Backdated Reason'),
      sourceModule:'Bank',
      sourceId:id,
      openPage:'bank',
      openId:id,
      deleteModule:'bank',
      deleteId:id
    });
  }
  return result;
}
