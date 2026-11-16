/**
 * M08 internal READ-ONLY expected-cash and variance recalculation.
 *
 * Frozen reference: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * CashReconciliation.gs:cashReconciliationRecalculateClosedSession_.
 *
 * This is NOT a writer. A future authenticated, atomic D1 operation must
 * revalidate against its own consistent database snapshot before posting.
 */
import {evaluateCashExplanation} from './m08-cash-reconciliation-explanation.js';

function loadedRecords(rows,label) {
  if(!Array.isArray(rows) || rows.some(row=>
    !row || typeof row!=='object' || Array.isArray(row)))
    throw new TypeError(label+' must be a fully loaded record array');
  return rows;
}

function money(value) {
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
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

function ids(value,cashRows) {
  return evaluateCashExplanation('',value,cashRows).entryIds;
}

function ensureUniqueIds(rows,field,description) {
  const found=new Set();
  for(const row of rows) {
    const id=String(row[field]||'');
    if(!id)continue;
    if(found.has(id))throw new Error('Duplicate '+description);
    found.add(id);
  }
}

function linkedUsage(sessionRows,cashRows) {
  const byId=new Map();
  for(const session of sessionRows) {
    const sessionId=String(session['Session ID']||'');
    for(const [phase,field] of [
      ['opening','Opening Explanation Entry IDs'],
      ['closing','Closing Explanation Entry IDs']
    ]) {
      for(const id of ids(session[field],cashRows)) {
        if(!byId.has(id))byId.set(id,[]);
        byId.get(id).push({sessionId,phase});
      }
    }
  }
  return byId;
}

/**
 * Return source-shaped `{expected,variance}` or null.
 *
 * Cash Book **array order** is the original session transaction chronology;
 * do not sort by Date. Late closing explanations are attributed exactly once,
 * even if posted after a later Session Open marker.
 *
 * Ambiguous duplicate IDs/markers fail closed (stricter than source Sheets).
 */
export function recalculateClosedSessionCash(session,sessionRows,cashRows) {
  const sessions=loadedRecords(sessionRows,'Cash Session rows');
  const cash=loadedRecords(cashRows,'Cash Book rows');
  if(session!==null &&
    (!session || typeof session!=='object' || Array.isArray(session)))
    throw new TypeError('Session must be a source-shaped record or null');

  ensureUniqueIds(sessions,'Session ID','Cash Session ID');
  ensureUniqueIds(cash,'Entry ID','Cash Book Entry ID');

  if(!session || (session['Status']!=='Closed' && session['Status']!=='Closing'))
    return null;

  const sessionId=String(session['Session ID']||'');
  const markers=[];
  for(let i=0;i<cash.length;i++) {
    if(String(cash[i]['Type']||'')==='Session Open' &&
       String(cash[i]['Reference']||'')===sessionId)
      markers.push(i);
  }
  if(markers.length>1)throw new Error('Duplicate Session Open marker');
  if(!markers.length)return null;

  const first=markers[0];
  let next=cash.length;
  for(let i=first+1;i<cash.length;i++) {
    if(String(cash[i]['Type']||'')==='Session Open') {
      next=i;
      break;
    }
  }

  const usage=linkedUsage(sessions,cash);
  const opening=new Set(ids(session['Opening Explanation Entry IDs'],cash));
  const closingIds=ids(session['Closing Explanation Entry IDs'],cash);
  const closing=new Set(closingIds);
  const counted=new Set();
  let movement=0;

  for(let i=first+1;i<next;i++) {
    const row=cash[i];
    if(deleted(row) || synthetic(row))continue;
    const entryId=String(row['Entry ID']||'');
    if(entryId && opening.has(entryId))continue;

    if(entryId) {
      const belongsToClosing=closing.has(entryId);
      const usedElsewhere=(usage.get(entryId)||[]).some(use=>
        use.sessionId!==sessionId || use.phase!=='closing'
      );
      if(usedElsewhere && !belongsToClosing)continue;
      if(belongsToClosing)counted.add(entryId);
    }

    movement=money(movement+signed(row));
  }

  // Any valid linked closing entry outside the native window also belongs
  // to this session. Entries already counted above must not be counted again.
  const byId=new Map();
  for(const row of cash) {
    const id=String(row['Entry ID']||'');
    if(id)byId.set(id,row);
  }
  for(const entryId of closingIds) {
    if(counted.has(entryId))continue;
    const row=byId.get(entryId);
    if(!row || deleted(row) || synthetic(row))continue;
    movement=money(movement+signed(row));
  }

  const expected=money((Number(session['Opening Cash'])||0)+movement);
  const hasCounted=session['Counted Cash']!=='' &&
    session['Counted Cash']!==null &&
    session['Counted Cash']!==undefined;
  const variance=hasCounted
    ?money((Number(session['Counted Cash'])||0)-expected)
    :'';
  return {expected,variance};
}
