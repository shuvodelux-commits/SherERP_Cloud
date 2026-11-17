/**
 * M08 TEST ONLY: bank source records from tenant-bound local Workerd D1.
 * Reuses original GAS-verified pure Bank Ledger calculator; no cash posting,
 * bank transfer, public Worker route, remote D1 or schema migration.
 */
import {
  bankStatement,bankCurrentBalance,totalActiveBankBalance
} from '../../src/modules/m08-bank-read-model.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const BANK_ACCOUNTS=String.raw`
  SELECT legacy_row,account_id,account_name,bank_name,account_number,
         opening_cents,current_cents,status,account_type
  FROM m08_bank_accounts WHERE tenant_id=?
  ORDER BY legacy_row
`;
const BANK_BOOK=String.raw`
  SELECT legacy_row,entry_id,account_id,date_text,type,reference,
         description,debit_cents,credit_cents,status,reversal_of,
         notes,created_by,created_at,is_backdated,backdated_days,backdated_reason
  FROM m08_bank_book WHERE tenant_id=?
  ORDER BY legacy_row
`;

function validate(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     (Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid local M08 Bank Ledger request');
  const keys=Reflect.ownKeys(value);
  const required=['accountId','from','tenantId','to','today'];
  if(keys.length!==5 || required.some(key=>!keys.includes(key)) ||
     keys.some(key=>{
       if(typeof key!=='string')return true;
       const prop=Object.getOwnPropertyDescriptor(value,key);
       return !prop || !prop.enumerable || !Object.hasOwn(prop,'value');
     }))
    throw new TypeError('Invalid local M08 Bank Ledger request shape');
  const v=Object.fromEntries(keys.map(key=>[
    key,Object.getOwnPropertyDescriptor(value,key).value
  ]));
  if(typeof v.tenantId!=='string'||!ID.test(v.tenantId)||
     typeof v.accountId!=='string'||!ID.test(v.accountId)||
     typeof v.from!=='string'||v.from.length>128||
     typeof v.to!=='string'||v.to.length>128||
     typeof v.today!=='string'||!DAY.test(v.today))
    throw new TypeError('Invalid Bank Ledger tenant, account or date');
  return v;
}

function rows(part){
  if(part?.success!==true || !Array.isArray(part.results))
    throw new Error('M08 local Bank Ledger D1 snapshot unavailable');
  return part.results;
}
function cents(value,name){
  if(!Number.isSafeInteger(value))
    throw new Error('Invalid imported Bank Ledger '+name+' cents');
  return value/100;
}
function unique(rows,idField,label){
  const found=new Set();
  for(const row of rows){
    const id=row[idField];
    if(typeof id!=='string')
      throw new Error('Invalid imported '+label);
    if(!id)continue;
    if(found.has(id))throw new Error('Duplicate '+label);
    found.add(id);
  }
}

/**
 * Two parameterized read-only queries execute in a local D1.batch snapshot.
 * Import record identities, chronology and type are not guessed.
 */
export async function previewD1BankLedger(DB,request){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new TypeError('D1 M08 Bank Ledger binding unavailable');
  const v=validate(request);
  const result=await DB.batch([
    DB.prepare(BANK_ACCOUNTS).bind(v.tenantId),
    DB.prepare(BANK_BOOK).bind(v.tenantId)
  ]);
  if(!Array.isArray(result)||result.length!==2)
    throw new Error('M08 Bank Ledger incomplete D1 snapshot');
  const [rawAccounts,rawBook]=result.map(rows);
  unique(rawAccounts,'account_id','Bank Account ID');
  unique(rawBook,'entry_id','Bank Book Entry ID');

  const accounts=rawAccounts.map(row=>({
    'Bank Account ID':row.account_id,
    'Account Name':row.account_name,
    'Bank Name':row.bank_name,
    'Account Number':row.account_number,
    'Opening Balance':cents(row.opening_cents,'opening'),
    'Current Balance':cents(row.current_cents,'current'),
    'Status':row.status,
    'Account Type':row.account_type
  }));
  const account=accounts.find(x=>x['Bank Account ID']===v.accountId);
  if(!account)throw new Error('Bank account not found.');
  const book=rawBook.map(row=>({
    'Entry ID':row.entry_id,
    'Bank Account ID':row.account_id,
    'Date':row.date_text,
    'Type':row.type,
    'Reference':row.reference,
    'Description':row.description,
    'Debit':cents(row.debit_cents,'debit'),
    'Credit':cents(row.credit_cents,'credit'),
    'Status':row.status,
    'Reversal Of':row.reversal_of,
    'Notes':row.notes,
    'Created By':row.created_by,
    'Created At':row.created_at,
    'Is Backdated':row.is_backdated===1,
    'Backdated Days':row.backdated_days,
    'Backdated Reason':row.backdated_reason
  }));
  return {
    statement:bankStatement(account,book,{
      from:v.from,to:v.to,today:v.today
    }),
    bankBalance:bankCurrentBalance(v.accountId,accounts),
    activeBankTotal:totalActiveBankBalance(accounts)
  };
}
