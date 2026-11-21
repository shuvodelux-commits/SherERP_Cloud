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
const MAX_PAISA=BigInt(Number.MAX_SAFE_INTEGER);
const FINANCE_MONEY=/^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const DISPLAY_MONEY=/^(-?)([0-9]+)(?:\.([0-9]{1,2}))?$/;
const failMoney=()=>{throw new TypeError('Unverified finance money or precision');};
const bounded=paisa=>{
  if(paisa>MAX_PAISA||paisa< -MAX_PAISA)failMoney();
  return paisa;
};

/**
 * Source roundMoney_ rounds the account after each transaction, including
 * half-cent movements. With an existing integer-paisa account, a positive
 * tie increases by a paisa and a negative tie rounds toward +infinity.
 * Integer arithmetic avoids Number coercion and cent drift.
 */
function signedMovementPaisa(raw,effect){
  if(typeof raw!=='string'&&typeof raw!=='number')failMoney();
  if(typeof raw==='number'&&(!Number.isFinite(raw)||raw<0||Object.is(raw,-0)))
    failMoney();
  const literal=String(raw);
  if(literal.length>64)failMoney();
  const match=FINANCE_MONEY.exec(literal);
  if(!match||((match[1]??'').length>12))failMoney();
  const [whole,fraction='']=literal.split('.');
  const scale=10n**BigInt(fraction.length);
  const rawUnits=BigInt(whole)*scale+BigInt(fraction||'0');
  const numerator=rawUnits*100n;
  const full=numerator/scale,remaining=numerator%scale;
  const needsExtra=effect===1?remaining*2n>=scale:remaining*2n>scale;
  const signed=effect===1?full+BigInt(needsExtra):-(full+BigInt(needsExtra));
  return bounded(signed);
}

function toSourceNumber(paisa){
  bounded(paisa);
  const displayed=Number(paisa)/100;
  const match=DISPLAY_MONEY.exec(String(displayed));
  if(!match)failMoney();
  const reconstructed=BigInt(match[2])*100n+
    BigInt((match[3]||'').padEnd(2,'0'));
  if((match[1]==='-'?-reconstructed:reconstructed)!==paisa)failMoney();
  return displayed;
}

function validateRows(rows){
  if(!Array.isArray(rows))throw new TypeError('Finance rows must be loaded');
  const movements=[];
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row))
      throw new TypeError('Malformed finance transaction row');
    const personId=row['Person ID'];
    if(typeof personId!=='string'||!personId.trim()||personId!==personId.trim())
      throw new TypeError('Unresolved or noncanonical legacy Person ID requires identity review');
    if(!Object.hasOwn(TYPE_EFFECTS,row['Transaction Type']))
      throw new TypeError('Unknown source finance transaction type');
    const deleted=row['Is Deleted'];
    if(deleted===true||String(deleted||'').toUpperCase()==='TRUE')
      throw new TypeError('Soft-deleted finance rows must be excluded upstream');
    movements.push(signedMovementPaisa(row['Amount'],TYPE_EFFECTS[row['Transaction Type']][1]));
  }
  return movements;
}

/**
 * Signed and gross balances match original financeSignedBalances_ and
 * financeBalanceSummary_ for the source-ID-bearing, safe-money subset.
 * Owner equity, lender debt and borrower receivables never net each other.
 * Historical opening types do not create Cash/Bank/Cash Session entries.
 */
export function projectFinanceRoleBalances(activeFinanceRows,{personId}={}){
  const movements=validateRows(activeFinanceRows);
  if(personId!==undefined&&
     (typeof personId!=='string'||!personId.trim()||personId!==personId.trim()))
    throw new TypeError('Invalid original Finance Person ID selector');

  const balances=new Map();
  for(const [index,row] of activeFinanceRows.entries()){
    const id=row['Person ID'];
    if(personId!==undefined&&id!==personId)continue;
    const key='id:'+id;
    if(!balances.has(key))balances.set(key,{
      personId:id,
      person:String(row['Person']||'').trim(),
      owner:0n,
      loanPayable:0n,
      borrowerReceivable:0n
    });
    const balance=balances.get(key);
    const [account]=TYPE_EFFECTS[row['Transaction Type']];
    balance[account]=bounded(balance[account]+movements[index]);
  }

  const summary={
    ownerCapital:0n,
    ownerAdvance:0n,
    outstandingLoan:0n,
    lenderCredit:0n,
    borrowerReceivable:0n,
    borrowerCredit:0n
  };
  for(const balance of balances.values()){
    for(const [account,plus,minus] of [
      ['owner','ownerCapital','ownerAdvance'],
      ['loanPayable','outstandingLoan','lenderCredit'],
      ['borrowerReceivable','borrowerReceivable','borrowerCredit']
    ]){
      const value=balance[account];
      const bucket=value>=0n?plus:minus;
      summary[bucket]=bounded(summary[bucket]+(value>=0n?value:-value));
    }
  }

  const byPerson={};
  for(const [key,account] of balances){
    byPerson[key]={
      personId:account.personId,
      person:account.person,
      owner:toSourceNumber(account.owner),
      loanPayable:toSourceNumber(account.loanPayable),
      borrowerReceivable:toSourceNumber(account.borrowerReceivable)
    };
  }
  return {byPerson,summary:Object.fromEntries(Object.entries(summary)
    .map(([key,paisa])=>[key,toSourceNumber(paisa)]))};
}
