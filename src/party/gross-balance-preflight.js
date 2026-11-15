/**
 * M02-P source-only gross financial checkpoint preflight.
 * Results omit names/phones but retain sensitive source-ID provenance;
 * never publish results derived from real customer data.
 *
 * No DB writes, no migration, no posting or cross-role settlement.
 * Original source SHA: 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */
import {planPartyImport} from './party-import-plan.js';
import {rolesForLegacyRow} from './legacy-contracts.js';

const financeTypes=Object.freeze({
  'Owner Investment':      {role:'Owner',account:'owner',effect:1},
  'Owner Withdrawal':      {role:'Owner',account:'owner',effect:-1},
  'Loan Received':         {role:'Lender',account:'loanPayable',effect:1},
  'Loan Repayment':        {role:'Lender',account:'loanPayable',effect:-1},
  'Borrower Loan':         {role:'Borrower',account:'borrowerReceivable',effect:1},
  'Borrower Repayment':    {role:'Borrower',account:'borrowerReceivable',effect:-1},
  'Opening Owner Capital': {role:'Owner',account:'owner',effect:1},
  'Opening Loan':          {role:'Lender',account:'loanPayable',effect:1},
  'Opening Borrower Loan': {role:'Borrower',account:'borrowerReceivable',effect:1}
});
const signedFinanceBuckets=Object.freeze({
  owner:['OWNER_EQUITY','OWNER_ADVANCE'],
  loanPayable:['LENDER_LOAN_PAYABLE','LENDER_CREDIT'],
  borrowerReceivable:['BORROWER_LOAN_RECEIVABLE','BORROWER_CREDIT']
});
const sourceKey=(group,id)=>JSON.stringify([group,id]);
const string=(value)=>typeof value==='string'?value:String(value??'');
const deleted=row=>row?.['Is Deleted']===true || string(row?.['Is Deleted']).toUpperCase()==='TRUE';

function toMinorUnits(value){
  if(value===undefined || value===null || value==='')return 0;
  if(typeof value!=='number' && typeof value!=='string')
    throw new Error('Invalid monetary amount or precision');
  if(typeof value==='number'&&!Number.isFinite(value))
    throw new Error('Invalid monetary amount or precision');
  const s=string(value).trim();
  if(!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s))
    throw new Error('Invalid monetary amount or precision');
  const neg=s.startsWith('-'),unsigned=s.replace(/^[+-]/,'');
  const [whole,frac='']=unsigned.split('.');
  const cents=Number(whole)*100+Number(frac.padEnd(2,'0'));
  if(!Number.isSafeInteger(cents))
    throw new Error('Invalid monetary amount or precision');
  return neg?-cents:cents;
}
const sortedObject=entries=>Object.fromEntries([...entries].sort(([a],[b])=>a.localeCompare(b)));

/**
 * Check current stored/derived balances separately from historical openings.
 * Identity-review evidence is an unverified planning claim, not permission.
 */
