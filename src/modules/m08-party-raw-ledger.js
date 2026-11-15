/**
 * M08 internal raw Customer/Supplier ledger index only.
 *
 * Source parity: original PartyLedger.gs:partyLedgerBuildAscendingIndex_ and
 * DeleteEngine.gs:isDeleted_, pinned at
 * Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * This is NOT the business-facing clean/invoice projection, a Party account
 * merger, a D1 repository, or a public RPC. Reads preloaded source-shaped
 * rows only. Finance Owner/Lender/Borrower and Vendor accounts are separate.
 */
const ID_COLUMNS=Object.freeze({
  customer:'Customer ID',
  supplier:'Supplier ID'
});

function money(value) {
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
}

function isDeleted(row) {
  const value=row['Is Deleted'];
  return value===true || String(value||'').toUpperCase()==='TRUE';
}

function stableKey(row) {
  const date=String(row['Date']||'').slice(0,10);
  const sheetRow=String(row._rowIndex||0).padStart(10,'0');
  return date+'|'+sheetRow+'|'+String(row['Ledger ID']||'');
}

/**
 * Return original raw audit rows, sorted and signed independently per legacy
 * Customer ID or Supplier ID. Never infer Party identity from name or phone.
 */
export function projectRawLegacyPartyLedger(kind,legacyId,rawRows) {
  const idColumn=ID_COLUMNS[kind];
  if(!Object.hasOwn(ID_COLUMNS,kind) || !idColumn)
    throw new TypeError('Expected customer or supplier ledger kind');
  if(typeof legacyId!=='string' || !legacyId.trim())
    throw new TypeError('Explicit legacy Customer/Supplier ID required');
  if(!Array.isArray(rawRows))
    throw new TypeError('rawRows must be a loaded array');

  const rows=rawRows
    .filter(row=>String(row[idColumn]||'')===legacyId && !isDeleted(row))
    .map(row=>({...row}))
    .sort((a,b)=>stableKey(a).localeCompare(stableKey(b)));

  let balance=0;
  for(const row of rows) {
    balance=money(balance+(Number(row['Debit'])||0)-(Number(row['Credit'])||0));
    row._displayBalance=balance;
    row._stableKey=stableKey(row);
  }
  return {
    kind,
    legacyId,
    rows,
    closingBalance:balance
  };
}
