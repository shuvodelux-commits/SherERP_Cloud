/**
 * M09 internal HisabIQ dashboard evidence matrix (issue #567, Reports gate #431).
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * Dashboard.gs and Reports.gs. No financial values, source rows, D1 or RPC.
 *
 * A complete synthetic/source-reviewed receipt is NOT authentication or
 * authorization. Every result remains ready:false until M03/M04 integrate
 * an independently authenticated, source-reconciled read under M09 ownership.
 */

const COMMON_REVIEWS=Object.freeze([
  'authBoundaryReviewed','tenantBoundaryReviewed','sourceSnapshotReviewed',
  'sourceIdentityReviewed','shopLocalDatesReviewed'
]);
const DETAIL_REVIEWS=Object.freeze([
  'detailSourceIdsReviewed','detailFiltersReviewed'
]);

// Exact M01 data-hdb-widget IDs, followed by source groups and review gates.
// Extra detail groups model real invoice, item and Party-record drilldowns;
// a summary receipt cannot by itself establish record/point-lineage parity.
const SPECS=Object.freeze([
  {
    key:'today-sales',
    groups:['SALES','SALES_RETURN','SALES_RETURN_ITEMS','SETTINGS'],
    reviews:['invoiceIdsUnique','returnLineageReconciled','returnPricingReconciled'],
    detailGroups:['SALE_ITEMS']
  },
  {
    key:'receivable',
    groups:['CUSTOMERS','CUSTOMER_LEDGER','SETTINGS'],
    reviews:['customerSettlementReconciled','grossPartyAccountsReconciled',
      'partySourceLinksReviewed']
  },
  {
    key:'payable',
    groups:['SUPPLIERS','SUPPLIER_LEDGER','SETTINGS'],
    reviews:['supplierSettlementReconciled','grossPartyAccountsReconciled',
      'partySourceLinksReviewed']
  },
  {
    key:'cash',
    groups:['CASH_BOOK','SETTINGS'],
    reviews:['cashBankReconciled']
  },
  {
    key:'gross-profit',
    groups:['SALES','SALE_ITEMS','SALES_RETURN','SALES_RETURN_ITEMS',
      'SALE_ITEM_LOTS','SALE_BUNDLE_COMPONENTS','VENDOR_SOURCING','EXPENSES',
      'CUSTOMER_LEDGER','SUPPLIER_LEDGER','SETTINGS'],
    reviews:['invoiceIdsUnique','returnLineageReconciled',
      'returnPricingReconciled','costLayersReconciled',
      'settlementDiscountReconciled','grossPartyAccountsReconciled']
  },
  {
    key:'low-stock',
    groups:['PRODUCTS','STOCK_LOTS'],
    reviews:['stockLotsReconciled']
  },
  {
    key:'today-collection',
    groups:['SALES','CUSTOMER_LEDGER','SETTINGS'],
    reviews:['customerSettlementReconciled','invoiceIdsUnique']
  },
  {
    key:'today-expense',
    groups:['EXPENSES','SETTINGS'],
    reviews:[]
  },
  {
    key:'today-purchase',
    groups:['PURCHASES','SETTINGS'],
    reviews:['purchaseRecordLineageReviewed'],
    detailGroups:['PURCHASE_ITEMS']
  },
  {
    key:'borrower-receivable',
    groups:['FINANCE_TRANSACTIONS','FINANCE_PERSONS','SETTINGS'],
    reviews:['financeSummaryReconciled','grossPartyAccountsReconciled',
      'partySourceLinksReviewed']
  },
  {
    key:'outstanding-loan',
    groups:['FINANCE_TRANSACTIONS','FINANCE_PERSONS','SETTINGS'],
    reviews:['financeSummaryReconciled','grossPartyAccountsReconciled',
      'partySourceLinksReviewed']
  },
  {
    key:'sales-trend',
    groups:['SALES','SALES_RETURN','SALES_RETURN_ITEMS','SETTINGS'],
    reviews:['invoiceIdsUnique','returnLineageReconciled',
      'returnPricingReconciled'],
    detailGroups:['SALE_ITEMS']
  },
  {
    key:'cashflow',
    groups:['CASH_BOOK','BANK_BOOK','BANK_ACCOUNTS','SETTINGS'],
    reviews:['cashBankReconciled']
  },
  {
    key:'recent-sales',
    groups:['SALES','SETTINGS'],
    reviews:['invoiceIdsUnique'],
    detailGroups:['SALE_ITEMS','SALES_RETURN','SALES_RETURN_ITEMS',
      'CUSTOMER_LEDGER'],
    detailReviews:['returnLineageReconciled','customerSettlementReconciled']
  },
  {
    key:'dues',
    groups:['CUSTOMERS','CUSTOMER_LEDGER','SETTINGS'],
    reviews:['customerSettlementReconciled','grossPartyAccountsReconciled',
      'partySourceLinksReviewed']
  }
]);

