/**
 * M08 #580 disposable Workerd/D1 source audit. Test-only, read-only.
 * Historical Vendor accounts and Payee identities must never be netted.
 * Not a production repository, auth implementation, RPC or financial writer.
 */
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const QUERIES=Object.freeze([
  `SELECT legacy_row,vendor_id,vendor_name,phone,address,
          due_cents,receivable_cents,status,is_deleted
   FROM m08_vp_vendors WHERE tenant_id=? ORDER BY legacy_row`,
  `SELECT legacy_row,ledger_id,vendor_id,vendor_name,date_text,entry_type,
          reference,balance_type,debit_cents,credit_cents,
          stored_balance_cents,is_deleted,created_at
   FROM m08_vp_ledger WHERE tenant_id=? ORDER BY legacy_row`,
  `SELECT legacy_row,payee_id,payee_name,phone,status,is_deleted
   FROM m08_vp_payees WHERE tenant_id=? ORDER BY legacy_row`,
  `SELECT legacy_row,expense_id,payee_id,amount_cents,payment_method,
          status,is_deleted
   FROM m08_vp_expenses WHERE tenant_id=? ORDER BY legacy_row`
]);

function requireRequest(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     (Object.getPrototypeOf(input)!==Object.prototype &&
      Object.getPrototypeOf(input)!==null))
    throw new TypeError('Invalid M08 Vendor/Payee D1 request');
  const expected=['tenantId','vendorId','payeeId'];
  const keys=Reflect.ownKeys(input);
  if(keys.length!==3 || expected.some(k=>!keys.includes(k)) ||
     keys.some(k=>{
       if(typeof k!=='string')return true;
       const desc=Object.getOwnPropertyDescriptor(input,k);
       return !desc || !desc.enumerable || !Object.hasOwn(desc,'value');
     }))throw new TypeError('Untrusted M08 Vendor/Payee request fields');
  const values=expected.map(k=>Object.getOwnPropertyDescriptor(input,k).value);
  if(values.some(v=>typeof v!=='string' || !ID.test(v)))
    throw new TypeError('Invalid original M08 Vendor/Payee or tenant ID');
  return values;
}
function rows(result){
  if(result?.success!==true || !Array.isArray(result.results))
    throw new Error('M08 Vendor/Payee local D1 read unavailable');
  return result.results;
}
function requireId(value,label){
  if(typeof value!=='string' || !ID.test(value))
    throw new TypeError('Unresolved '+label);
  return value;
}
function requireUnique(records,column,label){
  const seen=new Set();
  for(const row of records){
    const id=requireId(row[column],label);
    if(seen.has(id))throw new TypeError('Duplicate '+label);
    seen.add(id);
  }
}
function money(value,label,signed=false){
  if(!Number.isSafeInteger(value) || (!signed && value<0))
    throw new TypeError('Invalid source '+label+' cents');
  return value;
}
function accumulate(a,b){
  const sum=a+b;
  if(!Number.isSafeInteger(sum))throw new TypeError('M08 gross balance overflow');
  return sum;
}
function legacyLedgerSortKey(row){
  const date=String(row.Date||'');
  const datePart=date.slice(0,10);
  let timePart=date.slice(11);
  if((!timePart || timePart==='00:00:00') && row['Created At']){
    const created=String(row['Created At']).slice(11);
    if(created)timePart=created;
  }
  return datePart+'T'+(timePart||'00:00:00');
}
function vendorProfile(row){
  return {
    id:row.vendor_id,name:row.vendor_name,phone:row.phone||'',
    address:row.address||'',currentDue:row.due_cents/100,
    currentReceivable:row.receivable_cents/100,
    status:row.status||'Active'
  };
}

