/**
 * M02-P internal OFFLINE-only Party import validation composition.
 * Pinned GAS source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * This is neither production import approval nor an authenticated D1 writer.
 *
 * Both original export coverages are mandatory BEFORE trying to reuse
 * reviewed identity decisions or compare the changed source snapshot.
 */
import {validatePartyExportCompleteness} from './export-column-coverage.js';
import {validatePartyImportSnapshot} from './import-snapshot-guard.js';

function redacted(stage,items){
  return items.map(({sourceGroup,code,count})=>({stage,sourceGroup,code,count}));
}
const sortIssues=(a,b)=>a.stage.localeCompare(b.stage)||
  a.sourceGroup.localeCompare(b.sourceGroup)||a.code.localeCompare(b.code);

/** Return fixed-vocabulary issue counts only, never source or approval data. */
export function validatePartyImportCandidate({
  reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,approvedGroups
}={}){
  try {
    if(!Array.isArray(approvedGroups))
      throw new Error('Missing explicit review decision');

    const reviewed=validatePartyExportCompleteness({
      sourceRows:reviewedRows,sourceHeaders:reviewedHeaders
    });
    const candidate=validatePartyExportCompleteness({
      sourceRows:candidateRows,sourceHeaders:candidateHeaders
    });
    const issues=[
      ...redacted('REVIEWED_EXPORT',reviewed.issues),
      ...redacted('CANDIDATE_EXPORT',candidate.issues)
    ];
    const counts={
      reviewedRows:reviewed.counts.sourceRows,
      candidateRows:candidate.counts.sourceRows,
      headerIssues:reviewed.counts.headerIssues+candidate.counts.headerIssues,
      missingFields:reviewed.counts.missingFields+candidate.counts.missingFields,
      unexpectedFields:reviewed.counts.unexpectedFields+candidate.counts.unexpectedFields,
      unsafeValues:reviewed.counts.unsafeValues+candidate.counts.unsafeValues,
      changedRows:null,addedRows:null,removedRows:null,
      quarantinedRows:null,pendingIdentityReviews:null
    };
    let sourceUnchanged=null,identityReviewClear=null;
    if(reviewed.offlineExportComplete && candidate.offlineExportComplete){
      const snapshot=validatePartyImportSnapshot({
        reviewedSnapshot:reviewedRows,candidateSnapshot:candidateRows,approvedGroups
      });
      sourceUnchanged=snapshot.sourceSnapshotMatches;
      identityReviewClear=snapshot.offlineRehearsalClear;
      for(const key of ['changedRows','addedRows','removedRows',
        'quarantinedRows','pendingIdentityReviews']){
        counts[key]=snapshot.counts[key];
      }
      issues.push(...redacted('IDENTITY_SNAPSHOT',snapshot.issues));
    }else{
      issues.push({
        stage:'VALIDATION',sourceGroup:'VALIDATION',
        code:'VALIDATION_SKIPPED',count:1
      });
    }
    issues.sort(sortIssues);
    return {
      formatVersion:1,
      reviewedExportComplete:reviewed.offlineExportComplete,
      candidateExportComplete:candidate.offlineExportComplete,
      sourceUnchanged,identityReviewClear,
      offlineValidationClear:reviewed.offlineExportComplete &&
        candidate.offlineExportComplete && identityReviewClear===true,
      counts,issues
    };
  }catch{
    // Legacy Group IDs and source read/approval errors can carry private data.
    throw new Error('Party import validation unavailable');
  }
}
