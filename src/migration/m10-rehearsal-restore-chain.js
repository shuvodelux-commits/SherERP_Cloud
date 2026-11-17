/**
 * M10-12: supplied-evidence source->D1->backup->restored continuity only.
 *
 * Previous offline preflights can each pass for two unrelated data sets.
 * Link their 49 canonical group summaries without accessing the original
 * Sheets, a D1 binding, private exports or production configuration.
 */
import {assessM10RehearsalEvidence} from './m10-rehearsal-gate.js';
import {assessM10RestoreIntegrity} from './m10-restore-integrity.js';

const BAD='M10 rehearsal restore chain invalid';
const LIMITATIONS='Supplied summaries cannot prove independent source provenance, an actual D1 restore, private-data reconciliation or cutover approval';

/**
 * @returns a redacted, candidate-only metadata report.
 * No source IDs, money, original rows, capture IDs or raw SHA digests escape.
 */
export function assessM10RehearsalRestoreChain({rehearsal,restore}={}){
  try{
    const issues=new Map();
    const add=(code,count=1)=>issues.set(code,(issues.get(code)||0)+count);
    if(rehearsal===undefined)add('CHAIN_REHEARSAL_EVIDENCE_MISSING');
    if(restore===undefined)add('CHAIN_RESTORE_EVIDENCE_MISSING');

    // Reuse reviewed independent gates. All access to caller-supplied nested
    // evidence stays within the redacting outer try/catch.
    const sourceGate=rehearsal===undefined?null:
      assessM10RehearsalEvidence(rehearsal);
    const restoreGate=restore===undefined?null:
      assessM10RestoreIntegrity(restore);
    const rehearsalCandidate=sourceGate?.candidateDataParity===true;
    const restoreCandidate=restoreGate?.candidateRestoreParity===true;
    if(sourceGate&&!rehearsalCandidate)add('CHAIN_REHEARSAL_NOT_READY');
    if(restoreGate&&!restoreCandidate)add('CHAIN_RESTORE_NOT_READY');

    let groupsLinked=false;
    if(rehearsalCandidate&&restoreCandidate){
      const source=new Map(rehearsal.d1Summary.map(row=>[row.sheetKey,row]));
      const backup=new Map(restore.backup.groups.map(row=>[row.sheetKey,row]));
      let linked=true;
      for(const [key,d1] of source){
        const saved=backup.get(key);
        if(!saved){
          add('CHAIN_D1_BACKUP_GROUP_MISSING');
          linked=false;
          continue;
        }
        if(saved.rowCount!==d1.rowCount){
          add('CHAIN_D1_BACKUP_ROW_COUNT_MISMATCH');
          linked=false;
        }
        if(saved.rowDigest!==d1.rowDigest){
          add('CHAIN_D1_BACKUP_ROW_DIGEST_MISMATCH');
          linked=false;
        }
        if(key==='LOGS'){
          if(saved.positionDigest!==d1.positionDigest){
            add('CHAIN_D1_BACKUP_POSITION_MISMATCH');
            linked=false;
          }
        }else if(saved.idDigest!==d1.idDigest){
          add('CHAIN_D1_BACKUP_ORIGINAL_ID_MISMATCH');
          linked=false;
        }
      }
      for(const key of backup.keys())if(!source.has(key)){
        add('CHAIN_D1_BACKUP_GROUP_UNEXPECTED');
        linked=false;
      }
      groupsLinked=linked&&source.size===49&&backup.size===49;
      if(restore.backup.capturedAt<=rehearsal.sourceFreeze.secondPass.capturedAt)
        add('CHAIN_BACKUP_BEFORE_SOURCE_FREEZE');
    }

    const ordered=[...issues].sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_OFFLINE_REHEARSAL_RESTORE_CHAIN',
      rehearsalCandidate,restoreCandidate,groupsLinked,
      candidateChainParity:rehearsalCandidate&&restoreCandidate&&
        groupsLinked&&ordered.length===0,
      authorizesImport:false,authorizesRestore:false,productionReady:false,
      issues:ordered,limitations:LIMITATIONS
    };
  }catch{
    // Never reveal private values from nested errors, proxies or getters.
    throw new Error(BAD);
  }
}
