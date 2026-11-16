/**
 * M08 internal, read-only Cash Reconciliation candidate selection.
 *
 * Source parity: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * CashReconciliation.gs:getCashReconciliationCandidates.
 *
 * Caller must load authorized source-shaped rows first. This function is NOT
 * a public RPC, does not grant permissions, and cannot save explanations,
 * retire legacy entries, move money or mutate a Cash Session.
 */
import {evaluateCashExplanation} from './m08-cash-reconciliation-explanation.js';
import {projectCashReconciliationSessions} from './m08-cash-reconciliation-session-overview.js';
import {safeSourceDateOnly} from './source-date-only.js';

function loadedRows(rows,name) {
  if(!Array.isArray(rows) || rows.some(row=>
    !row || typeof row!=='object' || Array.isArray(row)))
    throw new TypeError(name+' must be a loaded record array');
  return rows;
}

function uniqueIds(rows,column,label) {
  const seen=new Set();
  for(const row of rows) {
    const id=String(row[column]||'');
    if(!id)continue;
    if(seen.has(id))throw new Error('Duplicate '+label);
    seen.add(id);
  }
}

function money(value) {
  return Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;
}

function signed(row) {
  return money((Number(row['Credit'])||0)-(Number(row['Debit'])||0));
}

function deleted(row) {
  return row['Is Deleted']===true ||
    String(row['Is Deleted']||'').toUpperCase()==='TRUE';
}

function synthetic(row) {
  const type=String(row['Type']||'');
  return type==='Session Open' || type==='Day Close Adjustment';
}

function sortKey(value) {
  if(!value)return 0;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?String(value):date.getTime();
}

function parsedIds(ids,cashRows) {
  // Reuse the frozen-source-compatible parser from M08 explanation.
  return evaluateCashExplanation('',ids,cashRows).entryIds;
}

function linkedUsage(sessions,cashRows) {
  const useById=new Map();
  for(const session of sessions) {
    for(const phase of ['opening','closing']) {
      const field=phase==='opening'
        ?'Opening Explanation Entry IDs'
        :'Closing Explanation Entry IDs';
      for(const id of parsedIds(session[field],cashRows)) {
        if(!useById.has(id))useById.set(id,[]);
        useById.get(id).push({
          sessionId:String(session['Session ID']||''),phase
        });
      }
    }
  }
  return useById;
}

/**
 * Return a source-shaped successful candidate payload for an existing
 * session discrepancy. Source fail_ outcomes become explicit exceptions.
 *
 * Unlike the old Sheets implementation, ambiguous duplicate Session IDs
 * and Cash Book Entry IDs fail closed; a wrong match must not be presented
 * as an eligible real-world financial transaction.
 */
export function projectCashReconciliationCandidates(
  sessionRows,cashRows,{sessionId,phase,query='',timeZone}={}
) {
  const sessions=loadedRows(sessionRows,'Cash Session rows');
  const cash=loadedRows(cashRows,'Cash Book rows');
  if(typeof timeZone!=='string' || !timeZone.trim())
    throw new TypeError('Explicit business timeZone is required');
  uniqueIds(sessions,'Session ID','Cash Session ID');
  uniqueIds(cash,'Entry ID','Cash Book Entry ID');

  const normalizedPhase=String(phase||'').toLowerCase();
  if(normalizedPhase!=='opening' && normalizedPhase!=='closing')
    throw new Error('Choose opening or closing reconciliation.');

  const wanted=String(sessionId||'');
  const built=projectCashReconciliationSessions(sessions,cash,{timeZone})
    .find(row=>row.sessionId===wanted);
  if(!built)throw new Error('Cash session not found.');

  const prefix=normalizedPhase;
  const difference=built[prefix+'Difference'];
  const requiredAmount=built[prefix+'RequiredAmount'];
  if(difference==='' || Number(requiredAmount)<=0)
    throw new Error('This cash-session phase has no difference to explain.');

  const requiredDirection=built[prefix+'RequiredDirection'];
  const storedSelectedIds=parsedIds(built[prefix+'ExplanationEntryIds'],cash);
  const usage=linkedUsage(sessions,cash);
  const byId=new Map();
  for(const row of cash) {
    const id=String(row['Entry ID']||'');
    if(id)byId.set(id,row);
  }

  const usedElsewhere=id=>(usage.get(id)||[]).some(use=>
    use.sessionId!==wanted || use.phase!==normalizedPhase
  );

  const selectedIds=[];
  const staleEntryIds=[];
  for(const entryId of storedSelectedIds) {
    const row=byId.get(entryId);
    const movement=row?signed(row):0;
    const correctSign=!!movement &&
      ((difference<0 && movement<0) || (difference>0 && movement>0));
    if(row && !deleted(row) && !synthetic(row) && correctSign &&
       !usedElsewhere(entryId))
      selectedIds.push(entryId);
    else
      staleEntryIds.push(entryId);
  }

  const selectedMap=new Set(selectedIds);
  const q=String(query||'').trim().toLowerCase();
  const candidates=cash.filter(row=>{
    const entryId=String(row['Entry ID']||'');
    if(!entryId || deleted(row) || synthetic(row))return false;
    const movement=signed(row);
    if(!movement ||
       (difference<0 && movement>=0) ||
       (difference>0 && movement<=0))return false;
    if(usedElsewhere(entryId) && !selectedMap.has(entryId))return false;
    if(q) {
      const haystack=[
        entryId,row['Date'],row['Type'],row['Reference'],row['Description']
      ].join(' ').toLowerCase();
      if(!haystack.includes(q))return false;
    }
    return true;
  }).sort((a,b)=>{
    const aKey=sortKey(a['Date']);
    const bKey=sortKey(b['Date']);
    if(typeof aKey==='number' && typeof bKey==='number' && aKey!==bKey)
      return bKey-aKey;
    return (Number(b._rowIndex)||0)-(Number(a._rowIndex)||0);
  }).slice(0,250).map(row=>{
    const movement=signed(row);
    const id=String(row['Entry ID']||'');
    return {
      entryId:id,
      date:safeSourceDateOnly(row['Date'],timeZone),
      type:row['Type']||'',
      reference:row['Reference']||'',
      description:row['Description']||'',
      direction:movement<0?'Cash Out':'Cash In',
      amount:money(Math.abs(movement)),
      selected:selectedMap.has(id)
    };
  });

  return {
    sessionId:built.sessionId,
    phase:normalizedPhase,
    difference,
    requiredDirection,
    requiredAmount,
    selectedEntryIds:selectedIds,
    staleEntryIds,
    candidates
  };
}
