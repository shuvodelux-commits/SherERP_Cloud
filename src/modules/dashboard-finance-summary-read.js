/**
 * M09 internal, read-only original FinanceModule.gs signed-balance projection.
 * A trusted future M03 repository must supply already activeRows_-filtered
 * FINANCE_TRANSACTIONS for one authenticated shop. This file neither authenticates
 * nor reads/writes D1 or creates current-day Cash/Bank movements.
 *
 * Original source: financeSignedBalances_ -> financeBalanceSummary_.
 * Only borrowerReceivable and outstandingLoan feed original Dashboard tiles;
 * preserve all six buckets so opposite person/account signs do NOT net away.
 */
const EFFECTS=new Map([
  ['Owner Investment',['owner',1]],
  ['Owner Withdrawal',['owner',-1]],
  ['Loan Received',['loanPayable',1]],
  ['Loan Repayment',['loanPayable',-1]],
  ['Borrower Loan',['borrowerReceivable',1]],
  ['Borrower Repayment',['borrowerReceivable',-1]],
  ['Opening Owner Capital',['owner',1]],
  ['Opening Loan',['loanPayable',1]],
  ['Opening Borrower Loan',['borrowerReceivable',1]]
]);

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function scalarRow(value){
  if(!plain(value))throw new TypeError('Invalid trusted Finance row');
  for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))){
    if(!Object.hasOwn(descriptor,'value'))
      throw new TypeError('Invalid trusted Finance row accessor');
    const v=descriptor.value;
    if(v!==null && !['undefined','string','number','boolean'].includes(typeof v))
      throw new TypeError('Invalid trusted Finance row field');
    if(typeof v==='number' && !Number.isFinite(v) && !Number.isNaN(v))
      throw new TypeError('Invalid trusted Finance row amount');
  }
  return value;
}
function rowsFrom(snapshot){
  if(!plain(snapshot) || Reflect.ownKeys(snapshot).length!==1)
    throw new TypeError('Invalid trusted Dashboard Finance snapshot');
  const d=Object.getOwnPropertyDescriptor(snapshot,'activeTransactions');
  if(!d || !Object.hasOwn(d,'value') || !Array.isArray(d.value) ||
     Object.getPrototypeOf(d.value)!==Array.prototype)
    throw new TypeError('Invalid trusted Finance array');
  const array=d.value, props=Object.getOwnPropertyDescriptors(array);
  for(let i=0;i<array.length;i++){
    const desc=props[String(i)];
    if(!desc || !Object.hasOwn(desc,'value'))
      throw new TypeError('Invalid trusted Finance array slot');
  }
  if(Reflect.ownKeys(props).some(k=>
    typeof k!=='string' || (k!=='length' &&
      (!/^(0|[1-9]\d*)$/.test(k) || Number(k)>=array.length))))
    throw new TypeError('Invalid trusted Finance array fields');
  return array.map(scalarRow);
}
function roundMoney(value){
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}
function amount(value){
  const n=Number(value)||0;
  if(!Number.isFinite(n))
    throw new TypeError('Invalid trusted Finance amount');
  return n;
}
function personKey(row){
  const personId=String(row['Person ID']||'').trim();
  if(personId)return 'id:'+personId;
  return 'name:'+String(row.Person||'').trim().toLowerCase().replace(/\s+/g,' ');
}

/**
 * Exact source FinanceModule summary keys. This is NOT a combined Party due.
 * Per-person account balances are rounded after EACH source Finance transaction
 * before positive and negative amounts enter separate non-netted buckets.
 */
export function projectDashboardFinanceSummary(snapshot){
  const balances=new Map();
  for(const row of rowsFrom(snapshot)){
    const type=EFFECTS.get(row['Transaction Type']);
    if(!type)continue; // The original helper ignores unsupported types.
    const key=personKey(row);
    let b=balances.get(key);
    if(!b){
      b={owner:0,loanPayable:0,borrowerReceivable:0};
      balances.set(key,b);
    }
    const [account,effect]=type;
    b[account]=roundMoney(b[account]+amount(row.Amount)*effect);
  }

  const summary={
    ownerCapital:0,ownerAdvance:0,
    outstandingLoan:0,lenderCredit:0,
    borrowerReceivable:0,borrowerCredit:0
  };
  for(const b of balances.values()){
    if(b.owner>=0)summary.ownerCapital+=b.owner;
    else summary.ownerAdvance+=-b.owner;
    if(b.loanPayable>=0)summary.outstandingLoan+=b.loanPayable;
    else summary.lenderCredit+=-b.loanPayable;
    if(b.borrowerReceivable>=0)
      summary.borrowerReceivable+=b.borrowerReceivable;
    else summary.borrowerCredit+=-b.borrowerReceivable;
  }
  for(const key of Object.keys(summary))
    summary[key]=roundMoney(summary[key]);
  return summary;
}
