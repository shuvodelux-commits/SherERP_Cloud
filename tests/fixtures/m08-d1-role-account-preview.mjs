/**
 * M08 TEST ONLY: tenant-scoped Finance Person gross roles + raw Party ledgers.
 * Existing source-verified M08 pure models remain authoritative for the
 * *read* interpretation; no real D1 schema, posting, auth, settlement or RPC.
 */
import {reconcileFinancePersonBalances}
  from '../../src/modules/m08-finance-person-balance-reconciliation.js';
import {projectRawLegacyPartyLedger}
  from '../../src/modules/m08-party-raw-ledger.js';

const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const PERSON_SQL=String.raw`
 SELECT legacy_row,person_id,person_name,person_type,roles,status,phone,description
 FROM m08_role_persons WHERE tenant_id=? ORDER BY legacy_row
`;
const FINANCE_SQL=String.raw`
 SELECT legacy_row,finance_id,person_id,person,transaction_type,
        amount_cents,is_deleted
 FROM m08_role_finance WHERE tenant_id=? ORDER BY legacy_row
`;
const PARTY_SQL=String.raw`
 SELECT legacy_row,ledger_id,kind,legacy_id,date_text,type,
        debit_cents,credit_cents,is_deleted,created_at
 FROM m08_role_party WHERE tenant_id=? ORDER BY legacy_row
`;

function requireIdentity(raw){
  if(!raw || typeof raw!=='object' || Array.isArray(raw) ||
     (Object.getPrototypeOf(raw)!==Object.prototype &&
      Object.getPrototypeOf(raw)!==null))
    throw new TypeError('Invalid M08 Finance/Party local identity request');
  const keys=Reflect.ownKeys(raw);
  if(keys.length!==3 || !['tenantId','customerId','supplierId']
    .every(k=>keys.includes(k)) || keys.some(key=>{
      if(typeof key!=='string')return true;
      const p=Object.getOwnPropertyDescriptor(raw,key);
      return !p || !p.enumerable || !Object.hasOwn(p,'value');
    }))throw new TypeError('Untrusted M08 Finance/Party request fields');
  const tenantId=Object.getOwnPropertyDescriptor(raw,'tenantId').value;
  const customerId=Object.getOwnPropertyDescriptor(raw,'customerId').value;
  const supplierId=Object.getOwnPropertyDescriptor(raw,'supplierId').value;
  for(const value of [tenantId,customerId,supplierId]){
    if(typeof value!=='string' || !ID.test(value))
      throw new TypeError('Invalid M08 tenant or original Party role identity');
  }
  return {tenantId,customerId,supplierId};
}
function requireRows(part){
  if(part?.success!==true || !Array.isArray(part.results))
    throw new Error('M08 Finance/Party D1 local read unavailable');
  return part.results;
}
function cents(v){
  if(!Number.isSafeInteger(v))
    throw new TypeError('Invalid M08 imported finance cents');
  return v/100;
}
function unique(rows,column,label){
  const seen=new Set();
  for(const row of rows){
    const id=row[column];
    if(typeof id!=='string' || !id || id.trim()!==id)
      throw new TypeError('Unresolved '+label);
    if(seen.has(id))throw new TypeError('Duplicate '+label);
    seen.add(id);
  }
}

/** Read all three source groups atomically in a read-only D1.batch. */
export async function previewD1RoleAccountIsolation(DB,request){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new TypeError('D1 local Finance/Party binding unavailable');
  const {tenantId,customerId,supplierId}=requireIdentity(request);
  const response=await DB.batch([
    DB.prepare(PERSON_SQL).bind(tenantId),
    DB.prepare(FINANCE_SQL).bind(tenantId),
    DB.prepare(PARTY_SQL).bind(tenantId)
  ]);
  if(!Array.isArray(response) || response.length!==3)
    throw new Error('M08 Finance/Party partial D1 snapshot');
  const [persons,financeRows,partyRows]=response.map(requireRows);
  unique(persons,'person_id','Finance Person ID');
  unique(financeRows,'finance_id','Finance ID');
  for(const kind of ['customer','supplier']){
    unique(partyRows.filter(row=>row.kind===kind),'ledger_id',
      kind+' Ledger ID');
  }
  const masters=persons.map(row=>({
    'Person ID':row.person_id,
    'Person Name':row.person_name,
    'Person Type':row.person_type,
    Roles:row.roles,
    Status:row.status,
    Phone:row.phone,
    Description:row.description
  }));
  const activeFinance=financeRows.filter(row=>row.is_deleted===0).map(row=>({
    'Finance ID':row.finance_id,
    'Person ID':row.person_id,
    Person:row.person,
    'Transaction Type':row.transaction_type,
    Amount:cents(row.amount_cents),
    'Is Deleted':''
  }));
  const rawParty=partyRows.map(row=>{
    const isCustomer=row.kind==='customer';
    const identity=isCustomer?'Customer ID':'Supplier ID';
    return {
      'Ledger ID':row.ledger_id,
      [identity]:row.legacy_id,
      Date:row.date_text,
      Type:row.type,
      Debit:cents(row.debit_cents),
      Credit:cents(row.credit_cents),
      'Is Deleted':row.is_deleted===1?'TRUE':'',
      'Created At':row.created_at,
      _rowIndex:row.legacy_row
    };
  });
  return {
    finance:reconcileFinancePersonBalances(masters,activeFinance),
    customer:projectRawLegacyPartyLedger('customer',customerId,rawParty),
    supplier:projectRawLegacyPartyLedger('supplier',supplierId,rawParty)
  };
}
