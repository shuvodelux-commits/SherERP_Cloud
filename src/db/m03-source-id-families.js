/**
 * M03 Run 3 — exact source-pinned original sequential-ID family vocabulary.
 *
 * Private D1 proof only. M02 verifies the same 38 Config.ID_PREFIX entries
 * against immutable Mohim_ERP Config.gs at the pinned source SHA.
 * This mapping does NOT certify original DocumentProperties counter values,
 * imported historical IDs, a live source archive or M04 actor authority.
 */
export const SOURCE_ID_PREFIXES=Object.freeze({
  PRODUCTS:'PRD',
  SUPPLIERS:'SUP',
  PURCHASES:'PUR',
  STOCK_LOTS:'LOT',
  STOCK_LOT_COST_CORRECTIONS:'SLC',
  SALES:'INV',
  SALE_PAYMENTS:'SPAY',
  SALES_DRAFTS:'DRF',
  SALES_DRAFT_AUDIT:'DRA',
  CUSTOMERS:'CUS',
  EXPENSES:'EXP',
  EXPENSE_CATEGORIES:'ECAT',
  EXPENSE_PAYEES:'EPAY',
  CUSTOMER_LEDGER:'LED',
  SUPPLIER_LEDGER:'SLD',
  CASH_BOOK:'CB',
  STOCK_MOVEMENT:'SM',
  SALES_RETURN:'SRT',
  PURCHASE_RETURN:'PRT',
  CASH_SESSIONS:'CS',
  INVOICE_EDIT_LOG:'IEL',
  USERS:'USR',
  ROLES:'ROL',
  DELETE_LOG:'DEL',
  OPENING_BALANCE_EDIT_LOG:'OBL',
  BANK_ACCOUNTS:'BNK',
  BANK_BOOK:'BB',
  BANK_TRANSFERS:'TRF',
  FINANCE_TRANSACTIONS:'FIN',
  FINANCE_PERSONS:'FPER',
  PRODUCT_CATEGORIES:'PCAT',
  PRODUCT_UNITS:'PUNT',
  VENDORS:'VEN',
  VENDOR_SOURCING:'VSR',
  VENDOR_LEDGER:'VLD',
  VENDOR_RETURNS:'VRT',
  VENDOR_ISSUES:'VIS',
  VENDOR_RETURNS_RECEIVED:'VRR'
});

/** Never allow JS prototype keys, random session tokens or journal IDs. */
export function originalSourceIdPrefix(idKey){
  return typeof idKey==='string'&&Object.hasOwn(SOURCE_ID_PREFIXES,idKey)
    ? SOURCE_ID_PREFIXES[idKey] : null;
}
