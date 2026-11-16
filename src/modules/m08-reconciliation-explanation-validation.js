/**
 * M08 Cash Reconciliation explanation submission validation: READ-ONLY.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * CashReconciliation.gs:saveCashReconciliationExplanation, stopping BEFORE
 * its first Cash Book/session mutation.
 *
 * This validates a snapshot only. It does not persist an explanation,
 * authorize the caller, retire synthetic cash entries, recalculate closed
 * sessions, move money or protect against concurrent submissions. A future
 * authenticated D1 writer must repeat every check inside an atomic DB guard.
 */
import {evaluateCashExplanation} from './m08-cash-reconciliation-explanation.js';
import {projectCashReconciliationCandidates} from './m08-cash-reconciliation-candidates.js';

function loadedRows(rows,label) {
  if(!Array.isArray(rows) || rows.some(row=>
    !row || typeof row!=='object' || Array.isArray(row)))
    throw new TypeError(label+' must be a loaded record array');
  return rows;
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

function parsedIds(ids,cashRows) {
  return evaluateCashExplanation('',ids,cashRows).entryIds;
}

function linkedUsage(sessionRows,cashRows) {
  const usage=new Map();
  for(const session of sessionRows) {
    const sessionId=String(session['Session ID']||'');
    for(const [phase,field] of [
      ['opening','Opening Explanation Entry IDs'],
      ['closing','Closing Explanation Entry IDs']
    ]) {
      for(const entryId of parsedIds(session[field],cashRows)) {
        if(!usage.has(entryId))usage.set(entryId,[]);
        usage.get(entryId).push({sessionId,phase});
      }
    }
  }
  return usage;
}

/**
 * Return a *validation-only* source-shaped success payload or throw the
 * source's first relevant pre-write validation error. This function is not
 * an RPC or a commit authorization; valid input can become stale immediately.
 *
 * Duplicate imported Cash Session/Book IDs and unresolved Promises are
 * rejected rather than guessed, strengthening the original Sheets behavior.
 */
export function validateCashReconciliationExplanation(
  sessionRows,cashRows,{sessionId,phase,entryIds,timeZone}={}
) {
  const sessions=loadedRows(sessionRows,'Cash Session rows');
  const cash=loadedRows(cashRows,'Cash Book rows');
  if(typeof timeZone!=='string' || !timeZone.trim())
    throw new TypeError('Explicit business timeZone is required');

  const normalizedPhase=String(phase||'').toLowerCase();
  if(normalizedPhase!=='opening' && normalizedPhase!=='closing')
    throw new Error('Choose opening or closing reconciliation.');

  const ids=parsedIds(entryIds,cash);
  if(!ids.length)
    throw new Error('Select the real ERP transaction that explains this difference.');

  // Merged M08 candidate model retains source phase/difference semantics and
  // refuses ambiguous duplicate IDs. It may show only 250 UI candidates, but
  // the validation below checks ALL loaded cash rows by their original ID.
  const meta=projectCashReconciliationCandidates(sessions,cash,{
    sessionId,phase:normalizedPhase,timeZone
  });

  const usage=linkedUsage(sessions,cash);
  const byId=new Map();
  for(const row of cash) {
    const id=String(row['Entry ID']||'');
    if(id)byId.set(id,row);
  }

  const wanted=String(sessionId||'');
  let signedTotal=0;
  for(const entryId of ids) {
    const otherUses=(usage.get(entryId)||[]).some(use=>
      use.sessionId!==wanted || use.phase!==normalizedPhase
    );
    if(otherUses)
      throw new Error('Cash Book entry '+entryId+
        ' is already linked to another reconciliation.');

    const row=byId.get(entryId);
    if(!row || deleted(row))
      throw new Error('Cash Book entry '+entryId+' is missing or deleted.');
    if(synthetic(row))
      throw new Error('Choose a real ERP transaction, not a cash-session adjustment.');

    const movement=signed(row);
    if(!movement ||
      (meta.difference<0 && movement>=0) ||
      (meta.difference>0 && movement<=0))
      throw new Error('Selected transactions must all match the required '+
        meta.requiredDirection+' direction.');

    signedTotal=money(signedTotal+movement);
  }

  if(money(signedTotal-Number(meta.difference))!==0)
    throw new Error('Selected transactions must total exactly '+
      meta.requiredDirection+' '+meta.requiredAmount+'.');

  return {
    sessionId:wanted,
    phase:normalizedPhase,
    state:'Explained',
    entryIds:ids,
    requiredDirection:meta.requiredDirection,
    requiredAmount:meta.requiredAmount
  };
}
