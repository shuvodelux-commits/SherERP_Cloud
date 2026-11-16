/**
 * M09 INTERNAL source-shaped Sales/Purchase Return Day Book rows.
 * Pinned source: Mohim_ERP DayBook.gs Sales Returns/Purchase Returns blocks,
 * dayBookRow_, and original navigation/deletion maps.
 *
 * Caller supplies full, pre-authorized and shop-local-normalized snapshots.
 * This pure projection never reads/writes D1, posts refunds or enables RPC.
 */
import {reportDefaultRange} from './report-date-range.js';

const GROUPS=['salesReturns','purchaseReturns','supplierLedgerRows'];
const TIMESTAMP=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

function plainRecord(value,label) {
  if(value===null || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book '+label+' record');
  const out=Object.create(null);
  for(const key of Reflect.ownKeys(value)){
    const desc=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string' || !desc || !Object.hasOwn(desc,'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' accessor/key');
    const content=desc.value;
    if(content!==null && content!==undefined &&
      !['string','number','boolean'].includes(typeof content))
      throw new TypeError('Invalid trusted Day Book '+label+' scalar');
    if(typeof content==='number' && !Number.isFinite(content))
      throw new TypeError('Invalid finite Day Book '+label+' scalar');
    out[key]=content;
  }
  return out;
}

function completeSnapshot(snapshot){
  if(snapshot===null || typeof snapshot!=='object' || Array.isArray(snapshot) ||
    (Object.getPrototypeOf(snapshot)!==Object.prototype &&
      Object.getPrototypeOf(snapshot)!==null))
    throw new TypeError('Invalid trusted Day Book Return snapshot');
  const desc=Object.getOwnPropertyDescriptors(snapshot);
  if(Reflect.ownKeys(desc).length!==GROUPS.length ||
    Reflect.ownKeys(desc).some(key=>typeof key!=='string' || !GROUPS.includes(key) ||
      !Object.hasOwn(desc[key],'value')))
    throw new TypeError('Invalid trusted Day Book Return snapshot groups');
  const result=Object.create(null);
  for(const key of GROUPS){
    const values=desc[key].value;
    if(!Array.isArray(values))
      throw new TypeError('Invalid trusted Day Book '+key+' array');
    const fields=Object.getOwnPropertyDescriptors(values);
    if(Reflect.ownKeys(fields).length!==values.length+1 ||
      Reflect.ownKeys(fields).some(k=>k!=='length' &&
        (typeof k!=='string' || !/^(?:0|[1-9]\d*)$/.test(k) ||
          !Object.hasOwn(fields[k],'value'))))
      throw new TypeError('Invalid trusted Day Book '+key+' array fields');
    result[key]=Array.from(values,v=>plainRecord(v,key));
  }
  return result;
}

