/**
 * M09 internal six-Report pre-activation evidence composer (Issue #431).
 *
 * A reviewed returnLineageReconciled Boolean is not proof that original
 * active return children belong to the parent original Sale/Purchase.
 * Require both reviewed source manifests and the merged source audits.
 *
 * NO public RPC, D1, reporting totals, money, source data mutation or writes.
 * Source evidence completion NEVER authorizes live financial reports.
 */
import {evaluateM09ReportsSourceEligibility} from './m09-reports-source-eligibility.js';
import {auditM09SalesReturnLineage} from './m09-sales-return-report-lineage-audit.js';
import {auditM09PurchaseReturnLineage} from './m09-purchase-return-report-lineage-audit.js';

function trustedInput(value){
  try{
    if(!value || typeof value!=='object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value)!==Object.prototype &&
       Object.getPrototypeOf(value)!==null))
      throw new TypeError();
    const root=Object.create(null);
    for(const key of Reflect.ownKeys(value)){
      if(typeof key!=='string')throw new TypeError();
      const descriptor=Object.getOwnPropertyDescriptor(value,key);
      if(!descriptor || !Object.hasOwn(descriptor,'value'))
        throw new TypeError();
      root[key]=descriptor.value;
    }
    return root;
  }catch{
    throw new TypeError('Invalid trusted M09 report lineage evidence input');
  }
}

function lineageBlocker(root,key,prefix,audit){
  if(!Object.hasOwn(root,key))return prefix+'_MISSING';
  try{
    const result=audit(root[key]);
    return result.ready===false && result.lineageComplete===true &&
      result.status==='SOURCE_LINEAGE_ONLY' && Array.isArray(result.issues) &&
      result.issues.length===0 ? null : prefix+'_NEEDS_REVIEW';
  }catch{
    // Do not echo thrown errors, source identifiers or private fields.
    return prefix+'_INVALID';
  }
}

/**
 * Full original historical rows, including soft-deleted sources, are counted
 * against the already reviewed original sourceRows receipts. Import receipts
 * themselves are still checked by the independent source-eligibility gate.
 */
const SOURCE_ROW_LINKS=Object.freeze({
  salesSnapshot:Object.freeze([
    ['SALES','allSales'],
    ['SALES_RETURN','returnHeaders'],
    ['SALES_RETURN_ITEMS','returnItems']
  ]),
  purchaseSnapshot:Object.freeze([
    ['PURCHASES','allPurchases'],
    ['PURCHASE_RETURN','returnHeaders'],
    ['PURCHASE_RETURN_ITEMS','returnItems']
  ])
});

/** Read only own data properties, never source/receipt getters. */
function ownData(record,key){
  if(!record || typeof record!=='object' || Array.isArray(record) ||
    (Object.getPrototypeOf(record)!==Object.prototype &&
     Object.getPrototypeOf(record)!==null))return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(record,key);
  return descriptor && Object.hasOwn(descriptor,'value')
    ? descriptor.value : undefined;
}

function sourceRowCountBlockers(root,snapshotKey,lineageIssue){
  // An invalid/missing lineage snapshot has not passed the shape/accessor
  // audit; do not inspect its arrays or falsely accept a row-count result.
  if(lineageIssue?.endsWith('_MISSING') || lineageIssue?.endsWith('_INVALID'))
    return [];
  const snapshot=ownData(root,snapshotKey);
  const sources=ownData(ownData(root,'manifest'),'sourceGroups');
  return SOURCE_ROW_LINKS[snapshotKey].flatMap(([group,field])=>{
    const rows=ownData(snapshot,field);
    const receipt=ownData(sources,group);
    const count=ownData(receipt,'sourceRows');
    // Missing/invalid receipts remain independently blocked by the original
    // evidence gate. Do not reinterpret them as zero rows.
    if(!Array.isArray(rows) || !Number.isSafeInteger(count) || count<0)
      return [];
    return rows.length===count ? [] : [group+'_SOURCE_ROWS_MISMATCH'];
  });
}

/**
 * Full source-shaped inputs, not tenant/session/browser inputs:
 *   {manifest, salesSnapshot:{allSales,returnHeaders,returnItems},
 *              purchaseSnapshot:{allPurchases,returnHeaders,returnItems}}
 *
 * Status and report keys follow the existing six-report source evaluator.
 * This is not an authorization, data-import or completeness attestation.
 */
export function evaluateM09ReportsLineageEvidence(input){
  const root=trustedInput(input);
  const evidence=evaluateM09ReportsSourceEligibility(root.manifest);
  const salesIssue=lineageBlocker(root,'salesSnapshot',
    'SALES_RETURN_LINEAGE',auditM09SalesReturnLineage);
  const purchaseIssue=lineageBlocker(root,'purchaseSnapshot',
    'PURCHASE_RETURN_LINEAGE',auditM09PurchaseReturnLineage);
  const salesCountIssues=sourceRowCountBlockers(root,'salesSnapshot',salesIssue);
  const purchaseCountIssues=sourceRowCountBlockers(root,'purchaseSnapshot',purchaseIssue);

  const reports=evidence.reports.map(item=>{
    const lineageBlockers=[];
    if(item.key==='sales' || item.key==='profit'){
      if(salesIssue)lineageBlockers.push(salesIssue);
      lineageBlockers.push(...salesCountIssues);
    }
    if(item.key==='purchase' || item.key==='profit'){
      if(purchaseIssue)lineageBlockers.push(purchaseIssue);
      lineageBlockers.push(...purchaseCountIssues);
    }
    const evidenceComplete=item.evidenceComplete && lineageBlockers.length===0;
    return {
      ...item,
      ready:false,
      evidenceComplete,
      status:evidenceComplete?'AWAITING_AUTHENTICATED_D1_GATE':'BLOCKED',
      lineageBlockers
    };
  });
  return {ready:false,reports};
}
