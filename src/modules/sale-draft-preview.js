/**
 * M06 read-only POS draft → invoice-shape projection.
 *
 * Adapted from frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * DraftSales.gs parseSalesDraftRow_ and buildSalesDraftPreviewPayload_.
 *
 * IMPORTANT: This module does not authorize reads, fetch D1 rows, allocate invoice
 * IDs, post sales/payments or register an RPC. Callers must supply a trusted,
 * already-authorized draft row, active Bank account snapshot and invoice shop data.
 */
import {normalizeSalePayments_} from './sale-payments.js';

function relationType(value) {
  return String(value || '').trim() === 'Husband' ? 'Husband' : 'Father';
}

// D1 read boundary supplies canonical business-date text (not a GAS Date).
function draftDate(value) {
  return value ? String(value).slice(0,10) : '';
}

/** Pure parser of source-shaped SALES_DRAFTS rows. */
export function parseSaleDraftRow(row) {
  let items = [], payment = {};
  try { items = JSON.parse(row['Items JSON'] || '[]'); } catch (e) { items = []; }
  try { payment = JSON.parse(row['Payment JSON'] || '{}'); } catch (e) { payment = {}; }
  return {
    draftId: row['Draft ID'], draftNo: row['Draft No'], draftDate: draftDate(row['Draft Date']),
    customerId: row['Customer ID'] || '', customerName: row['Customer Name'] || '', customerPhone: row['Customer Phone'] || '',
    customerFatherName: row['Customer Father Name'] || '', customerRelationType: relationType(row['Customer Relation Type']), customerAddress: row['Customer Address'] || '',
    items: items, payment: payment, notes: row['Notes'] || '', subtotal: Number(row['Subtotal']) || 0,
    discount: Number(row['Discount']) || 0, grandTotal: Number(row['Grand Total']) || 0,
    createdById: row['Created By ID'] || '', createdByName: row['Created By Name'] || '', createdAt: row['Created At'] || '',
    updatedById: row['Updated By ID'] || '', updatedByName: row['Updated By Name'] || '', updatedAt: row['Updated At'] || '',
    version: Number(row['Version']) || 1
  };
}

/** Internal projection only: does NOT validate authorization or write money. */
export function projectSaleDraftInvoice(row, {paymentAccounts, shop} = {}) {
  if (!Array.isArray(paymentAccounts)) throw new Error('Trusted payment accounts are required.');
  if (!shop || typeof shop !== 'object' || Array.isArray(shop)) throw new Error('Trusted invoice shop payload is required.');
  const parsed = parseSaleDraftRow(row);
  const grand = Number(row['Grand Total']) || 0;
  const isSplitDraft = !!(parsed.payment && Object.prototype.hasOwnProperty.call(parsed.payment, 'payments'));
  const breakdown = isSplitDraft
    ? normalizeSalePayments_(grand, parsed.payment.payments, paymentAccounts)
    : null;
  const receivedRaw = Number(parsed.payment && parsed.payment.amountReceived);
  const provisionalPaid = breakdown
    ? breakdown.paidAmount
    : Math.min(Math.max(isFinite(receivedRaw) ? receivedRaw : 0, 0), grand);
  const paymentRows = breakdown ? breakdown.payments.map(function (p) {
    return {rowId:p.rowId, method:p.method, bankAccountId:p.bankAccountId,
      bankAccountName:p.bankAccountName, tendered:p.tendered,
      applied:p.applied, change:p.change, legacy:false};
  }) : [];
  return {
    isDraft: true,
    draftNo: row['Draft No'],
    invoiceId: row['Draft No'],
    date: draftDate(row['Draft Date']),
    time: '', dueDate: '',
    customerId: row['Customer ID'] || '', customerName: row['Customer Name'] || '', customerPhone: row['Customer Phone'] || '',
    customerFatherName: row['Customer Father Name'] || '', customerRelationType: relationType(row['Customer Relation Type']), customerAddress: row['Customer Address'] || '',
    items: parsed.items || [], subtotal: Number(row['Subtotal']) || 0, discount: Number(row['Discount']) || 0, grandTotal: grand,
    paidAmount: provisionalPaid, originalPaidAmount: provisionalPaid,
    dueAmount: Math.max(0, grand - provisionalPaid), paymentType: 'Draft', paymentStatus: 'Draft',
    paymentDetailVersion: isSplitDraft ? '1' : '',
    payments: paymentRows,
    paymentMethod: breakdown ? breakdown.paymentMethod : (parsed.payment && parsed.payment.paymentMethod || ''),
    bankAccountName: breakdown ? breakdown.bankAccountName : '',
    shop: structuredClone(shop)
  };
}
