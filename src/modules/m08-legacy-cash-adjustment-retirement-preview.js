/**
 * M08 internal, READ-ONLY legacy cash adjustment retirement preview.
 *
 * Pinned original source:
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * CashReconciliation.gs:cashReconciliationRetireLegacyAdjustment_.
 *
 * This only describes what the original GAS writer WOULD change.
 * It never updates Cash Book, calls D1, authorizes an actor, persists an
 * explanation, or retires a financial movement. The returned proposals
 * MUST NOT be applied without a separately reviewed authenticated atomic
 * D1 transaction with exactly-once and rollback safeguards.
 */

function loadedRows(rows) {
  if(!Array.isArray(rows) || rows.some(row=>
    !row || typeof row!=='object' || Array.isArray(row)))
    throw new TypeError('Cash Book rows must be a loaded record array');
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

function uniqueEntryIds(rows) {
  const seen=new Set();
  for(const row of rows) {
    const id=String(row['Entry ID']||'');
    if(!id)continue;
    if(seen.has(id))throw new Error('Duplicate Cash Book Entry ID');
    seen.add(id);
  }
}

function physicalRowIndex(row,position) {
  const raw=row._rowIndex;
  const converted=Number(raw);
  const fallback=position+2;

  // GAS silently falls back to the array position for empty, false or 0
  // legacy markers. Nonempty invalid markers are corrupt import evidence.
  if(raw!==undefined && raw!==null && raw!=='' && raw!==false &&
    ( !Number.isFinite(converted) || converted<0 ||
      !Number.isSafeInteger(converted)))
    throw new Error('Invalid Cash Book row index');

  const effective=converted||fallback;
  if(!Number.isSafeInteger(effective) || effective<2)
    throw new Error('Invalid Cash Book row index');
  return effective;
}

/**
 * Preview source-shaped calls to original updateRowFields_ without calling it.
 *
 * Each output item describes a candidate legacy adjustment. Only the frozen
 * source's Type/Reference/deleted/nonzero filters determine eligibility;
 * never infer eligibility from amounts, dates, linked Party, or UI state.
 */
export function previewLegacyCashAdjustmentRetirement(
  cashRows,{sessionId,phase}={}
) {
  const cash=loadedRows(cashRows);
  const wanted=String(sessionId||'');
  if(!wanted.trim())
    throw new Error('Session reference is required');
  if(phase!=='opening' && phase!=='closing')
    throw new Error('Choose opening or closing reconciliation.');

  uniqueEntryIds(cash);
  const targetType=phase==='opening'?'Session Open':'Day Close Adjustment';
  const usedRows=new Set();
  const proposals=[];
  const suffix='legacy automatic adjustment retired by Cash Reconciliation';

  for(let index=0;index<cash.length;index++) {
    const row=cash[index];
    if(deleted(row))continue;
    if(String(row['Type']||'')!==targetType ||
       String(row['Reference']||'')!==wanted)continue;
    if(signed(row)===0)continue;

    const rowIndex=physicalRowIndex(row,index);
    if(usedRows.has(rowIndex))
      throw new Error('Duplicate Cash Book row index');
    usedRows.add(rowIndex);
    const description=String(row['Description']||'').trim();
    proposals.push({
      table:'CASH_BOOK',
      rowIndex,
      fields:{
        Debit:'',
        Credit:'',
        Description:description?description+' — '+suffix:suffix
      }
    });
  }

  return proposals;
}
