/**
 * M08 internal Cash Reconciliation explanation read projection.
 *
 * Source parity: CashReconciliation.gs:cashReconciliationEvaluate_ and helpers,
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * This is not a writer. Caller supplies raw, already-loaded Cash Book rows;
 * session boundaries, permission checks, SQL writes, and idempotency belong
 * to a separately reviewed M03/M04/M08 financial posting integration.
 */
function money(value) {
  const number=Number(value)||0;
  return Math.round((number+Number.EPSILON)*100)/100;
}

function parseEntryIds(value) {
  let values;
  if(Array.isArray(value)) {
    values=value;
  } else {
    const raw=String(value||'').trim();
    if(!raw)return [];
    values=[];
    try {
      const parsed=JSON.parse(raw);
      if(Array.isArray(parsed))values=parsed;
    } catch {
      values=raw.split(/[\n,]+/);
    }
  }
  return [...new Set(values.map(String).map(id=>id.trim()).filter(Boolean))];
}

function signedCash(row) {
  return money((Number(row['Credit'])||0)-(Number(row['Debit'])||0));
}

function deleted(row) {
  return row['Is Deleted']===true ||
    String(row['Is Deleted']||'').toUpperCase()==='TRUE';
}

function synthetic(row) {
  return row['Type']==='Session Open' ||
    row['Type']==='Day Close Adjustment';
}

/**
 * Evaluate whether existing Cash Book entries exactly explain a session
 * difference. A true baseline is a historical starting point, not turnover.
 */
export function evaluateCashExplanation(difference,storedEntryIds,cashRows,{isBaseline=false}={}) {
  if(!Array.isArray(cashRows) ||
     cashRows.some(row=>!row || typeof row!=='object' || Array.isArray(row)))
    throw new TypeError('Cash Book rows must be a loaded record array');

  const ids=parseEntryIds(storedEntryIds);
  if(isBaseline) {
    return {state:'Baseline',requiredDirection:'',requiredAmount:0,
      linkedAmount:0,remainingAmount:0,entryIds:ids};
  }
  if(difference==='' || difference===null || difference===undefined) {
    return {state:'Open',requiredDirection:'',requiredAmount:0,
      linkedAmount:0,remainingAmount:0,entryIds:ids};
  }

  const diff=money(Number(difference)||0);
  const direction=diff<0?'Cash Out':diff>0?'Cash In':'';
  const required=money(Math.abs(diff));
  if(diff===0) {
    return {state:ids.length?'Needs Review':'Balanced',requiredDirection:'',
      requiredAmount:0,linkedAmount:0,remainingAmount:0,entryIds:ids};
  }
  if(!ids.length) {
    return {state:'Unexplained',requiredDirection:direction,
      requiredAmount:required,linkedAmount:0,remainingAmount:required,entryIds:[]};
  }

  const byId=new Map();
  for(const row of cashRows) {
    const id=String(row['Entry ID']||'');
    if(id)byId.set(id,row);
  }
  let signedTotal=0;
  let invalid=false;
  for(const id of ids) {
    const row=byId.get(id);
    if(!row || deleted(row) || synthetic(row)) {
      invalid=true;
      continue;
    }
    const signed=signedCash(row);
    if(!signed || (diff<0 && signed>=0) || (diff>0 && signed<=0)) {
      invalid=true;
      continue;
    }
    signedTotal=money(signedTotal+signed);
  }

  const linked=money(Math.abs(signedTotal));
  const remaining=money(Math.max(0,required-linked));
  const exact=!invalid && money(signedTotal-diff)===0;
  return {state:exact?'Explained':'Needs Review',requiredDirection:direction,
    requiredAmount:required,linkedAmount:linked,
    remainingAmount:exact?0:remaining,entryIds:ids};
}
