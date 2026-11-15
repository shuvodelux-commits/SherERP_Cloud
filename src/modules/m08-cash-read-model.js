/**
 * M08 internal Cash Book / Cash Session read projections.
 *
 * Source behavior: legacy/source/CashBook.gs:getCashBalance_ and
 * CashSession.gs:cashSessionSummaryFromRows_, pinned at Mohim_ERP
 * 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * Pure calculations only. No repository, auth, public RPC, persistence,
 * cash session transition, financial posting or side effects.
 * A future authorized repository MUST supply already-active Cash Book
 * rows in posting order; never pass raw soft-deleted rows here.
 */
function money(value) {
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}
function checkedRows(value,name) {
  if(!Array.isArray(value)) throw new TypeError(name+' must be a loaded array');
  return value;
}

/** Cash on hand, recalculated from live movements, not stale stored Balance. */
export function cashBalance(activeCashRows) {
  const rows=checkedRows(activeCashRows,'activeCashRows');
  return money(rows.reduce((total,row)=>
    total+(Number(row['Credit'])||0)-(Number(row['Debit'])||0),0));
}

function explanationIds(value) {
  if(Array.isArray(value)) return value.map(String).filter(Boolean);
  const raw=String(value||'').trim();
  if(!raw) return [];
  try {
    const parsed=JSON.parse(raw);
    return Array.isArray(parsed)?parsed.map(String).filter(Boolean):[];
  } catch {
    return raw.split(/[\n,]+/).map(id=>id.trim()).filter(Boolean);
  }
}

function linkedExplanationIds(sessions) {
  const linked=new Set();
  for(const row of sessions) {
    for(const entryId of [
      ...explanationIds(row['Opening Explanation Entry IDs']),
      ...explanationIds(row['Closing Explanation Entry IDs'])
    ]) linked.add(String(entryId));
  }
  return linked;
}

function cashMismatch(session,sessions,currentCash) {
  const index=sessions.findIndex(row=>
    row['Session ID']===session['Session ID']);
  let previous=null;
  for(let i=index-1;i>=0;i--) {
    if(sessions[i]['Status']==='Closed') {
      previous=sessions[i];
      break;
    }
  }
  if(!previous) return null;

  const opening=money(Number(session['Opening Cash'])||0);
  const previousCounted=money(Number(previous['Counted Cash'])||0);
  if(opening===previousCounted || currentCash===opening) return null;
  return {
    direction:opening<previousCounted?'less':'more',
    amount:money(Math.abs(opening-previousCounted))
  };
}

/**
 * Build a session snapshot from already-loaded active rows only.
 *
 * Returns the original legacy fields, without opening/closing sessions,
 * writing Cash Book records or performing access checks. `null` session
 * means no active session; a leaked Promise/invalid row set is an error.
 */
export function cashSessionSnapshot(session,sessionRows,activeCashRows) {
  const sessions=checkedRows(sessionRows,'sessionRows');
  const cashRows=checkedRows(activeCashRows,'activeCashRows');
  if(session===null) return null;
  if(!session || typeof session!=='object' || Array.isArray(session))
    throw new TypeError('session must be a loaded record or null');

  const markerIndex=cashRows.findIndex(row=>
    row['Type']==='Session Open' &&
    row['Reference']===session['Session ID']);
  const startIndex=markerIndex===-1?cashRows.length:markerIndex+1;
  const linked=linkedExplanationIds(sessions);
  let cashIn=0;
  let cashOut=0;

  for(let i=startIndex;i<cashRows.length;i++) {
    const row=cashRows[i];
    if(row['Type']==='Historical Opening') continue;
    const entryId=String(row['Entry ID']||'');
    if(entryId && linked.has(entryId)) continue;
    if(session['Status']==='Closing' &&
      row['Type']==='Day Close Adjustment' &&
      row['Reference']===session['Session ID']) continue;
    cashIn=money(cashIn+(Number(row['Credit'])||0));
    cashOut=money(cashOut+(Number(row['Debit'])||0));
  }

  const openingCash=money(Number(session['Opening Cash'])||0);
  const currentCash=cashBalance(cashRows);
  const calculatedExpected=money(openingCash+cashIn-cashOut);
  const expectedCash=session['Status']==='Closing' &&
    session['Expected Cash']!==''
    ?money(Number(session['Expected Cash'])||0)
    :calculatedExpected;
  return {
    sessionId:session['Session ID'],
    status:session['Status'],
    openedAt:session['Opened At'],
    openingCash,
    cashIn,
    cashOut,
    expectedCash,
    countedCash:session['Status']==='Closing'
      ?money(Number(session['Counted Cash'])||0):'',
    notes:session['Notes']||'',
    cashMismatch:cashMismatch(session,sessions,currentCash)
  };
}