function plain(value,label){
  try{
    if(value===null || typeof value!=='object' || Array.isArray(value) ||
       (Object.getPrototypeOf(value)!==Object.prototype &&
        Object.getPrototypeOf(value)!==null))
      throw new TypeError();
    return value;
  }catch{
    throw new TypeError('Invalid trusted M09 dashboard '+label);
  }
}

// Read descriptor, never execute getters or inherited properties.
function ownValue(value,key){
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  return descriptor && Object.hasOwn(descriptor,'value')
    ? {present:true,value:descriptor.value}
    : {present:false,value:undefined};
}

function rootInput(input){
  const root=plain(input,'manifest');
  const source=ownValue(root,'sourceGroups');
  const reviews=ownValue(root,'reviews');
  if(!source.present || !reviews.present)
    throw new TypeError('Invalid trusted M09 dashboard manifest fields');
  return {
    sources:plain(source.value,'sourceGroups'),
    reviews:plain(reviews.value,'reviews')
  };
}

function receiptValid(raw){
  let receipt;
  try{receipt=plain(raw,'source receipt');}
  catch{return false;}
  const fields=['sourceRows','importedRows','provenanceReviewed',
    'deletionStateReviewed','sourceIdsReviewed'];
  const values=fields.map(key=>ownValue(receipt,key));
  if(values.some(item=>!item.present))return false;
  const [source,imported,provenance,deletion,identity]=values
    .map(item=>item.value);
  if(!Number.isSafeInteger(source) || source<0 ||
     !Number.isSafeInteger(imported) || imported<0 ||
     provenance!==true || deletion!==true || identity!==true)
    return false;
  return true;
}

function countDrift(raw){
  const a=ownValue(raw,'sourceRows');
  const b=ownValue(raw,'importedRows');
  if(!a.present || !b.present || !Number.isSafeInteger(a.value) ||
     !Number.isSafeInteger(b.value) || a.value<0 || b.value<0)
    return false;
  return a.value!==b.value;
}

function inspect(requiredGroups,requiredReviews,sources,reviews){
  const missingGroups=[],unreviewedGroups=[],countMismatchGroups=[];
  for(const group of [...new Set(requiredGroups)]){
    const entry=ownValue(sources,group);
    if(!entry.present){
      // Distinguish absent group from a defined, accessor-backed group.
      if(Object.hasOwn(sources,group))unreviewedGroups.push(group);
      else missingGroups.push(group);
      continue;
    }
    if(!receiptValid(entry.value)){
      unreviewedGroups.push(group);
      continue;
    }
    if(countDrift(entry.value))countMismatchGroups.push(group);
  }
  const missingReviews=[...new Set(requiredReviews)].filter(key=>{
    const record=ownValue(reviews,key);
    return !record.present || record.value!==true;
  });
  const evidenceComplete=missingGroups.length===0 &&
    unreviewedGroups.length===0 && countMismatchGroups.length===0 &&
    missingReviews.length===0;
  return Object.freeze({
    ready:false,
    evidenceComplete,
    status:evidenceComplete?'AWAITING_AUTHENTICATED_D1_GATE':'BLOCKED',
    missingGroups,
    unreviewedGroups,
    countMismatchGroups,
    missingReviews
  });
}

/**
 * Input is an internal summary of separately audited *source* evidence, not
 * imported rows, user tokens or permission claims:
 * {sourceGroups:{SALES:{sourceRows,importedRows,provenanceReviewed,
 *   deletionStateReviewed,sourceIdsReviewed},...},reviews:{...}}
 *
 * Zero original rows may be a valid reviewed import receipt, but an omitted
 * source is never assumed empty. No part of this result authorizes reads.
 */
export function evaluateM09DashboardReadModelEvidence(manifest){
  const {sources,reviews}=rootInput(manifest);
  const widgets=SPECS.map(spec=>{
    const summary=inspect(spec.groups,
      [...COMMON_REVIEWS,...spec.reviews],sources,reviews);
    const detail=inspect([...spec.groups,...(spec.detailGroups||[])],
      [...COMMON_REVIEWS,...spec.reviews,...DETAIL_REVIEWS,
       ...(spec.detailReviews||[])],sources,reviews);
    return Object.freeze({key:spec.key,summary,detail});
  });
  return Object.freeze({ready:false,widgets});
}
