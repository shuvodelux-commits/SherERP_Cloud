/**
 * M10-15: compose existing OFFLINE, supplied-evidence migration preflights.
 *
 * This is not an exporter, source reader, D1 adapter, recovery operator,
 * attestation verifier, release authorization or a posting authority.
 */
import {assessM10RehearsalRestoreChain} from './m10-rehearsal-restore-chain.js';
import {assessM10GrossPartyReconciliation} from './m10-gross-party-reconcile.js';
import {assessM10PerformanceBudget} from './m10-performance-budget-gate.js';

const BAD='M10 evidence packet invalid';
const LIMITATIONS='Supplied offline evidence cannot prove authorized source capture, actual D1 import, independent account/security review or production release';
const FIELDS=['rehearsal','restore','gross','performance'];
const fail=()=>{throw new Error(BAD);};

/** Do not evaluate a caller-supplied getter, inherited evidence or unknown key. */
function exactInput(input){
  if(input===null||typeof input!=='object'||Array.isArray(input)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail();
  for(const key of Reflect.ownKeys(input)){
    if(typeof key!=='string'||!FIELDS.includes(key))fail();
    const descriptor=Object.getOwnPropertyDescriptor(input,key);
    if(descriptor?.enumerable!==true||!Object.hasOwn(descriptor,'value'))fail();
  }
  return input;
}

export function assessM10EvidencePacket(input={}){
  try{
    const evidence=exactInput(input);
    const issues=new Map();
    const add=(code,count=1)=>issues.set(code,(issues.get(code)||0)+count);

    let chainCandidate=false,grossCandidate=false,performanceCandidate=false;
    const hasRehearsal=evidence.rehearsal!==undefined;
    const hasRestore=evidence.restore!==undefined;
    const hasGross=evidence.gross!==undefined;
    const hasPerformance=evidence.performance!==undefined;

    if(!hasRehearsal||!hasRestore){
      add('PACKET_CHAIN_EVIDENCE_MISSING');
    }else{
      const chain=assessM10RehearsalRestoreChain({
        rehearsal:evidence.rehearsal,restore:evidence.restore
      });
      chainCandidate=chain.candidateChainParity===true;
      if(!chainCandidate)add('PACKET_CHAIN_NOT_READY');
    }

    if(!hasGross)add('PACKET_GROSS_EVIDENCE_MISSING');
    else{
      const gross=assessM10GrossPartyReconciliation(evidence.gross);
      grossCandidate=gross.candidateGrossParity===true;
      if(!grossCandidate)add('PACKET_GROSS_NOT_READY');
    }

    if(!hasPerformance)add('PACKET_PERFORMANCE_EVIDENCE_MISSING');
    else{
      const perf=assessM10PerformanceBudget(evidence.performance);
      performanceCandidate=perf.budgetCandidate===true;
      if(!performanceCandidate)add('PACKET_PERFORMANCE_NOT_READY');
    }

    if(hasRehearsal&&hasGross&&
      Number.isSafeInteger(evidence.rehearsal.pendingIdentityReviews)&&
      Number.isSafeInteger(evidence.gross.identityReviewsPending)&&
      evidence.rehearsal.pendingIdentityReviews!==evidence.gross.identityReviewsPending)
      add('PACKET_IDENTITY_REVIEW_COUNT_CONFLICT');

    // M10-14 gross checkpoints submitted as source/D1 evidence for M10-12
    // must not be later than that backup. Timestamps do not prove custody;
    // this only rejects one concrete impossible chain.
    if(chainCandidate&&grossCandidate){
      const at=evidence.restore.backup.capturedAt;
      if(evidence.gross.source.capturedAt>at)
        add('PACKET_GROSS_CAPTURE_AFTER_BACKUP');
      if(evidence.gross.d1.capturedAt>at)
        add('PACKET_GROSS_CAPTURE_AFTER_BACKUP');
    }

    const sorted=[...issues].sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_OFFLINE_EVIDENCE_PACKET',
      chainCandidate,grossCandidate,performanceCandidate,
      candidateEvidenceComplete:chainCandidate&&grossCandidate&&
        performanceCandidate&&sorted.length===0,
      authorizesImport:false,authorizesPosting:false,
      authorizesRestore:false,authorizesCutover:false,
      productionReady:false,issues:sorted,limitations:LIMITATIONS
    };
  }catch{
    // Defensive data-only output. Never emit source/D1/private secrets or
    // opaque original-ID commitments from nested errors.
    throw new Error(BAD);
  }
}
