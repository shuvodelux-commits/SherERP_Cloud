/**
 * M06 internal read-only posted invoice → reprint payload projection.
 *
 * Source parity: frozen Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Invoice.gs::buildInvoicePayload_ and SalePayments.gs::readSalePaymentBreakdown_.
 * Caller MUST authorize first and provide a consistent trusted D1 snapshot.
 * No RPC, D1 access, financial posting, or template changes live here.
 */
import {readSalePaymentBreakdown_} from './sale-payments.js';

function canonicalDate(value) {
  return value ? String(value).slice(0,10) : '';
}

function canonicalTime(value) {
  if (!value) return '';
  const text = String(value).trim();
  const iso = text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) return iso[1];
  const plain = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (plain) return String(plain[1]).padStart(2,'0') + ':' + plain[2] + ':' + (plain[3] || '00');
  return text;
}

function invoiceDueDate(value, days) {
  if (!days || days <= 0 || !value) return '';
  const parts = String(value).split('-');
  if (parts.length !== 3) return '';
  const base = new Date(Date.UTC(Number(parts[0]),Number(parts[1])-1,Number(parts[2])));
  if (Number.isNaN(base.getTime())) return '';
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0,10);
}

function relationType(value) {
  return String(value || '').trim() === 'Husband' ? 'Husband' : 'Father';
}

function deleted(row) {
  return String(row['Is Deleted'] || '').toUpperCase() === 'TRUE' || row.Status === 'Deleted';
}

/**
 * Produce the same payload shape as the original Invoice.gs after auth and reads.
 *
 * All arguments must be trusted server-side snapshots. This is not a permission
 * guard or a public API, and settlement must be computed by the existing ledger
 * owner, not by arbitrary client fields.
 */
export function projectPostedInvoice(invoiceId, {
  saleRows, itemRows, productRows, customerRows, paymentRows,
  settings, settlement = null, shop
} = {}) {
  if (![saleRows,itemRows,productRows,customerRows,paymentRows].every(Array.isArray) ||
      !settings || typeof settings !== 'object' || Array.isArray(settings) ||
      !shop || typeof shop !== 'object' || Array.isArray(shop)) {
    throw new Error('Trusted invoice read context is required.');
  }

  const saleMatches = saleRows.filter(row=>row['Invoice ID'] === invoiceId);
  if (!saleMatches.length) throw new Error('Invoice not found.');
  if (saleMatches.length > 1) {
    throw new Error('Duplicate invoice ID detected: ' + invoiceId + '. Stop posting sales and repair the invoice ID counter/data before reprinting this invoice.');
  }
  const sale = saleMatches[0];
  if (deleted(sale)) throw new Error('Invoice not found or has been deleted.');

  const items = itemRows.filter(row=>row['Invoice ID'] === invoiceId);
  const unitByProductId = Object.create(null);
  productRows.forEach(product=>{ unitByProductId[product['Product ID']] = product['Unit'] || ''; });

  const saleDate = canonicalDate(sale['Date']);
  const paymentTermsDays = Number(settings['Invoice Payment Terms Days']) || 0;
  const dueDate = invoiceDueDate(saleDate,paymentTermsDays);

  const hasRelationSnapshot = !!String(sale['Customer Relation Type'] || '').trim();
  const customerRelationType = relationType(sale['Customer Relation Type']);
  let customerFatherName = hasRelationSnapshot ? (sale['Customer Relation Name'] || '') : '';
  if (!hasRelationSnapshot && sale['Customer ID']) {
    const customer = customerRows.filter(c=>c['Customer ID'] === sale['Customer ID'])[0];
    if (customer) customerFatherName = customer['Father Name'] || '';
  }

  const paymentDetailVersion = String(sale['Payment Detail Version'] || '').trim();
  const payments = readSalePaymentBreakdown_(sale,
    paymentDetailVersion === '1' ? paymentRows.filter(row=>row['Invoice ID']===invoiceId) : []);

  const current = settlement || {
    paidAmount:Number(sale['Paid Amount']) || 0,
    dueAmount:Number(sale['Due Amount']) || 0,
    customerCreditUsed:0,
    paymentType:sale['Payment Type'] || '',
    paymentStatus:sale['Payment Status'] || ''
  };

  return {
    invoiceId: sale['Invoice ID'], date: saleDate, time: canonicalTime(sale['Time']), dueDate: dueDate,
    customerName: sale['Customer Name'], customerPhone: sale['Customer Phone'],
    customerAddress: sale['Customer Address'], customerId: sale['Customer ID'],
    customerFatherName: customerFatherName,
    customerRelationType: customerRelationType,
    items: items.map(function(i){
      return {
        productId: i['Product ID'], name: i['Product Name'], qty: i['Quantity'],
        unit: unitByProductId[i['Product ID']] || '', unitPrice: i['Unit Price'], lineTotal: i['Line Total'],
        supplierId: i['Supplier ID'] || '', supplierName: i['Supplier Name'] || ''
      };
    }),
    subtotal: sale['Subtotal'], discount: sale['Discount'], grandTotal: sale['Grand Total'],
    paidAmount: current.paidAmount, dueAmount: current.dueAmount,
    customerCreditUsed: current.customerCreditUsed || 0,
    paymentType: current.paymentType, paymentStatus: current.paymentStatus,
    originalPaidAmount: Number(sale['Paid Amount']) || 0,
    paymentDetailVersion: paymentDetailVersion,
    payments: payments,
    paymentMethod: sale['Payment Method'] || '', bankAccountId: sale['Bank Account ID'] || '',
    bankAccountName: sale['Bank Account Name'] || '',
    shop: structuredClone(shop)
  };
}
