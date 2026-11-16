/**
 * M08 read-only Cash Reconciliation session overview.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * CashReconciliation.gs:cashReconciliationBuildRows_.
 *
 * This is an internal projection over already-loaded source-shaped records.
 * It does not read or write D1, move Cash/Bank, transition Cash Session
 * status, authorize actors or expose RPC.
 */
import {evaluateCashExplanation} from './m08-cash-reconciliation-explanation.js';
import {safeSourceDateOnly} from './source-date-only.js';

function money(value) {
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function loadedRows(rows,name) {
  if(!Array.isArray(rows) || rows.some(row=>
    !row || typeof row!=='object' || Array.isArray(row)))
    throw new TypeError(name+' must be a loaded record array');
  return rows;
}

function sortKey(value) {
  if(!value)return 0;
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?String(value):parsed.getTime();
}

function hasValue(value) {
  return value!=='' && value!==null && value!==undefined;
}

function uncountedClosingExplanation(status,linkedIds,cashRows) {
  return {
    state:status==='Closed'?'Needs Review':status==='Closing'?'Closing':'Open',
    requiredDirection:'',
    requiredAmount:0,
    linkedAmount:0,
    remainingAmount:0,
    entryIds:evaluateCashExplanation('',linkedIds,cashRows).entryIds
  };
}

/**
 * Return original Cash Reconciliation grid rows, in chronological session
 * order. Both row sets must be fully awaited and source-shaped.
 * `timeZone` is the trusted business timezone, never a browser locale.
 */
export function projectCashReconciliationSessions(sessionRows,cashRows,{timeZone}={}) {
  const sessions=loadedRows(sessionRows,'sessionRows');
  const cash=loadedRows(cashRows,'cashRows');
  if(typeof timeZone!=='string' || !timeZone.trim())
    throw new TypeError('Explicit business timeZone is required');

  const sorted=sessions.slice().sort((a,b)=>{
    const aKey=sortKey(a['Opened At']||a['Date']||'');
    const bKey=sortKey(b['Opened At']||b['Date']||'');
    return typeof aKey==='number' && typeof bKey==='number'
      ?aKey-bKey:String(aKey).localeCompare(String(bKey));
  });
  let previousClosedCounted=null;

  return sorted.map(session=>{
    const sessionId=String(session['Session ID']||'');
    const status=String(session['Status']||'');
    const openingCounted=money(Number(session['Opening Cash'])||0);
    const isBaseline=previousClosedCounted===null;
    const openingExpected=isBaseline?'':previousClosedCounted;
    const openingDifference=isBaseline?'':money(openingCounted-openingExpected);
    const opening=evaluateCashExplanation(
      openingDifference,session['Opening Explanation Entry IDs'],cash,
      {isBaseline}
    );

    const hasExpected=hasValue(session['Expected Cash']);
    const hasCounted=hasValue(session['Counted Cash']);
    const hasVariance=hasValue(session['Variance']);
    const closingExpected=hasExpected?money(Number(session['Expected Cash'])||0):'';
    const closingCounted=hasCounted?money(Number(session['Counted Cash'])||0):'';
    const closingDifference=hasVariance
      ?money(Number(session['Variance'])||0)
      :(hasExpected && hasCounted?money(closingCounted-closingExpected):'');
    const closing=hasExpected && hasCounted
      ?evaluateCashExplanation(
        closingDifference,session['Closing Explanation Entry IDs'],cash
      )
      :uncountedClosingExplanation(
        status,session['Closing Explanation Entry IDs'],cash
      );

    const phaseStates=[opening.state,closing.state];
    let reconciliationState='Balanced';
    if(phaseStates.includes('Needs Review') ||
       phaseStates.includes('Unexplained'))
      reconciliationState='Needs Review';
    else if(status!=='Closed')
      reconciliationState=status==='Closing'?'Closing':'Open';
    else if(phaseStates.includes('Explained'))
      reconciliationState='Explained';

    const row={
      sessionId,
      date:safeSourceDateOnly(session['Date']||session['Opened At'],timeZone),
      openedAt:session['Opened At']||'',
      closedAt:session['Closed At']||'',
      sessionStatus:status,

      openingExpected,
      openingCounted,
      openingDifference,
      openingState:opening.state,
      openingRequiredDirection:opening.requiredDirection,
      openingRequiredAmount:opening.requiredAmount,
      openingLinkedAmount:opening.linkedAmount,
      openingRemainingAmount:opening.remainingAmount,
      openingExplanationEntryIds:opening.entryIds,

      closingExpected,
      closingCounted,
      closingDifference,
      closingState:closing.state,
      closingRequiredDirection:closing.requiredDirection,
      closingRequiredAmount:closing.requiredAmount,
      closingLinkedAmount:closing.linkedAmount,
      closingRemainingAmount:closing.remainingAmount,
      closingExplanationEntryIds:closing.entryIds,

      reconciliationState,
      needsReview:reconciliationState==='Needs Review',
      notes:session['Notes']||''
    };
    if(status==='Closed' && hasCounted)
      previousClosedCounted=closingCounted;
    return row;
  });
}
