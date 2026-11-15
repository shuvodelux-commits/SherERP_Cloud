/**
 * M02-P INTERNAL OFFLINE-ONLY gross source rehearsal.
 * Frozen GAS: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * No database, RPC, approval authorization, financial posting or netting.
 */
import {validatePartyImportCandidate} from './import-validation-bundle.js';
import {validateFinanceTransactionExport} from './finance-export-coverage.js';
import {prepareGrossPartyBalances} from './gross-balance-preflight.js';

const allowedGross=new Set([
  'IDENTITY_REVIEW_PENDING','UNRESOLVED_MASTER_ID','BALANCE_COLUMN_MISSING',
  'VENDOR_NEGATIVE_DIRECTION','FINANCE_ID_REQUIRED','FINANCE_ID_DUPLICATE',
  'FINANCE_PERSON_ID_REQUIRED','FINANCE_LEGACY_LINK_MISSING',
  'FINANCE_TYPE_UNKNOWN','FINANCE_ROLE_NOT_MAPPED',
  'FINANCE_AMOUNT_REQUIRED','FINANCE_NEGATIVE_AMOUNT','FINANCE_ZERO_AMOUNT'
]);
const sorted=(a,b)=>a.stage.localeCompare(b.stage)||
  a.scope.localeCompare(b.scope)||a.code.localeCompare(b.code);
const record=(stage,scope,code,count)=>({stage,scope,code,count});
const countGross=issues=>{
  const byReason=new Map();
  for(const {reason} of issues){
    if(!allowedGross.has(reason))throw new Error('Unsupported gross reason');
    byReason.set(reason,(byReason.get(reason)||0)+1);
  }
  return [...byReason].map(([code,count])=>
    record('GROSS_ACCOUNT','GROSS_ACCOUNT',code,count));
};

/** Returns fixed codes and counts only; never a money or identity snapshot. */
export function validatePartyGrossRehearsal({
  reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,approvedGroups,
  financeRows,financeHeaders,declaredFinanceRows
}={}){
  try{
    const party=validatePartyImportCandidate({
      reviewedRows,reviewedHeaders,candidateRows,candidateHeaders,
      approvedGroups
    });
    const finance=validateFinanceTransactionExport({
      sourceRows:financeRows,sourceHeaders:financeHeaders,
      declaredRowCount:declaredFinanceRows
    });
    const issues=[
      ...party.issues.map(i=>record(i.stage,i.sourceGroup,i.code,i.count)),
      ...finance.issues.map(i=>record('FINANCE_EXPORT',
        'FINANCE_TRANSACTIONS',i.code,i.count))
    ];
    const counts={party:party.counts,finance:finance.counts,gross:null};
    let grossDesignReviewClear=null,grossPreflightChecked=false;
    if(party.offlineValidationClear===true &&
       finance.offlineExportComplete===true){
      const gross=prepareGrossPartyBalances({
        sourceRows:candidateRows,approvedGroups,financeRows
      });
      grossPreflightChecked=true;
      grossDesignReviewClear=gross.readyForAccountDesignReview===true;
      counts.gross={
        proposedParties:gross.summary.proposedParties,
        sourceFinanceRows:gross.summary.sourceFinanceRows,
        deletedFinanceRows:gross.summary.deletedFinanceRows,
        pendingIdentityReviews:gross.summary.pendingIdentityReviews,
        currentCheckpointCount:gross.summary.currentCheckpointCount,
        historicalOpeningCheckpointCount:
          gross.summary.historicalOpeningCheckpointCount
      };
      issues.push(...countGross(gross.blockingIssues));
    }else{
      issues.push(record('GATE','GROSS_ACCOUNT','GROSS_PREFLIGHT_SKIPPED',1));
    }
    issues.sort(sorted);
    return {
      formatVersion:1,
      partySourceValid:party.offlineValidationClear,
      financeExportValid:finance.offlineExportComplete,
      grossPreflightChecked,grossDesignReviewClear,
      offlineGrossRehearsalClear:grossPreflightChecked &&
        grossDesignReviewClear===true,
      counts,issues
    };
  }catch{
    // No underlying source values, Party IDs, approval refs or money in errors.
    throw new Error('Party gross rehearsal unavailable');
  }
}
