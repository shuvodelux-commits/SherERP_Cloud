/**
 * M08 internal Owner/Lender/Borrower finance balance read projection.
 *
 * Source: legacy/source/FinanceModule.gs pinned to
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * This is NOT a D1 repository, journal, payment writer, RPC or permission
 * check. Rows must already be active-filtered and loaded by future reviewed
 * code. Original Person IDs are required; never attach name-only history to
 * a finance person without explicit identity review.
 */
const TYPE_EFFECTS=Object.freeze({
  'Owner Investment':['owner',1],
  'Owner Withdrawal':['owner',-1],
  'Loan Received':['loanPayable',1],
  'Loan Repayment':['loanPayable',-1],
  'Borrower Loan':['borrowerReceivable',1],
  'Borrower Repayment':['borrowerReceivable',-1],
  'Opening Owner Capital':['owner',1],
  'Opening Loan':['loanPayable',1],
  'Opening Borrower Loan':['borrowerReceivable',1]
});

function money(value) {
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function validateRows(rows) {
  if(!Array.isArray(rows)) throw new TypeError('Finance rows must be loaded');
  for(const row of rows) {
    if(!row || typeof row!=='object' || Array.isArray(row))
      throw new TypeError('Malformed finance transaction row');
    if(typeof row['Person ID']!=='string' || !row['Person ID'].trim())
      throw new TypeError('Unresolved legacy Person ID requires manual identity review');
    if(!Object.hasOwn(TYPE_EFFECTS,row['Transaction Type']))
      throw new TypeError('Unknown source finance transaction type');
    const amount=Number(row['Amount']);
    if(!Number.isFinite(amount) || amount<0)
      throw new TypeError('Invalid finance transaction amount');
    const deleted=row['Is Deleted'];
    if(deleted===true || String(deleted||'').toUpperCase()==='TRUE')
      throw new TypeError('Soft-deleted finance rows must be excluded upstream');
  }
}

/**
 * Signed and gross balances match the original financeSignedBalances_ and
 * financeBalanceSummary_ for the validated, source-ID-bearing subset.
 * No automatic owner/lender/borrower account netting or cash posting.
 */
export function projectFinanceRoleBalances(activeFinanceRows,{personId}={}) {
  validateRows(activeFinanceRows);
  if(personId!==undefined &&
    (typeof personId!=='string'||!personId.trim()))
    throw new TypeError('Invalid original Finance Person ID selector');

  const byPerson={};
  for(const row of activeFinanceRows) {
    const id=row['Person ID'].trim();
    if(personId!==undefined && id!==personId.trim()) continue;
    const key='id:'+id;
    if(!byPerson[key]) {
      byPerson[key]={
        personId:id,
        person:String(row['Person']||'').trim(),
        owner:0,
        loanPayable:0,
        borrowerReceivable:0
      };
    }
    const [account,effect]=TYPE_EFFECTS[row['Transaction Type']];
    byPerson[key][account]=money(
      byPerson[key][account]+Number(row['Amount'])*effect
    );
  }

  const summary={
    ownerCapital:0,
    ownerAdvance:0,
    outstandingLoan:0,
    lenderCredit:0,
    borrowerReceivable:0,
    borrowerCredit:0
  };
  for(const balance of Object.values(byPerson)) {
    if(balance.owner>=0)summary.ownerCapital+=balance.owner;
    else summary.ownerAdvance+=-balance.owner;
    if(balance.loanPayable>=0)summary.outstandingLoan+=balance.loanPayable;
    else summary.lenderCredit+=-balance.loanPayable;
    if(balance.borrowerReceivable>=0)
      summary.borrowerReceivable+=balance.borrowerReceivable;
    else summary.borrowerCredit+=-balance.borrowerReceivable;
  }
  for(const key of Object.keys(summary))summary[key]=money(summary[key]);
  return {byPerson,summary};
}
