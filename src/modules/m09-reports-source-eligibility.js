/**
 * M09 internal, pure Reports source evidence diagnostic (Issue #431).
 *
 * No public RPC, D1 access, token validation, finance balances or posting.
 * This is PRE-ACTIVATION evidence only: ready is always false even with
 * synthetic all-true receipts. The future M04/tenant-bound Workerd D1 reader
 * must independently authenticate, reconcile and grant each real report.
 *
 * Source groups: frozen Reports.gs + Config.gs @
 * Mohim_ERP 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 */
const REPORT_SOURCES=Object.freeze([
  ['sales',['SALES','SALES_RETURN','SALES_RETURN_ITEMS','CUSTOMER_LEDGER']],
  ['purchase',['PURCHASES','PURCHASE_RETURN','PURCHASE_RETURN_ITEMS','SUPPLIER_LEDGER']],
  ['stock',['PRODUCTS','STOCK_LOTS']],
  ['cashbank',['CASH_BOOK','BANK_BOOK','BANK_ACCOUNTS']],
  ['profit',['SALES','SALE_ITEMS','SALES_RETURN','SALES_RETURN_ITEMS',
    'SALE_ITEM_LOTS','VENDOR_SOURCING','EXPENSES','SALE_BUNDLE_COMPONENTS',
    'CUSTOMER_LEDGER','SUPPLIER_LEDGER']],
  ['balancesheet',['CASH_BOOK','BANK_ACCOUNTS','STOCK_LOTS']]
]);

const COMMON_REVIEWS=Object.freeze([
  'authBoundaryReviewed','tenantBoundaryReviewed',
  'sourceSnapshotReviewed','sourceIdentityReviewed'
]);
const REPORT_REVIEWS=Object.freeze({
  sales:['returnLineageReconciled','customerSettlementReconciled',
    'grossPartyAccountsReconciled'],
  purchase:['returnLineageReconciled','supplierSettlementReconciled',
    'grossPartyAccountsReconciled'],
  stock:['stockLotsReconciled'],
  cashbank:['cashBankReconciled'],
  profit:['returnLineageReconciled','customerSettlementReconciled',
    'supplierSettlementReconciled','costLayersReconciled',
    'settlementDiscountReconciled','grossPartyAccountsReconciled'],
  balancesheet:['cashBankReconciled','stockLotsReconciled',
    'financeSummaryReconciled','grossPartyAccountsReconciled']
});

/** Copy own data fields without executing getters or prototype properties. */
function trustedRecord(value,label){
  try{
    if(value===null || typeof value!=='object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value)!==Object.prototype &&
       Object.getPrototypeOf(value)!==null))
      throw new TypeError();
    const result=Object.create(null);
    for(const key of Reflect.ownKeys(value)){
      if(typeof key!=='string')throw new TypeError();
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor || !Object.hasOwn(descriptor,'value'))
        throw new TypeError();
      result[key]=descriptor.value;
    }
    return result;
  }catch{
    throw new TypeError('Invalid trusted M09 '+label+' evidence');
  }
}

function inspectGroups(required,sources){
  const missingGroups=[],unreviewedGroups=[],countMismatchGroups=[];
  for(const key of required){
    if(!Object.hasOwn(sources,key)){
      missingGroups.push(key);
      continue;
    }
    let entry;
    try{
      entry=trustedRecord(sources[key],'source group');
    }catch{
      unreviewedGroups.push(key);
      continue;
    }
    if(entry.provenanceReviewed!==true ||
      entry.deletionStateReviewed!==true)
      unreviewedGroups.push(key);
    if(!Number.isSafeInteger(entry.sourceRows) || entry.sourceRows<0 ||
      !Number.isSafeInteger(entry.importedRows) || entry.importedRows<0)
      unreviewedGroups.push(key);
    else if(entry.sourceRows!==entry.importedRows)
      countMismatchGroups.push(key);
  }
  return {
    missingGroups,
    unreviewedGroups:[...new Set(unreviewedGroups)],
    countMismatchGroups
  };
}

/**
 * Expects only trusted internal, separately reviewed summary receipts.
 * Never accepts source rows/SQL/permissions and never approves report access.
 * A source with reviewed zero original rows is distinct from an absent source.
 */
export function evaluateM09ReportsSourceEligibility(manifest){
  const data=trustedRecord(manifest,'manifest');
  const sources=trustedRecord(data.sourceGroups,'sourceGroups');
  const reviews=trustedRecord(data.reviews,'reviews');

  const reports=REPORT_SOURCES.map(([key,required])=>{
    const groups=inspectGroups(required,sources);
    const missingReviews=[...COMMON_REVIEWS,...REPORT_REVIEWS[key]]
      .filter(review=>reviews[review]!==true);
    const evidenceComplete=groups.missingGroups.length===0 &&
      groups.unreviewedGroups.length===0 &&
      groups.countMismatchGroups.length===0 &&
      missingReviews.length===0;
    return {
      key,
      ready:false,
      evidenceComplete,
      status:evidenceComplete
        ? 'AWAITING_AUTHENTICATED_D1_GATE':'BLOCKED',
      ...groups,
      missingReviews
    };
  });
  return {ready:false,reports};
}
