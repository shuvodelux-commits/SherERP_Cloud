/**
 * M08/M03: read-only projections over the EXISTING, narrow first-Shop MVP.
 *
 * This is not the full Cash/Bank/Party ledger: the current pilot has only
 * unpaid supplier Purchases, cash POS Sales, cash Returns and (after 0010)
 * Supplier cash payments. Never invent an opening Cash Book entry, bank
 * transfer, expense, customer due or historical opening amount.
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
  const hasSupplierCash=await db.prepare(`SELECT 1 AS present FROM sqlite_schema
    WHERE type='table' AND name='owner_mvp_supplier_payment_cash_book'`).first();
  const supplierTotal=hasSupplierCash?
    '(SELECT COALESCE(SUM(paid_paisa),0) FROM owner_mvp_supplier_payment_cash_book)':'0';
  const supplierRows=hasSupplierCash?`
    UNION ALL
    SELECT 'Supplier Payment' AS kind,
      'SPY-'||printf('%06d',r.sequence) AS reference,
      r.created_at_ms AS occurredAtMs,b.cash_sequence AS sessionId,
      0 AS receivedPaisa,b.paid_paisa AS paidPaisa,r.sequence AS recordSequence
    FROM owner_mvp_supplier_payment_cash_book b
    JOIN owner_mvp_supplier_cash_payment_receipts r
      ON r.sequence=b.payment_sequence`:'';
  const [totals,entries]=await db.batch([
    db.prepare(`SELECT
      (SELECT COALESCE(SUM(received_paisa),0) FROM owner_mvp_sale_cash_book) AS receivedPaisa,
      ((SELECT COALESCE(SUM(debit_paisa),0) FROM owner_mvp_return_cash_book)
        +${supplierTotal}) AS paidPaisa`),
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
      ${supplierRows}
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
    scope:hasSupplierCash?'cash-sale-return-and-supplier-pay-only':'cash-sale-and-cash-return-only',
    receivedPaisa,paidPaisa,netPaisa,
    entries:records.slice(0,PAGE_SIZE),
    hasMore:records.length>PAGE_SIZE
  };
}

export async function readOwnerPilotSupplierPurchaseLedger(db,supplierId){
  if(typeof supplierId!=='string'||!/^SUP-\d{6}$/.test(supplierId))
    return null;
  // 0010 stores Supplier payments separately from the immutable Purchase debit
  // ledger; combine both before verifying the materialized Supplier due.
  const hasSupplierPay=await db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='owner_mvp_supplier_payment_ledger'").first();
  const hasHistorical=await db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type='table' AND name='owner_supplier_opening_checkpoints'").first();
  const openingJoin=hasHistorical?
    'LEFT JOIN owner_supplier_opening_checkpoints o ON o.supplier_id=m.supplier_id':'';
  const openingColumn=hasHistorical?
    ',COALESCE(o.signed_opening_paisa,0) AS signedOpeningPaisa':
    ',0 AS signedOpeningPaisa';
  const openingTotal=hasHistorical?` +
    (SELECT COALESCE(SUM(CASE WHEN signed_opening_paisa>0
       THEN signed_opening_paisa ELSE 0 END),0)
       FROM owner_supplier_opening_checkpoints WHERE supplier_id=?)`:'';
  const openingRows=hasHistorical?`
      UNION ALL
      SELECT 'Historical Opening' AS kind,o.operation_id AS reference,
        o.as_of_date AS purchaseDate,o.created_at_ms AS occurredAtMs,
        CASE WHEN o.signed_opening_paisa>0 THEN o.signed_opening_paisa ELSE 0 END AS debitPaisa,
        0 AS creditPaisa,0 AS recordSequence
      FROM owner_supplier_opening_checkpoints o WHERE o.supplier_id=?`:'';
  const additionalCredit=hasSupplierPay?` -
    (SELECT COALESCE(SUM(credit_paisa),0) FROM owner_mvp_supplier_payment_ledger WHERE supplier_id=?)`:'';
  const paymentRows=hasSupplierPay?`
      UNION ALL
      SELECT 'Supplier Payment' AS kind,'SPY-'||printf('%06d',r.sequence) AS reference,
        r.paid_date AS purchaseDate,r.created_at_ms AS occurredAtMs,
        l.debit_paisa AS debitPaisa,l.credit_paisa AS creditPaisa,
        r.sequence AS recordSequence
      FROM owner_mvp_supplier_payment_ledger l
      JOIN owner_mvp_supplier_cash_payment_receipts r ON r.sequence=l.payment_sequence
      WHERE l.supplier_id=?`:'';
  const [identity,totals,records]=await db.batch([
    db.prepare(`SELECT m.supplier_id AS supplierId,p.display_name AS supplierName,p.phone,
      m.current_due_paisa AS currentDuePaisa ${openingColumn}
      FROM owner_supplier_master m JOIN parties p ON p.party_id=m.party_id
      ${openingJoin}
      WHERE m.supplier_id=?`).bind(supplierId),
    db.prepare(`SELECT (SELECT COALESCE(SUM(debit_paisa-credit_paisa),0)
      FROM owner_mvp_supplier_ledger WHERE supplier_id=?)${additionalCredit}${openingTotal} AS duePaisa`)
      .bind(supplierId,...(hasSupplierPay?[supplierId]:[]),
        ...(hasHistorical?[supplierId]:[])),
    db.prepare(`SELECT kind,reference,purchaseDate,occurredAtMs,debitPaisa,creditPaisa FROM (
      SELECT 'Purchase' AS kind,'PUR-'||printf('%06d',r.sequence) AS reference,
        r.purchase_date AS purchaseDate,r.created_at_ms AS occurredAtMs,
        l.debit_paisa AS debitPaisa,l.credit_paisa AS creditPaisa,
        r.sequence AS recordSequence
      FROM owner_mvp_supplier_ledger l
      JOIN owner_mvp_purchase_receipts r ON r.sequence=l.purchase_sequence
      WHERE l.supplier_id=?
      ${paymentRows}
      ${openingRows}
    ) ORDER BY purchaseDate DESC,occurredAtMs DESC,recordSequence DESC,kind DESC LIMIT 51`)
      .bind(supplierId,...(hasSupplierPay?[supplierId]:[]),
        ...(hasHistorical?[supplierId]:[]))
  ]);
  if(!identity.success||!totals.success||!records.success||
    totals.results.length!==1||identity.results.length>1)
    throw Error('Supplier ledger snapshot unavailable');
  if(identity.results.length===0)return null;
  const supplier=identity.results[0],due=safePaisa(supplier.currentDuePaisa);
  const signedOpening=safePaisa(supplier.signedOpeningPaisa);
  if(due!==safePaisa(totals.results[0].duePaisa))
    throw Error('Supplier due reconciliation failed');
  const entries=checkedRows(records.results);
  // Walk backward from the reconciled full balance, including off-page history.
  let balancePaisa=due;
  for(const row of entries){
    row.balancePaisa=balancePaisa;
    balancePaisa=safePaisa(balancePaisa-safePaisa(row.debitPaisa)+safePaisa(row.creditPaisa));
    if(!Number.isSafeInteger(row.occurredAtMs))
      throw Error('Supplier ledger row unavailable');
  }
  return {
    scope:hasSupplierPay?'purchase-and-cash-payment':'purchase-credit-only',
    supplierId,supplierName:supplier.supplierName,phone:supplier.phone,currentDuePaisa:due,
    openingBalancePaisa:signedOpening,openingPayablePaisa:Math.max(0,signedOpening),
    supplierAdvancePaisa:Math.max(0,-signedOpening),
    entries:entries.slice(0,PAGE_SIZE),hasMore:entries.length>PAGE_SIZE
  };
}
