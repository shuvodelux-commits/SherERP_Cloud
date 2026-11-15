/**
 * M08 internal, read-only Bank Account / Bank Ledger projections.
 *
 * Source behavior pinned to Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * in legacy/source/BankBook.gs and BankLedger.gs.
 *
 * Inputs are trusted, already-loaded records. Bank Book dates MUST first be
 * normalized to Asia/Dhaka YYYY-MM-DD by an authorized repository. This
 * module performs no DB access, authorization, mutation or public RPC work.
 */
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;

function rowsLoaded(rows,name) {
  if(!Array.isArray(rows)) throw new TypeError(name+' must be a loaded array');
  return rows;
}

function money(value) {
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}

/** Current bank balance is the account's stored balance, not raw book sum. */
export function bankCurrentBalance(accountId,accounts) {
  const rows=rowsLoaded(accounts,'accounts');
  const account=rows.find(row=>row['Bank Account ID']===accountId);
  return account ? money(Number(account['Current Balance'])||0) : 0;
}

/** Dashboard bank total includes active bank and mobile banking accounts. */
export function totalActiveBankBalance(accounts) {
  const rows=rowsLoaded(accounts,'accounts');
  return money(rows.filter(row=>row['Status']!=='Inactive')
    .reduce((sum,row)=>sum+(Number(row['Current Balance'])||0),0));
}

/**
 * One account's dated ledger with historical opening, void, mirrored manual
 * reversal, and stored-balance reconciliation semantics from getBankLedger.
 *
 * Both requested range and caller-supplied today are YYYY-MM-DD; all Bank
 * Book dates must already be canonical. No ambient Date or implicit timezone.
 */
export function bankStatement(account,bankBookRows,{from,to,today}={}) {
  rowsLoaded(bankBookRows,'bankBookRows');
  if(!account || typeof account!=='object' || Array.isArray(account) ||
     typeof account['Bank Account ID']!=='string' ||
     !account['Bank Account ID']){
    throw new TypeError('account must be a loaded Bank Account record');
  }
  if(typeof today!=='string' || !ISO_DAY.test(today))
    throw new TypeError('today must be a canonical YYYY-MM-DD in Asia/Dhaka');

  let start=from==null?'':String(from).trim();
  let end=to==null?'':String(to).trim();
  if(!ISO_DAY.test(start))start=today.slice(0,8)+'01';
  if(!ISO_DAY.test(end))end=today;
  if(start>end)[start,end]=[end,start];

  const id=account['Bank Account ID'];
  const sourceRows=bankBookRows.filter(row=>row['Bank Account ID']===id);
  const mirrorTargets=new Set();
  for(const row of sourceRows) {
    if(row['Reversal Of'])mirrorTargets.add(String(row['Reversal Of']));
  }

  const dated=sourceRows
    .filter(row=>row['Status']!=='Reversed' ||
      mirrorTargets.has(String(row['Entry ID'])))
    .map(row=>{
      const date=row['Date'];
      if(typeof date!=='string' || !ISO_DAY.test(date))
        throw new TypeError('Bank Book Date must be canonical YYYY-MM-DD');
      return {
        entryId:row['Entry ID'],
        date,
        type:row['Type']||'',
        reference:row['Reference']||'',
        description:row['Description']||'',
        debit:Number(row['Debit'])||0,
        credit:Number(row['Credit'])||0,
        notes:row['Notes']||'',
        createdBy:row['Created By']||'',
        createdAt:row['Created At']||'',
        status:row['Status']||'Active',
        reversalOf:row['Reversal Of']||'',
        isBackdated:!!row['Is Backdated'],
        backdatedDays:Number(row['Backdated Days'])||0,
        backdatedReason:row['Backdated Reason']||''
      };
    })
    .sort((a,b)=>a.date===b.date
      ?String(a.entryId).localeCompare(String(b.entryId))
      :(a.date<b.date?-1:1));

  const hasOpeningRow=dated.some(row=>row.type==='Opening Balance');
  let running=hasOpeningRow?0:(Number(account['Opening Balance'])||0);
  let openingBalance=running;
  const inRange=[];
  let totalDebit=0;
  let totalCredit=0;

  for(const row of dated){
    running+=row.credit-row.debit;
    if(row.date<start){
      openingBalance=running;
    }else if(row.date<=end){
      row.balance=running;
      totalDebit+=row.debit;
      totalCredit+=row.credit;
      inRange.push(row);
    }
  }

  const closingBalance=inRange.length
    ?inRange[inRange.length-1].balance:openingBalance;
  const currentBalance=Number(account['Current Balance'])||0;
  const drift=running-currentBalance;
  return {
    account:{
      id,
      name:account['Account Name'],
      bankName:account['Bank Name']||'',
      accountNumber:account['Account Number']||'',
      openingBalance:Number(account['Opening Balance'])||0,
      currentBalance
    },
    range:{from:start,to:end},
    openingBalance,
    closingBalance,
    totalDebit,
    totalCredit,
    entries:inRange.reverse(),
    entryCount:inRange.length,
    integrity:{
      computedBalance:running,
      storedBalance:currentBalance,
      drift,
      balanced:Math.abs(drift)<0.005,
      hasOpeningRow
    }
  };
}