function text(value,label) {
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid trusted Day Book '+label+' text');
  return value;
}
function sourceRef(value,label,{required=true}={}){
  const id=text(value,label);
  if(required && !id)throw new TypeError('Invalid Day Book '+label+' reference');
  // GAS used {} reference maps: names on Object.prototype could incorrectly
  // classify a cash Purchase Return as Supplier Credit.
  if(id && id in Object.prototype)
    throw new TypeError('Unsafe Day Book '+label+' reference');
  return id;
}
function amount(value,label){
  if(value===undefined || value===null || value==='')return 0;
  if(typeof value!=='number' && typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' amount');
  const n=Number(value);
  if(!Number.isFinite(n))throw new TypeError('Invalid finite Day Book '+label+' amount');
  return n;
}
function day(value,label){
  if(typeof value!=='string')
    throw new TypeError('Invalid Day Book '+label+' date');
  reportDefaultRange(value);
  return value;
}
function createdAt(value,label){
  if(typeof value!=='string' || !TIMESTAMP.test(value))
    throw new TypeError('Invalid Day Book '+label+' timestamp');
  day(value.slice(0,10),label);
  return value;
}
function deleted(record){
  const value=record['Is Deleted'];
  if(value===undefined || value===null || value==='')return false;
  if(value==='TRUE' || value===true)return true;
  if(value==='FALSE' || value===false)return false;
  throw new TypeError('Invalid trusted Day Book deleted flag');
}
function backdated(record){
  return {
    isBackdated:!!record['Is Backdated'],
    backdatedDays:amount(record['Backdated Days'],'backdated days'),
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
    openPage:o.sourceModule==='Sales Return'?'returnHistory':'returns',
    openId:o.openId||o.sourceId||'',
    deleteModule:o.sourceModule==='Sales Return'?'sales return':'',
    deleteId:o.deleteId||o.sourceId||''
  };
}
function common(record,sourceModule,idKey,parentKey,deletedFlag){
  const id=sourceRef(record[idKey],sourceModule);
  const original=sourceRef(record[parentKey],sourceModule+' original');
  return {
    ts:createdAt(record['Created At'],sourceModule),
    date:day(record.Date,sourceModule),
    referenceNo:id,
    sourceModule,sourceId:id,openId:original,
    createdBy:text(record['Processed By'],sourceModule+' actor'),
    isDeleted:deletedFlag,
    deletedBy:text(record['Deleted By'],sourceModule+' deletedBy'),
    deleteReason:text(record['Delete Reason'],sourceModule+' deletion reason'),
    status:deletedFlag?'Deleted':'Active',
    ...backdated(record)
  };
}

/**
 * Return original source-shaped Sales Returns then Purchase Returns.
 * These are display rows, NOT permission checks or accounting postings.
 */
export function projectDayBookReturnRows(snapshot,isAdmin=false,includeDeleted=false){
  if(typeof isAdmin!=='boolean' || typeof includeDeleted!=='boolean')
    throw new TypeError('Invalid trusted Day Book isAdmin/includeDeleted boolean');
  const records=completeSnapshot(snapshot);
  const visibleDeleted=isAdmin&&includeDeleted;

  // Source examines all Supplier Ledger rows, including deleted ones.
  const creditRefs=new Set();
  for(const ledger of records.supplierLedgerRows){
    const type=text(ledger.Type,'supplier ledger type');
    const ref=sourceRef(ledger.Reference,'supplier ledger',{required:type==='Purchase Return Credit'});
    if(type==='Purchase Return Credit')creditRefs.add(ref);
  }

  const rows=[];
  const groups=[
    ['salesReturns','Sales Return','Invoice ID'],
    ['purchaseReturns','Purchase Return','Purchase ID']
  ];
  for(const [group,module,parentKey] of groups){
    const ids=new Set();
    for(const record of records[group]){
      const id=sourceRef(record['Return ID'],module);
      if(ids.has(id))throw new TypeError('Duplicate Day Book '+module+' source reference');
      ids.add(id);
      const isDeleted=deleted(record);
      const value=amount(record['Total Return Amount'],module);
      const commonFields=common(record,module,'Return ID',parentKey,isDeleted);
      const reason=text(record.Reason,module+' reason');
      const description='Return against '+commonFields.openId+(reason?' — '+reason:'');
      if(isDeleted&&!visibleDeleted)continue;
      if(group==='salesReturns'){
        const method=text(record['Refund Method'],'Sales Return refund')||'Cash';
        rows.push(sourceRow({
          ...commonFields,
          module,transactionType:method+' Refund',
          party:text(record['Customer Name'],'Sales Return customer'),
          description,
          paymentMethod:method==='Cash'?'Cash':(method==='Bank'?'Bank':'Store Credit'),
          cashOut:method==='Cash'?value:0,
          bankOut:method==='Bank'?value:0
        }));
      }else{
        const isCash=!creditRefs.has(id);
        rows.push(sourceRow({
          ...commonFields,
          module,transactionType:'Purchase Return',
          party:text(record['Supplier Name'],'Purchase Return supplier'),
          description,
          paymentMethod:isCash?'Cash':'Supplier Credit',
          cashIn:isCash?value:0
        }));
      }
    }
  }
  return rows;
}
