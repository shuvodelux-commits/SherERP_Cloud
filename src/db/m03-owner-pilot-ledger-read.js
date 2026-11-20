/**
 * M08/M03: read-only projections over the EXISTING, narrow first-Shop MVP.
 *
 * This is not the full Cash/Bank/Party ledger: the current pilot has only
 * unpaid supplier Purchases, cash-only POS Sales and cash-only Returns.
 * Never invent an opening Cash Book entry, bank transfer, expense,
 * customer due, supplier payment or historical opening amount.
 *
 * Caller MUST validate the current Owner session and immutable Shop D1
 * identity before passing the Shop D1 binding. No writes or migrations here.
 */
const PAGE_SIZE=50;
const safePaisa=(value)=>{
  if(!Number.isSafeInteger(value))throw Error('Untrusted ledger amount');
  return value;
};
const checkedRows=rows=>{
  if(!Array.isArray(rows))throw Error('Ledger snapshot unavailable');
  return rows;
};

export async function readOwnerPilotCashBook(db){
  const [totals,entries]=await db.batch([
    db.prepare(`SELECT
      (SELECT COALESCE(SUM(received_paisa),0) FROM owner_mvp_sale_cash_book) AS receivedPaisa,
      (SELECT COALESCE(SUM(debit_paisa),0) FROM owner_mvp_return_cash_book) AS paidPaisa`),
    db.prepare(`SELECT kind,reference,occurredAtMs,sessionId,receivedPaisa,paidPaisa FROM (
      SELECT 'Cash Sale' AS kind,'INV-'||printf('%06d',s.sequence) AS reference,
        s.created_at_ms AS occurredAtMs,b.cash_sequence AS sessionId,
        b.received_paisa AS receivedPaisa,0 AS paidPaisa,s.sequence AS recordSequence
      FROM owner_mvp_sale_cash_book b
      JOIN owner_mvp_sale_receipts s ON s.sequence=b.sale_sequence
      UNION ALL
      SELECT 'Cash Return' AS kind,'SRT-'||printf('%06d',r.sequence) AS reference,
        r.created_at_ms AS occurredAtMs,b.cash_sequence AS sessionId,
        0 AS receivedPaisa,b.debit_paisa AS paidPaisa,r.sequence AS recordSequence
      FROM owner_mvp_return_cash_book b
      JOIN owner_mvp_sale_return_receipts r ON r.sequence=b.return_sequence
    ) ORDER BY occurredAtMs DESC,recordSequence DESC,kind DESC LIMIT 51`)
  ]);
  if(!totals.success||!entries.success||totals.results.length!==1)
    throw Error('Cash Book snapshot unavailable');
  const receivedPaisa=safePaisa(totals.results[0].receivedPaisa);
  const paidPaisa=safePaisa(totals.results[0].paidPaisa);
  const netPaisa=safePaisa(receivedPaisa-paidPaisa);
  const records=checkedRows(entries.results);
  for(const row of records){
    safePaisa(row.receivedPaisa);
    safePaisa(row.paidPaisa);
    if(!Number.isSafeInteger(row.occurredAtMs)||!Number.isSafeInteger(row.sessionId))
      throw Error('Cash Book row unavailable');
  }
  return {
    scope:'cash-sale-and-cash-return-only',
    receivedPaisa,paidPaisa,netPaisa,
    entries:records.slice(0,PAGE_SIZE),
    hasMore:records.length>PAGE_SIZE
  };
}

export async function readOwnerPilotSupplierPurchaseLedger(db,supplierId){
  if(typeof supplierId!=='string'||!/^SUP-\d{6}$/.test(supplierId))
    return null;
  const [identity,totals,records]=await db.batch([
    db.prepare(`SELECT m.supplier_id AS supplierId,p.display_name AS supplierName,
      m.current_due_paisa AS currentDuePaisa
      FROM owner_supplier_master m JOIN parties p ON p.party_id=m.party_id
      WHERE m.supplier_id=?`).bind(supplierId),
    db.prepare(`SELECT COALESCE(SUM(debit_paisa-credit_paisa),0) AS duePaisa
      FROM owner_mvp_supplier_ledger WHERE supplier_id=?`).bind(supplierId),
    db.prepare(`SELECT 'Purchase' AS kind,'PUR-'||printf('%06d',r.sequence) AS reference,
      r.purchase_date AS purchaseDate,r.created_at_ms AS occurredAtMs,
      l.debit_paisa AS debitPaisa,l.credit_paisa AS creditPaisa
      FROM owner_mvp_supplier_ledger l
      JOIN owner_mvp_purchase_receipts r ON r.sequence=l.purchase_sequence
      WHERE l.supplier_id=?
      ORDER BY r.created_at_ms DESC,r.sequence DESC LIMIT 51`).bind(supplierId)
  ]);
  if(!identity.success||!totals.success||!records.success||
    totals.results.length!==1||identity.results.length>1)
    throw Error('Supplier ledger snapshot unavailable');
  if(identity.results.length===0)return null;
  const supplier=identity.results[0],due=safePaisa(supplier.currentDuePaisa);
  if(due!==safePaisa(totals.results[0].duePaisa))
    throw Error('Supplier due reconciliation failed');
  const entries=checkedRows(records.results);
  for(const row of entries){
    safePaisa(row.debitPaisa);
    safePaisa(row.creditPaisa);
    if(!Number.isSafeInteger(row.occurredAtMs))
      throw Error('Supplier ledger row unavailable');
  }
  return {
    scope:'purchase-credit-only',
    supplierId,supplierName:supplier.supplierName,currentDuePaisa:due,
    entries:entries.slice(0,PAGE_SIZE),hasMore:entries.length>PAGE_SIZE
  };
}
