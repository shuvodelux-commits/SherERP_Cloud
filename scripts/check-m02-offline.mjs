#!/usr/bin/env node
/**
 * M02-safe: strict OFFLINE source-to-plan reconciliation.
 * No D1, Cloudflare credentials, output files, or printed source records.
 */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCatalogImport} from '../src/db/catalog-import.js';
import {planPartyImport} from '../src/party/party-import-plan.js';
import {partyLegacyContracts, rolesForLegacyRow} from '../src/party/legacy-contracts.js';

const CATALOG_IDS = Object.freeze({
  SETTINGS:['Key','key'],
  PRODUCT_CATEGORIES:['Category ID','category_id'],
  PRODUCT_UNITS:['Unit ID','unit_id']
});
const sourceKey=(group,id)=>JSON.stringify([group,id]);
const sortedKeys=(keys)=>JSON.stringify(keys.slice().sort());
const count=(groups)=>Object.values(groups).reduce((n,rows)=>n+rows.length,0);
const reject=(message)=>{throw new Error('Offline reconciliation: '+message);};

/** Independently check that all planned source rows and Party identities survive. */
export function verifyM02OfflineReconciliation({
  catalogSource,partySource,catalogPlan,partyPlan,approvedGroups=[]
}) {
  if (!catalogPlan?.tables || !partyPlan?.summary ||
      !Array.isArray(partyPlan.links) || !Array.isArray(partyPlan.parties) ||
      !Array.isArray(partyPlan.roles) || !Array.isArray(approvedGroups)) {
    reject('invalid input plans');
  }

  let catalogRows=0;
  for(const [group,[sourceId,plannedId]] of Object.entries(CATALOG_IDS)) {
    const source=catalogSource?.[group],planned=catalogPlan.tables[group];
    if(!Array.isArray(source) || !Array.isArray(planned) || source.length!==planned.length) {
      reject('catalog row count mismatch');
    }
    catalogRows+=source.length;
    for(let i=0;i<source.length;i++){
      const row=source[i],target=planned[i];
      if(!row || !target || String(row[sourceId])!==target[plannedId]) {
        reject('catalog identifier mismatch');
      }
      const originalPosition=Object.hasOwn(row,'_rowIndex')?row._rowIndex:null;
      const plannedPosition=Object.hasOwn(target,'legacy_sheet_row')?target.legacy_sheet_row:null;
      if(originalPosition!==plannedPosition)reject('catalog source row position mismatch');
    }
  }
  if(catalogPlan.summary?.totalRows!==catalogRows ||
     Object.keys(catalogPlan.tables).length!==Object.keys(CATALOG_IDS).length) {
    reject('catalog summary/count mismatch');
  }

  const original=new Map();
  for(const [group,spec] of Object.entries(partyLegacyContracts)){
    const rows=partySource?.[group];
    if(!Array.isArray(rows))reject('missing Party source group');
    for(const row of rows){
      const id=row?.[spec.idColumn];
      if(typeof id!=='string'||!id.trim())reject('quarantined Party source row');
      const key=sourceKey(group,id);
      if(original.has(key))reject('duplicate/quarantined Party source row');
      original.set(key,{row,group});
    }
  }
  if(Object.keys(partySource).length!==Object.keys(partyLegacyContracts).length ||
     partyPlan.summary.sourceRows!==count(partySource) ||
     partyPlan.summary.quarantinedRows!==0) {
    reject('quarantined or incomplete Party source rows');
  }
  if(partyPlan.links.length!==original.size || partyPlan.summary.legacyLinks!==original.size) {
    reject('Party legacy link count mismatch');
  }

  const linked=new Map(),members=new Map();
  for(const link of partyPlan.links){
    const key=sourceKey(link.sourceGroup,link.sourceId);
    const found=original.get(key);
    if(!found || linked.has(key) || typeof link.partyId!=='string') {
      reject('Party source link missing/duplicated');
    }
    const position=found.row._rowIndex??null;
    if(link.legacySheetRow!==position)reject('Party legacy sheet row position mismatch');
    linked.set(key,link);
    if(!members.has(link.partyId))members.set(link.partyId,[]);
    members.get(link.partyId).push(key);
  }
  if(members.size!==partyPlan.parties.length ||
     members.size!==partyPlan.summary.proposedParties ||
     new Set(partyPlan.parties.map(p=>p.partyId)).size!==members.size ||
     partyPlan.parties.some(p=>!members.has(p.partyId))) {
    reject('Party identity count mismatch');
  }

  const expectedProof=new Map();
  for(const proof of approvedGroups){
    if(!Array.isArray(proof?.members)||proof.members.length<2)reject('invalid approved evidence');
    const group=sortedKeys(proof.members.map(m=>sourceKey(m.sourceGroup,m.sourceId)));
    if(expectedProof.has(group))reject('duplicate approved evidence');
    expectedProof.set(group,proof);
  }
  const usedProof=new Set();
  for(const keys of members.values()){
    if(keys.length===1){
      if(linked.get(keys[0]).linkBasis!=='ORIGINAL_RECORD')reject('unreviewed identity link basis');
      continue;
    }
    const group=sortedKeys(keys),proof=expectedProof.get(group);
    if(!proof)reject('unreviewed Party identity merge');
    usedProof.add(group);
    const records=keys.map(key=>linked.get(key));
    if(records.filter(link=>link.linkBasis==='ORIGINAL_RECORD').length!==1 ||
       records.filter(link=>link.linkBasis==='HUMAN_VERIFIED').length!==records.length-1) {
      reject('reviewed Party identity provenance mismatch');
    }
    for(const link of records.filter(link=>link.linkBasis==='HUMAN_VERIFIED')){
      if(link.reviewedBy!==proof.reviewedBy || link.reviewedAt!==proof.reviewedAt ||
         link.approvalRef!==proof.approvalRef)reject('Party approval evidence mismatch');
    }
  }
  if(usedProof.size!==expectedProof.size ||
     partyPlan.summary.reviewedGroups!==approvedGroups.length) {
    reject('unapplied Party review evidence');
  }

  const expectedRoles=new Set();
  for(const [key,{row,group}] of original){
    for(const role of rolesForLegacyRow(group,row)){
      expectedRoles.add(sourceKey(linked.get(key).partyId,role));
    }
  }
  const actualRoles=partyPlan.roles.map(r=>sourceKey(r.partyId,r.role));
  if(actualRoles.length!==new Set(actualRoles).size ||
     actualRoles.length!==expectedRoles.size ||
     actualRoles.some(key=>!expectedRoles.has(key)) ||
     partyPlan.summary.roleMemberships!==expectedRoles.size) {
    reject('Party role membership mismatch');
  }
  if(Object.hasOwn(partyPlan,'accounts') || Object.hasOwn(partyPlan,'settlements')) {
    reject('unexpected financial plan output');
  }
  if(!Array.isArray(partyPlan.reviewItems) ||
     partyPlan.reviewItems.some(r=>!['SHARED_PHONE','SAME_NAME'].includes(r.reason))) {
    reject('unresolved/quarantined Party identity reviews');
  }

  return {
    catalogRows,partyRows:original.size,legacyLinks:linked.size,
    quarantinedRows:0,proposedParties:members.size,approvedGroups:usedProof.size
  };
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    if(!process.argv[2] || !process.argv[3])throw new Error('Missing offline inputs');
    const inventoryPath=new URL('../docs/baseline/schema-inventory.json',import.meta.url);
    const readJson=async p=>JSON.parse(await readFile(p,'utf8'));
    const [inventory,catalogSource,partySource,approvedGroups]=await Promise.all([
      readJson(inventoryPath),readJson(resolve(process.argv[2])),
      readJson(resolve(process.argv[3])),
      process.argv[4]?readJson(resolve(process.argv[4])):Promise.resolve([])
    ]);
    const catalogPlan=prepareCatalogImport(inventory,catalogSource);
    const partyPlan=planPartyImport(partySource,approvedGroups);
    const result=verifyM02OfflineReconciliation({
      catalogSource,partySource,catalogPlan,partyPlan,approvedGroups
    });
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  })().catch(()=>{
    // Never echo Party names/phones, paths, or input JSON on validation failure.
    console.error('M02 offline reconciliation rejected: check source and review evidence locally');
    process.exitCode=1;
  });
}