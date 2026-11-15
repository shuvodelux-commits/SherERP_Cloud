/**
 * M02-P2 OFFLINE, NO-WRITE identity import planner. Never assumes that a shared
 * name/phone is proof of a shared financial identity. NOT a database importer.
 */
import {createHash} from 'node:crypto';
import {partyLegacyContracts, PARTY_ROLES, rolesForLegacyRow} from './legacy-contracts.js';

const groups=Object.keys(partyLegacyContracts);
const str=(v)=>typeof v==='string'?v:'';
const sourceKey=(g,id)=>JSON.stringify([g,id]);
const hash=(value)=>createHash('sha256').update(value).digest('hex').slice(0,26).toUpperCase();
const entityId=(key)=>'PT-'+hash(key);
const reviewId=(reason,key)=>'REV-'+hash(reason+'|'+key);
const normName=(s)=>str(s).trim().replace(/\s+/g,' ').toLocaleLowerCase('en');
const normPhone=(s)=>str(s).replace(/[^0-9]/g,'');
const inactive=(row)=>String(row.Status||'').trim().toLowerCase()==='inactive'||
  String(row['Is Deleted']||'').trim().toLowerCase()==='true';
const cite=(row)=>({sourceGroup:row.group,sourceId:row.id});

export function planPartyImport(sourceRows,approvedGroups=[]) {
  if(!sourceRows || typeof sourceRows!=='object'||Array.isArray(sourceRows))throw new Error('Invalid legacy snapshot');
  for(const group of Object.keys(sourceRows))if(!groups.includes(group))throw new Error('Unknown source group: '+group);
  for(const group of groups)if(!Array.isArray(sourceRows[group]))throw new Error('Missing source group: '+group);
  if(!Array.isArray(approvedGroups))throw new Error('Approved groups must be an array');

  let sourceCount=0;
  const candidates=[];
  const reviews=[];
  const byKey=new Map();
  for(const group of groups){
    const spec=partyLegacyContracts[group];
    const seenSourceRows=new Set();
    for(const source of sourceRows[group]){
      sourceCount++;
      if(!source || typeof source!=='object'||Array.isArray(source))throw new Error('Invalid legacy row in '+group);
      const id=str(source[spec.idColumn]);
      const legacySheetRow=source._rowIndex===undefined?null:source._rowIndex;
      if(legacySheetRow!==null){
        if(!Number.isInteger(legacySheetRow)||legacySheetRow<2)throw new Error('Invalid legacy row position in '+group);
        if(seenSourceRows.has(legacySheetRow))throw new Error('Duplicate source row position in '+group);
        seenSourceRows.add(legacySheetRow);
      }
      if(!id.trim()){
        const key=sourceKey(group,'missing:'+(legacySheetRow??hash(JSON.stringify(source))));
        reviews.push({reviewId:reviewId('MISSING_ID',key),sourceGroup:group,sourceId:null,legacySheetRow,reason:'MISSING_ID',status:'OPEN'});
        continue;
      }
      const key=sourceKey(group,id);
      const name=str(source[spec.nameColumn]);
      if(!name.trim()){
        reviews.push({reviewId:reviewId('OTHER',key),sourceGroup:group,sourceId:id,legacySheetRow,reason:'OTHER',status:'OPEN'});
        continue;
      }
      const row={group,id,key,name,phone:str(source[spec.phoneColumn]),legacySheetRow,
        roles:rolesForLegacyRow(group,source),inactive:inactive(source)};
      candidates.push(row);
      if(!byKey.has(key))byKey.set(key,[]);
      byKey.get(key).push(row);
    }
  }
  const duplicateKeys=new Set([...byKey].filter(([,rows])=>rows.length>1).map(([key])=>key));
  for(const key of duplicateKeys){
    const row=byKey.get(key)[0];
    reviews.push({reviewId:reviewId('DUPLICATE_ID',key),sourceGroup:row.group,
      sourceId:row.id,legacySheetRow:row.legacySheetRow,reason:'DUPLICATE_ID',status:'OPEN'});
  }
  const valid=candidates.filter(row=>!duplicateKeys.has(row.key));
  const found=new Map(valid.map(row=>[row.key,row]));
  const joined=new Map();
  const approved=[];
  for(const proof of approvedGroups){
    if(!proof || !Array.isArray(proof.members) || proof.members.length<2 ||
       !str(proof.reviewedBy).trim() || !str(proof.reviewedAt).trim() || !str(proof.approvalRef).trim()) {
      throw new Error('Approved Party link requires at least two source members and human review evidence');
    }
    const memberKeys=proof.members.map(m=>sourceKey(m.sourceGroup,m.sourceId));
    if(new Set(memberKeys).size!==memberKeys.length)throw new Error('Duplicate source member in reviewed group');
    for(const key of memberKeys){
      if(!found.has(key))throw new Error('Unknown or quarantined Party identity in reviewed group');
      if(joined.has(key))throw new Error('Overlapping reviewed Party groups');
    }
    const sorted=memberKeys.sort();
    for(const key of sorted)joined.set(key,sorted[0]);
    approved.push({anchor:sorted[0],members:sorted,proof});
  }

  const grouped=new Map();
  for(const row of valid){
    const anchor=joined.get(row.key)||row.key;
    if(!grouped.has(anchor))grouped.set(anchor,[]);
    grouped.get(anchor).push(row);
  }
  const proofByAnchor=new Map(approved.map(x=>[x.anchor,x.proof]));
  const parties=[],roles=[],links=[];
  const reservedIds=new Set();
  for(const [anchor,rows] of [...grouped].sort(([a],[b])=>a.localeCompare(b))){
    rows.sort((a,b)=>a.key.localeCompare(b.key));
    const first=rows[0];
    const partyId=entityId(anchor);
    if(reservedIds.has(partyId))throw new Error('Party ID collision');
    reservedIds.add(partyId);
    parties.push({partyId,displayName:first.name,phone:first.phone,partyKind:'UNKNOWN',
      status:rows.some(x=>!x.inactive)?'ACTIVE':'INACTIVE'});
    for(const role of PARTY_ROLES){
      const attached=rows.filter(x=>x.roles.includes(role));
      if(!attached.length)continue;
      roles.push({partyId,role,status:attached.some(x=>!x.inactive)?'ACTIVE':'INACTIVE'});
    }
    const proof=proofByAnchor.get(anchor);
    rows.forEach((row,index)=>links.push({partyId,sourceGroup:row.group,sourceId:row.id,
      legacySheetRow:row.legacySheetRow,linkBasis:index===0?'ORIGINAL_RECORD':'HUMAN_VERIFIED',
      reviewedBy:index===0?null:proof.reviewedBy,
      reviewedAt:index===0?null:proof.reviewedAt,
      approvalRef:index===0?null:proof.approvalRef,
      status:row.inactive?'RETIRED':'ACTIVE'}));
  }

  // Candidate suggestions only: no linking or authorization is performed.
  const indexed={SHARED_PHONE:new Map(),SAME_NAME:new Map()};
  for(const link of links){
    const original=found.get(sourceKey(link.sourceGroup,link.sourceId));
    for(const [reason,val] of [['SHARED_PHONE',normPhone(original.phone)],['SAME_NAME',normName(original.name)]]){
      if(!val)continue;
      const index=indexed[reason];
      if(!index.has(val))index.set(val,[]);
      index.get(val).push(link);
    }
  }
  for(const [reason,index] of Object.entries(indexed))for(const matches of index.values()){
    const partiesById=new Map();
    for(const link of matches)if(!partiesById.has(link.partyId))partiesById.set(link.partyId,link);
    const distinct=[...partiesById].sort(([a],[b])=>a.localeCompare(b));
    if(distinct.length<2)continue;
    const first=distinct[0][0];
    for(const [,link] of distinct.slice(1)){
      const key=sourceKey(link.sourceGroup,link.sourceId)+'|'+first;
      reviews.push({reviewId:reviewId(reason,key),sourceGroup:link.sourceGroup,sourceId:link.sourceId,
        candidatePartyId:first,reason,status:'OPEN'});
    }
  }
  parties.sort((a,b)=>a.partyId.localeCompare(b.partyId));
  roles.sort((a,b)=>a.partyId.localeCompare(b.partyId)||PARTY_ROLES.indexOf(a.role)-PARTY_ROLES.indexOf(b.role));
  links.sort((a,b)=>a.sourceGroup.localeCompare(b.sourceGroup)||a.sourceId.localeCompare(b.sourceId));
  reviews.sort((a,b)=>a.reviewId.localeCompare(b.reviewId));
  for(let i=1;i<reviews.length;i++){
    if(reviews[i].reviewId===reviews[i-1].reviewId)throw new Error('Duplicate review ID provenance');
  }
  const quarantinedRows=sourceCount-valid.length;
  return {parties,roles,links,reviewItems:reviews,summary:{sourceRows:sourceCount,
    proposedParties:parties.length,legacyLinks:links.length,roleMemberships:roles.length,
    quarantinedRows,reviewedGroups:approved.length,pendingIdentityReviews:reviews.length,
    sourceGroups:groups.map(group=>({sourceGroup:group,rows:sourceRows[group].length}))}};
}
