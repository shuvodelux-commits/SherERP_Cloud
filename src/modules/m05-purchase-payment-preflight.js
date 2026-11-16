/**
 * M05 INTERNAL read-only purchase payment preflight.
 *
 * Business sources: frozen Mohim_ERP Purchase.gs::createPurchase and
 * Utils.gs::isBankLikePaymentMethod_/resolveBankAccount_.
 *
 * No Cash Session/permission authorization, Bank/Cash/Supplier posting,
 * DB access or public RPC is performed here. Actual M03 purchase posting
 * must re-evaluate account and session policy atomically with the ledger.
 */
import {preparePurchasePreflight} from './purchase-preflight.js';

function plain(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const prototype=Object.getPrototypeOf(row);
  return (prototype===Object.prototype || prototype===null) &&
    Object.values(Object.getOwnPropertyDescriptors(row))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}

/**
 * Given already-trusted source-shaped rows, preserve createPurchase's
 * amount clamping and its payment-method/account resolution contract.
 */
export function preparePurchasePaymentPreflight(
  payload,
  {products,suppliers,bankAccounts}={}
) {
  if (!Array.isArray(products)) throw new TypeError('Explicit product snapshot required.');
  if (!Array.isArray(suppliers)) throw new TypeError('Explicit supplier snapshot required.');
  if (!Array.isArray(bankAccounts)) throw new TypeError('Explicit bank account snapshot required.');
  if (bankAccounts.some(row=>!plain(row)))
    throw new TypeError('Invalid trusted bank account row or accessor.');

  const purchase=preparePurchasePreflight(payload,{products,suppliers});
  const paymentMethod=purchase.paidAmount>0 ? (payload.paymentMethod || 'Cash') : '';
  let bankAccountId='',bankAccountName='';

  // This is the exact two-value source method list; account type and
  // Inactive status are intentionally NOT filters in resolveBankAccount_.
  if (paymentMethod==='Bank' || paymentMethod==='Mobile Banking') {
    const requestedId=payload.bankAccountId===null ||
      payload.bankAccountId===undefined ? '' : String(payload.bankAccountId).trim();
    if (!requestedId) throw new Error('Choose a bank account.');

    const matching=bankAccounts.filter(row=>row['Bank Account ID']===requestedId);
    if (!matching.length) throw new Error('Bank account not found.');
    // The original GAS resolver picks the first record. For migration
    // review a duplicate ID is ambiguous and must not be guessed.
    if (matching.length>1) throw new Error('Duplicate bank account ID in trusted snapshot.');
    bankAccountId=matching[0]['Bank Account ID'];
    bankAccountName=matching[0]['Account Name'];
  }

  return {...purchase,paymentMethod,bankAccountId,bankAccountName};
}
