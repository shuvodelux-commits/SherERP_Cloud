/**
 * M06 internal read-only POS invoice search history projection.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * Invoice.gs::findSalesByPhone and Utils.gs phone/duplicate helpers.
 *
 * There is NO RPC, authentication, D1 query or financial write here.
 * The caller MUST validate pos.view permission and tenant isolation, then
 * supply already-filtered active SALES and a trusted current settlement map.
 */
function phoneDisplay(value) {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (/^1[3-9]\d{8}$/.test(text)) return '0' + text;
  return text;
}

function phoneSearchDigits(value) {
  const bnDigits = '০১২৩৪৫৬৭৮৯';
  const asciiText = String(phoneDisplay(value) || '').replace(/[০-৯]/g, d =>
    String(bnDigits.indexOf(d)));
  let digits = asciiText.replace(/\D/g, '');
  if (/^8801[3-9]\d{8}$/.test(digits)) digits = '0' + digits.slice(3);
  else if (/^1[3-9]\d{8}$/.test(digits)) digits = '0' + digits;
  return digits;
}

function samePhone(a, b) {
  const left = phoneSearchDigits(a), right = phoneSearchDigits(b);
  return !!left && !!right && left === right;
}

function sourceDate(value) {
  return value ? String(value).slice(0,10) : '';
}

function sourceTime(value) {
  if (!value) return '';
  const text = String(value).trim();
  const iso = text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (iso) return iso[1];
  const plain = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (plain) return String(plain[1]).padStart(2,'0') + ':' + plain[2] + ':' + (plain[3] || '00');
  return text;
}

/**
 * Returns source-shaped POS phone-history rows. The arrays are never mutated.
 * currentSettlementByInvoice comes from the separately owned Customer ledger.
 */
export function projectPosPhoneInvoiceHistory(phone, customerId, {
  activeSales, currentSettlementByInvoice
} = {}) {
  if (!Array.isArray(activeSales) || !currentSettlementByInvoice ||
      typeof currentSettlementByInvoice !== 'object' ||
      Array.isArray(currentSettlementByInvoice)) {
    throw new TypeError('Trusted active sales and settlement snapshots are required.');
  }
  const searchPhone = phoneDisplay(phone);
  if (!searchPhone) throw new Error('Enter a phone number.');
  const requestedCustomerId = customerId === null || customerId === undefined ? '' : String(customerId).trim();

  // Duplicates are counted in all ACTIVE Sales, not merely matched search rows.
  const counts = Object.create(null);
  activeSales.forEach(sale => {
    const id = String(sale['Invoice ID'] || '').trim();
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
  });

  return activeSales
    .filter(sale => {
      const sameCustomer = !!requestedCustomerId &&
        String(sale['Customer ID'] || '') === requestedCustomerId;
      return sameCustomer || samePhone(sale['Customer Phone'], searchPhone);
    })
    .sort((a, b) => new Date(b['Created At']) - new Date(a['Created At']))
    .map(sale => {
      const invoiceId = String(sale['Invoice ID'] || '');
      const duplicateInvoiceId = !!(counts[invoiceId] > 1);
      const id = String(sale['Customer ID'] || '');
      let paymentStatus = sale['Payment Status'];
      if (!duplicateInvoiceId && id && (Number(sale['Due Amount']) || 0) > 0.004) {
        const settlement = Object.prototype.hasOwnProperty.call(currentSettlementByInvoice, invoiceId)
          ? currentSettlementByInvoice[invoiceId] : null;
        if (settlement) paymentStatus = settlement.paymentStatus;
      }
      return {
        invoiceId, date:sourceDate(sale['Date']), time:sourceTime(sale['Time']),
        customerName:sale['Customer Name'], grandTotal:sale['Grand Total'],
        paymentStatus, duplicateInvoiceId
      };
    });
}
