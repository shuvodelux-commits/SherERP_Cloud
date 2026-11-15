/**
 * M02-P internal OFFLINE-ONLY reviewed Party import readback evidence.
 * Frozen Mohim_ERP source: 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * No D1 reads/writes, RPC, authenticated approvals, financial settlement,
 * production import or cutover authorization. Inputs are trusted snapshots.
 */
import {validatePartyImportCandidate} from './import-validation-bundle.js';
import {planPartyImport} from './party-import-plan.js';
import {reconcilePartyImportReadback} from './import-readback-reconciliation.js';

const stages=Object.freeze({source:'SOURCE',readback:'READBACK'});
const order=(a,b)=>a.stage.localeCompare(b.stage)||
  a.scope.localeCompare(b.scope)||a.code.localeCompare(b.code);
function redact(stage,items,scopeField){
  // Keep only fixed table/group vocabulary, code, and aggregate count.
  const counts=new Map();
  for(const item of items){
    const scope=item[scopeField];
    const key=JSON.stringify([stage,scope,item.code]);
    counts.set(key,(counts.get(key)||0)+(item.count||1));
  }
  return [...counts].map(([key,count])=>{
    const [entryStage,scope,code]=JSON.parse(key);
    return {stage:entryStage,scope,code,count};
  });
}

/** Synthetic/offline identity evidence ONLY; never a production-ready flag. */
export function reconcileReviewedPartyImport({
  reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,
  approvedGroups,readback
}={}){
  try{
    const validation=validatePartyImportCandidate({
      reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,
      approvedGroups
    });
    const issues=redact(stages.source,validation.issues,'sourceGroup');
    const counts={source:validation.counts,readback:null};
    if(validation.offlineValidationClear!==true){
      issues.sort(order);
      return {
        formatVersion:1,sourceValidationClear:false,
        readbackChecked:false,readbackMatches:null,
        approvalEvidencePersistent:null,offlineEvidenceMatches:false,
        counts,issues
      };
    }
    // Never manufacture the reviewed plan before source completeness,
    // identity history and review evidence are all validated.
    const plan=planPartyImport(candidateRows,approvedGroups);
    const stored=reconcilePartyImportReadback({plan,readback});
    counts.readback=stored.counts;
    issues.push(...redact(stages.readback,stored.issues,'table'));
    issues.sort(order);
    return {
      formatVersion:1,sourceValidationClear:true,readbackChecked:true,
      readbackMatches:stored.identityRowsMatch,
      approvalEvidencePersistent:stored.approvalEvidencePersistent,
      offlineEvidenceMatches:stored.identityRowsMatch===true &&
        stored.approvalEvidencePersistent===true,
      counts,issues
    };
  }catch{
    // Never emit source data or an arbitrary database exception.
    throw new Error('Party import evidence unavailable');
  }
}