export function prepareGrossPartyBalances({sourceRows,approvedGroups=[],financeRows}={}){
  if(!Array.isArray(financeRows))
    throw new Error('Explicit financeRows coverage is required (pass [] for reviewed empty source)');
  const identity=planPartyImport(sourceRows,approvedGroups);
  const links=new Map(identity.links.map(link=>[
    sourceKey(link.sourceGroup,link.sourceId),link
  ]));
  const rolesByParty=new Map();
  for(const {partyId,role} of identity.roles){
    if(!rolesByParty.has(partyId))rolesByParty.set(partyId,new Set());
    rolesByParty.get(partyId).add(role);
  }
  const issues=[],currentCheckpoints=[],openingCheckpoints=[];
  const issue=(reason,sourceGroup,sourceId=null,legacySheetRow=null)=>{
    issues.push({reason,sourceGroup,sourceId,legacySheetRow});
  };
  for(const item of identity.reviewItems){
    issue('IDENTITY_REVIEW_PENDING',item.sourceGroup,item.sourceId??null,item.legacySheetRow??null);
  }
  const push=(bucket,link,sourceField,kind,amountMinor,basis)=>{
    if(!amountMinor)return;
    bucket.push({partyId:link.partyId,sourceGroup:link.sourceGroup,sourceId:link.sourceId,
      kind,amountMinor,basis,sourceField});
  };
  const signed=(bucket,link,field,value,positiveKind,negativeKind,basis)=>{
    if(value>0)push(bucket,link,field,positiveKind,value,basis);
    else if(value<0)push(bucket,link,field,negativeKind,-value,basis);
  };
  const current='SOURCE_CURRENT',opening='HISTORICAL_OPENING';
  const masters=[
    {group:'CUSTOMERS',id:'Customer ID',due:'Current Due',base:'Opening Balance',
      positive:'CUSTOMER_RECEIVABLE',negative:'CUSTOMER_ADVANCE'},
    {group:'SUPPLIERS',id:'Supplier ID',due:'Current Due',base:'Opening Balance',
      positive:'SUPPLIER_PAYABLE',negative:'SUPPLIER_ADVANCE'},
    {group:'VENDORS',id:'Vendor ID'}
  ];
  for(const cfg of masters){
    for(const row of sourceRows[cfg.group]){
      const id=string(row?.[cfg.id]);
      const link=links.get(sourceKey(cfg.group,id));
      if(!link){
        issue('UNRESOLVED_MASTER_ID',cfg.group,id||null,row?._rowIndex??null);
        continue;
      }
      const required=cfg.group==='VENDORS'?
        ['Current Due','Current Receivable']:[cfg.due,cfg.base];
      if(required.some(field=>!Object.hasOwn(row,field))){
        issue('BALANCE_COLUMN_MISSING',cfg.group,id,row._rowIndex??null);
        continue;
      }
      if(cfg.group==='VENDORS'){
        const payable=toMinorUnits(row['Current Due']);
        const receivable=toMinorUnits(row['Current Receivable']);
        if(payable<0 || receivable<0){
          issue('VENDOR_NEGATIVE_DIRECTION',cfg.group,id,row._rowIndex??null);
          continue;
        }
        push(currentCheckpoints,link,'Current Due','VENDOR_PAYABLE',payable,current);
        push(currentCheckpoints,link,'Current Receivable','VENDOR_RECEIVABLE',receivable,current);
      }else{
        signed(currentCheckpoints,link,cfg.due,toMinorUnits(row[cfg.due]),
          cfg.positive,cfg.negative,current);
        signed(openingCheckpoints,link,cfg.base,toMinorUnits(row[cfg.base]),
          cfg.positive,cfg.negative,opening);
      }
    }
  }

  // Finance amounts must be derived separately for each stable source Person
  // ID and each original account (Owner, Lender, Borrower).
  let deletedFinanceRows=0;
  const ids=new Map();
  for(const row of financeRows){
    if(!row || typeof row!=='object'||Array.isArray(row))
      throw new Error('Invalid finance row');
    if(deleted(row)){deletedFinanceRows++;continue;}
    const id=string(row['Finance ID']).trim();
    if(!id){
      issue('FINANCE_ID_REQUIRED','FINANCE_TRANSACTIONS');
      continue;
    }
    if(!ids.has(id))ids.set(id,[]);
    ids.get(id).push(row);
  }
  // Prove the finance role on this exact original Person ID. A reviewed
  // Party merge may contain additional roles from OTHER original records;
  // they never authorize attributing one source ID's transaction to another.
  const financeRolesBySource=new Map(sourceRows.FINANCE_PERSONS.map(row=>[
    string(row['Person ID']),new Set(rolesForLegacyRow('FINANCE_PERSONS',row))
  ]));
  const perPerson=new Map();
  for(const [txId,rows] of [...ids].sort(([a],[b])=>a.localeCompare(b))){
    if(rows.length>1){
      issue('FINANCE_ID_DUPLICATE','FINANCE_TRANSACTIONS');
      continue;
    }
    const row=rows[0];
    const personId=string(row['Person ID']);
    // Preserve literal original identity; trim is used only for blank checking.
    // Normalizing nonblank IDs can silently attribute finance roles across masters.
    if(!personId.trim()){
      issue('FINANCE_PERSON_ID_REQUIRED','FINANCE_TRANSACTIONS');
      continue;
    }
    const link=links.get(sourceKey('FINANCE_PERSONS',personId));
    if(!link){
      issue('FINANCE_LEGACY_LINK_MISSING','FINANCE_PERSONS',personId);
      continue;
    }
    const meta=financeTypes[string(row['Transaction Type'])];
    if(!meta){
      issue('FINANCE_TYPE_UNKNOWN','FINANCE_TRANSACTIONS');
      continue;
    }
    const roles=rolesByParty.get(link.partyId)||new Set();
    if(!roles.has(meta.role) || !financeRolesBySource.get(personId)?.has(meta.role)){
      issue('FINANCE_ROLE_NOT_MAPPED','FINANCE_PERSONS',personId);
      continue;
    }
    // Master balance cells may be blank, but original finance transaction
    // writers require a present and strictly positive Amount.
    if(!Object.hasOwn(row,'Amount') || row['Amount']===null ||
      row['Amount']===undefined ||
      (typeof row['Amount']==='string' && !row['Amount'].trim())){
      issue('FINANCE_AMOUNT_REQUIRED','FINANCE_TRANSACTIONS');
      continue;
    }
    const amount=toMinorUnits(row['Amount']);
    if(amount<=0){
      issue(amount<0?'FINANCE_NEGATIVE_AMOUNT':'FINANCE_ZERO_AMOUNT',
        'FINANCE_TRANSACTIONS');
      continue;
    }
    if(!perPerson.has(personId))
      perPerson.set(personId,{link,totals:{owner:0,loanPayable:0,borrowerReceivable:0}});
    const state=perPerson.get(personId);
    const next=state.totals[meta.account]+meta.effect*amount;
    if(!Number.isSafeInteger(next))throw new Error('Invalid monetary amount or precision');
    state.totals[meta.account]=next;
  }
  for(const [personId,{link,totals}] of [...perPerson].sort(([a],[b])=>a.localeCompare(b))){
    for(const account of ['owner','loanPayable','borrowerReceivable']){
      const [positive,negative]=signedFinanceBuckets[account];
      signed(currentCheckpoints,link,'FINANCE_TRANSACTIONS.Amount',
        totals[account],positive,negative,current);
    }
  }

  const order=(a,b)=>
    a.sourceGroup.localeCompare(b.sourceGroup)||
    a.sourceId.localeCompare(b.sourceId)||
    a.kind.localeCompare(b.kind)||
    a.sourceField.localeCompare(b.sourceField);
  currentCheckpoints.sort(order);
  openingCheckpoints.sort(order);
  issues.sort((a,b)=>
    a.reason.localeCompare(b.reason)||
    a.sourceGroup.localeCompare(b.sourceGroup)||
    string(a.sourceId).localeCompare(string(b.sourceId))||
    (a.legacySheetRow??0)-(b.legacySheetRow??0));
  const gross=rows=>{
    const totals=new Map();
    for(const row of rows){
      const n=(totals.get(row.kind)||0)+row.amountMinor;
      if(!Number.isSafeInteger(n))throw new Error('Invalid monetary amount or precision');
      totals.set(row.kind,n);
    }
    return sortedObject(totals);
  };
  return {
    formatVersion:1,
    sourceCommit:'29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2',
    currency:'BDT',
    readyForAccountDesignReview:issues.length===0,
    grossCurrentTotalsMinor:gross(currentCheckpoints),
    grossOpeningTotalsMinor:gross(openingCheckpoints),
    currentCheckpoints,openingCheckpoints,blockingIssues:issues,
    summary:{
      proposedParties:identity.summary.proposedParties,
      reviewedIdentityGroups:identity.summary.reviewedGroups,
      pendingIdentityReviews:identity.summary.pendingIdentityReviews,
      sourceFinanceRows:financeRows.length,deletedFinanceRows,
      currentCheckpointCount:currentCheckpoints.length,
      historicalOpeningCheckpointCount:openingCheckpoints.length,
      effects:{cashMovementMinor:0,bankMovementMinor:0,postedLedgerRows:0}
    }
  };
}