function projectVendor(row,ledger){
  const active=ledger.filter(e=>e.vendor_id===row.vendor_id &&
    e.is_deleted===0);
  // Source GAS sorts by Date/Created At; D1's immutable legacy_row handles
  // ties because rows were loaded in physical order and modern sort is stable.
  const ascending=active.map(entry=>({
    _rowIndex:entry.legacy_row,
    'Ledger ID':entry.ledger_id,
    Date:entry.date_text,
    'Vendor ID':entry.vendor_id,
    'Vendor Name':entry.vendor_name,
    Type:entry.entry_type,
    Reference:entry.reference,
    Debit:entry.debit_cents/100,
    Credit:entry.credit_cents/100,
    Balance:entry.stored_balance_cents/100,
    'Is Deleted':'',
    'Created At':entry.created_at,
    'Balance Type':entry.balance_type
  })).sort((a,b)=>legacyLedgerSortKey(a).localeCompare(legacyLedgerSortKey(b)));

  const balances={Payable:0,Receivable:0};
  for(const entry of ascending){
    const kind=entry['Balance Type']||'Payable';
    const delta=Math.round((entry.Debit-entry.Credit)*100);
    balances[kind]=accumulate(balances[kind],delta);
    entry.Balance=balances[kind]/100;
  }
  const displayed=ascending.sort((a,b)=>
    legacyLedgerSortKey(b).localeCompare(legacyLedgerSortKey(a)));
  const stored=new Map(active.map(e=>[e.ledger_id,e.stored_balance_cents]));
  const drift=[];
  if(row.due_cents!==balances.Payable)
    drift.push('MASTER_PAYABLE_MISMATCH');
  if(row.receivable_cents!==balances.Receivable)
    drift.push('MASTER_RECEIVABLE_MISMATCH');
  for(const item of displayed){
    if(stored.get(item['Ledger ID'])!==Math.round(item.Balance*100))
      drift.push('LEDGER_STORED_BALANCE_MISMATCH:'+item['Ledger ID']);
  }
  return {
    profile:vendorProfile(row),
    reconstructed:{
      payable:balances.Payable/100,
      receivable:balances.Receivable/100
    },
    drift,ledger:displayed
  };
}
function projectPayee(requested,payees,expenses){
  const activeList=payees
    .filter(p=>p.is_deleted===0 && p.status!=='Inactive')
    .map(p=>({id:p.payee_id,name:p.payee_name,phone:p.phone||''}))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name)));

  let total=0;
  const detail=expenses.filter(e=>e.payee_id===requested.payee_id)
    .map(e=>{
      if(e.status==='Active' && e.is_deleted===0)
        total=accumulate(total,e.amount_cents);
      return {
        expenseId:e.expense_id,
        payeeId:e.payee_id, // Original EXPENSES['Ledger ID'], never inferred from name.
        amount:e.amount_cents/100,
        paymentMethod:e.payment_method,
        status:e.status,
        isDeleted:e.is_deleted===1,
        legacyRow:e.legacy_row
      };
    });
  return {
    selected:{
      id:requested.payee_id,
      name:requested.payee_name,
      phone:requested.phone||'',
      status:requested.status,
      selectable:requested.is_deleted===0 &&
        requested.status!=='Inactive'
    },
    activeList,
    expenses:detail,
    activeExpenseTotal:total/100,
    createsPayable:false,
    liabilityAmount:null
  };
}

/** Explicit tenant only; four read-only parameterized D1 queries. */
export async function previewD1VendorPayeeIsolation(DB,input){
  if(!DB || typeof DB.prepare!=='function' || typeof DB.batch!=='function')
    throw new TypeError('D1 M08 Vendor/Payee binding unavailable');
  const [tenantId,vendorId,payeeId]=requireRequest(input);
  const result=await DB.batch(QUERIES.map(query=>DB.prepare(query).bind(tenantId)));
  if(!Array.isArray(result) || result.length!==4)
    throw new Error('M08 Vendor/Payee incomplete D1 snapshot');
  const [vendors,ledger,payees,expenses]=result.map(rows);
  requireUnique(vendors,'vendor_id','Vendor ID');
  requireUnique(ledger,'ledger_id','Vendor Ledger ID');
  requireUnique(payees,'payee_id','Expense Payee ID');
  requireUnique(expenses,'expense_id','Expense ID');
  const vendorIDs=new Set(vendors.map(v=>v.vendor_id));
  const payeeIDs=new Set(payees.map(p=>p.payee_id));
  for(const row of vendors){
    money(row.due_cents,'Vendor Current Due',true);
    money(row.receivable_cents,'Vendor Current Receivable',true);
  }
  for(const row of ledger){
    requireId(row.vendor_id,'Vendor Ledger Vendor ID');
    if(!vendorIDs.has(row.vendor_id))
      throw new TypeError('Unresolved Vendor ledger reference');
    money(row.debit_cents,'Vendor debit');
    money(row.credit_cents,'Vendor credit');
    money(row.stored_balance_cents,'Vendor stored balance',true);
    if(row.balance_type!=='' &&
       row.balance_type!=='Payable' &&
       row.balance_type!=='Receivable')
      throw new TypeError('Invalid Vendor ledger account type');
  }
  for(const row of expenses){
    requireId(row.payee_id,'Expense Payee reference');
    if(!payeeIDs.has(row.payee_id))
      throw new TypeError('Unresolved Expense Payee ID');
    money(row.amount_cents,'Expense amount');
  }
  const vendor=vendors.find(v=>v.vendor_id===vendorId && v.is_deleted===0);
  const payee=payees.find(p=>p.payee_id===payeeId);
  if(!vendor)throw new TypeError('Vendor not found or soft-deleted');
  if(!payee)throw new TypeError('Expense Payee not found');
  return {
    vendor:projectVendor(vendor,ledger),
    payee:projectPayee(payee,payees,expenses)
  };
}
