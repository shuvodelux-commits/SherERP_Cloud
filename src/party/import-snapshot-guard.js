/**
 * M02-P OFFLINE Party import source-drift guard (READ ONLY).
 * Original source at pinned Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * Compare an owner-reviewed export with a later import candidate. Output
 * never contains source IDs, names, phone numbers, balances or approval refs.
 * This is NOT a production import approval, auth boundary or D1 adapter.
 */
import {partyLegacyContracts} from './legacy-contracts.js';
import {planPartyImport} from './party-import-plan.js';

const groups=Object.keys(partyLegacyContracts);
const object=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value)===Object.prototype ||
    Object.getPrototypeOf(value)===null);
const badSnapshot=()=>new Error('Invalid Party import snapshot');
const badProvenance=()=>new Error('Invalid Party source row provenance');

function canonical(value){
  if(value===null || typeof value==='string' || typeof value==='boolean')
    return JSON.stringify(value);
  if(typeof value==='number' && Number.isFinite(value))
    return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort()
    .map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  throw badSnapshot();
}

function inspect(snapshot){
  if(!object(snapshot) || Object.keys(snapshot).length!==groups.length ||
     Object.keys(snapshot).some(group=>!groups.includes(group)) ||
     groups.some(group=>!Array.isArray(snapshot[group])))throw badSnapshot();

  const byGroup=new Map();
  let total=0;
  for(const group of groups){
    const records=new Map(),ids=new Set();
    const idColumn=partyLegacyContracts[group].idColumn;
    let missingIds=0,duplicateIds=0;
    for(const row of snapshot[group]){
      total++;
      if(!object(row))throw badSnapshot();
      const id=row[idColumn];
      const goodId=typeof id==='string' && id.trim().length>0;
      if(!goodId)missingIds++;
      else if(ids.has(id))duplicateIds++;
      else ids.add(id);
      let locator;
      if(Object.hasOwn(row,'_rowIndex')){
        if(!Number.isInteger(row._rowIndex) || row._rowIndex<2)throw badProvenance();
        locator='ROW:'+row._rowIndex;
      }else if(goodId){
        locator='ID:'+id;
      }else{
        throw badProvenance();
      }
      if(records.has(locator))throw badProvenance();
      records.set(locator,canonical(row));
    }
    byGroup.set(group,{records,missingIds,duplicateIds});
  }
  return {byGroup,total};
}
function issue(issues,sourceGroup,code,count){
  if(count>0)issues.push({sourceGroup,code,count});
}

/**
 * @returns {{formatVersion:number,sourceSnapshotMatches:boolean,
 * offlineRehearsalClear:boolean,counts:object,issues:object[]}}
 * No input rows or identifying values are returned.
 */
export function validatePartyImportSnapshot({
  reviewedSnapshot,candidateSnapshot,approvedGroups=[]
}={}){
  const reviewed=inspect(reviewedSnapshot),candidate=inspect(candidateSnapshot);
  const issues=[];
  let changedRows=0,addedRows=0,removedRows=0;
  for(const group of groups){
    const original=reviewed.byGroup.get(group),current=candidate.byGroup.get(group);
    let changed=0,added=0,removed=0;
    for(const [locator,value] of original.records){
      if(!current.records.has(locator))removed++;
      else if(current.records.get(locator)!==value)changed++;
    }
    for(const locator of current.records.keys()){
      if(!original.records.has(locator))added++;
    }
    changedRows+=changed;addedRows+=added;removedRows+=removed;
    issue(issues,group,'SOURCE_ROW_CHANGED',changed);
    issue(issues,group,'SOURCE_ROW_ADDED',added);
    issue(issues,group,'SOURCE_ROW_REMOVED',removed);
    issue(issues,group,'DUPLICATE_SOURCE_ID',current.duplicateIds);
    issue(issues,group,'MISSING_SOURCE_ID',current.missingIds);
  }

  const sourceSnapshotMatches=changedRows===0 && addedRows===0 && removedRows===0;
  let plan;
  try{
    // Prove the supplied decision was well-formed for the originally reviewed
    // rows. Never carry it forward across source changes: a drifted candidate
    // must go through human review again.
    planPartyImport(reviewedSnapshot,approvedGroups);
    plan=planPartyImport(candidateSnapshot,
      sourceSnapshotMatches?approvedGroups:[]);
  }catch{
    // Existing importer errors may contain user-provided group/source text.
    throw new Error('Invalid Party review evidence');
  }
  issue(issues,'PLAN','QUARANTINED_SOURCE_ROWS',plan.summary.quarantinedRows);
  issue(issues,'PLAN','PENDING_IDENTITY_REVIEW',plan.summary.pendingIdentityReviews);
  issues.sort((a,b)=>a.sourceGroup.localeCompare(b.sourceGroup)||
    a.code.localeCompare(b.code));
  return {
    formatVersion:1,
    sourceSnapshotMatches,
    offlineRehearsalClear:sourceSnapshotMatches && issues.length===0,
    counts:{
      reviewedRows:reviewed.total,candidateRows:candidate.total,
      changedRows,addedRows,removedRows,
      quarantinedRows:plan.summary.quarantinedRows,
      pendingIdentityReviews:plan.summary.pendingIdentityReviews
    },
    issues
  };
}
