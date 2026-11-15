/**
 * M08 internal Finance Ledger chronological read-only projection.
 *
 * Source: FinanceModule.gs:getFinanceLedger,
 * pinned Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * No D1, RPC, identity linking, permissions, posting or cash movements.
 * Caller must provide already-active, Asia/Dhaka YYYY-MM-DD normalized rows.
 */
import {projectFinanceRoleBalances} from './m08-finance-role-balances.js';

const TYPES={
  'Owner Investment':['Owner Credit','owner',1,'in'],
  'Owner Withdrawal':['Owner Debit','owner',-1,'out'],
  'Loan Received':['Lender Credit','loanPayable',1,'in'],
  'Loan Repayment':['Lender Debit','loanPayable',-1,'out'],
  'Borrower Loan':['Borrower Debit','borrowerReceivable',1,'out'],
  'Borrower Repayment':['Borrower Credit','borrowerReceivable',-1,'in'],
  'Opening Owner Capital':['Opening Owner Capital','owner',1,'none'],
  'Opening Loan':['Opening Loan','loanPayable',1,'none'],
  'Opening Borrower Loan':['Opening Borrower Loan','borrowerReceivable',1,'none']
};
const ACCOUNT_LABELS={
  owner:'Owner Balance',
  loanPayable:'Lender Balance',
  borrowerReceivable:'Borrower Balance'
};
const DAY=/^\d{4}-\d{2}-\d{2}$/;

function roundMoney(value) {
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}
function filterText(value) {
  if(value===null||value===undefined)return '';
  if(typeof value!=='string')throw new TypeError('Finance ledger filters must be strings');
  return value.trim();
}

/** Compute every account's running balance before applying display filters. */
export function projectFinanceLedgerRows(activeFinanceRows,filters={}) {
  if(!Array.isArray(activeFinanceRows))
    throw new TypeError('Finance rows must be a loaded array');
  if(!filters || typeof filters!=='object' || Array.isArray(filters) ||
     typeof filters.then==='function')
    throw new TypeError('Finance ledger filters must be a loaded object');

  const dateFrom=filterText(filters.dateFrom);
  const dateTo=filterText(filters.dateTo);
  const typeFilter=filterText(filters.transactionType);
  const personId=filterText(filters.personId);
  const query=filterText(filters.query).toLowerCase();
  if((dateFrom && !DAY.test(dateFrom)) || (dateTo && !DAY.test(dateTo)))
    throw new TypeError('Finance ledger range must use YYYY-MM-DD');

  for(const row of activeFinanceRows) {
    if(!row || typeof row!=='object' || Array.isArray(row) ||
       typeof row['Finance ID']!=='string' || !row['Finance ID'].trim() ||
       typeof row['Date']!=='string' || !DAY.test(row['Date']))
      throw new TypeError('Finance rows need Finance ID and normalized YYYY-MM-DD Date');
  }
  const sorted=activeFinanceRows.slice().sort((a,b)=>
    a['Date'].localeCompare(b['Date']) ||
    String(a['Finance ID']).localeCompare(String(b['Finance ID'])));

  // The already-merged M08 source parity model validates original Person IDs,
  // transaction types, amounts and soft deletions; it also computes six gross
  // buckets independent of date/type/query selection.
  const {summary}=projectFinanceRoleBalances(sorted,
    personId?{personId}:undefined);
  const running=new Map();
  const shaped=sorted.map(row=>{
    const type=TYPES[row['Transaction Type']];
    const [label,account,effect,cashDirection]=type;
    const amount=Number(row['Amount'])||0;
    const personKey='id:'+row['Person ID'].trim();
    if(!running.has(personKey))
      running.set(personKey,{owner:0,loanPayable:0,borrowerReceivable:0});
    const accounts=running.get(personKey);
    accounts[account]=roundMoney(accounts[account]+amount*effect);
    return {
      financeId:row['Finance ID'],
      date:row['Date'],
      transactionType:row['Transaction Type'],
      transactionTypeLabel:label,
      account,
      accountLabel:ACCOUNT_LABELS[account],
      personKey,
      personId:row['Person ID']||'',
      person:row['Person']||'',
      paymentMethod:row['Payment Method']||'',
      bankAccountId:row['Bank Account ID']||'',
      bankAccountName:row['Bank Account Name']||'',
      amount,
      debit:cashDirection==='out'?amount:0,
      credit:cashDirection==='in'?amount:0,
      balance:accounts[account],
      referenceNo:row['Reference No']||'',
      notes:row['Notes']||'',
      createdBy:row['Created By']||'',
      createdAt:row['Created At']||'',
      isBackdated:!!row['Is Backdated'],
      backdatedDays:Number(row['Backdated Days'])||0,
      backdatedReason:row['Backdated Reason']||''
    };
  });
  const selectedKey=personId?'id:'+personId:'';
  const rows=shaped.filter(row=>{
    if(selectedKey && row.personKey!==selectedKey)return false;
    if(dateFrom && row.date<dateFrom)return false;
    if(dateTo && row.date>dateTo)return false;
    if(typeFilter && row.transactionType!==typeFilter)return false;
    if(query) {
      const hay=(row.financeId+' '+row.person+' '+row.referenceNo+' '+
        row.notes+' '+row.transactionType+' '+row.transactionTypeLabel+' '+
        row.accountLabel).toLowerCase();
      if(!hay.includes(query))return false;
    }
    return true;
  }).reverse();
  return {rows,summary};
}
