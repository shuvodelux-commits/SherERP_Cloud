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

  const reports=evidence.reports.map(item=>{
    const lineageBlockers=[];
    if((item.key==='sales' || item.key==='profit') && salesIssue)
      lineageBlockers.push(salesIssue);
    if((item.key==='purchase' || item.key==='profit') && purchaseIssue)
      lineageBlockers.push(purchaseIssue);
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
