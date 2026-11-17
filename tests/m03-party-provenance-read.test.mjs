import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {resolveLegacyPartyByProvenance} from '../src/db/party-identity-read.js';

const ddl=readFileSync(new URL('../migrations/0002_party_identity.sql',import.meta.url),'utf8');
const identity=(sourceGroup,sourceId,legacySheetRow)=>({sourceGroup,sourceId,legacySheetRow});
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(ddl);
  sql.exec(`
    INSERT INTO parties(party_id,display_name,status,created_at) VALUES
      ('P-A','Shared Name','ACTIVE','2026-11-17'),
      ('P-B','Shared Name','ACTIVE','2026-11-17'),
      ('P-HIST','Old Customer','INACTIVE','2026-11-17');
    INSERT INTO party_legacy_links
      (source_group,source_id,legacy_sheet_row,party_id,link_basis,created_at)
    VALUES('CUSTOMERS','CUS-0007',2,'P-A','ORIGINAL_RECORD','2026-11-17');
    INSERT INTO party_legacy_links
      (source_group,source_id,legacy_sheet_row,party_id,link_basis,reviewed_by,reviewed_at,created_at)
    VALUES('SUPPLIERS','SUP-0008',7,'P-A','HUMAN_VERIFIED','REV-1','2026-11-17','2026-11-17');
    INSERT INTO party_legacy_links
      (source_group,source_id,legacy_sheet_row,party_id,link_basis,created_at)
    VALUES('CUSTOMERS','CUS-0009',3,'P-B','ORIGINAL_RECORD','2026-11-17');
    INSERT INTO party_legacy_links
      (source_group,source_id,legacy_sheet_row,party_id,link_basis,created_at)
    VALUES('FINANCE_PERSONS','FPER-10',11,'P-HIST','ORIGINAL_RECORD','2026-11-17');
    INSERT INTO party_legacy_links
      (source_group,source_id,legacy_sheet_row,party_id,link_basis,status,created_at)
    VALUES('VENDORS','VEN-13',5,'P-B','ORIGINAL_RECORD','DISPUTED','2026-11-17');
  `);
  const queries=[];
  const DB={prepare(query){
    queries.push(query);
    const stmt=sql.prepare(query);
    return {bind(...args){return {async all(){
      return {success:true,results:stmt.all(...args).map(row=>({...row}))};
    }};}};
  }};
  return {sql,env:{DB},queries,close:()=>sql.close()};
}

test('exact legacy group+source ID+physical row resolves reviewed identity without merging same names',async()=>{
  const x=fixture();try{
    assert.deepEqual(await resolveLegacyPartyByProvenance(x.env,identity('CUSTOMERS','CUS-0007',2)),{
      partyId:'P-A',sourceGroup:'CUSTOMERS',sourceId:'CUS-0007',
      legacySheetRow:2,linkBasis:'ORIGINAL_RECORD',partyStatus:'ACTIVE'
    });
    assert.deepEqual(await resolveLegacyPartyByProvenance(x.env,identity('SUPPLIERS','SUP-0008',7)),{
      partyId:'P-A',sourceGroup:'SUPPLIERS',sourceId:'SUP-0008',
      legacySheetRow:7,linkBasis:'HUMAN_VERIFIED',partyStatus:'ACTIVE'
    });
    assert.equal(x.queries.length,2);
    assert(x.queries.every(query=>/^SELECT/i.test(query.trim())));
    assert(x.queries.every(query=>/legacy_sheet_row\s*=\s*\?/i.test(query)));
    assert(x.queries.every(query=>/LIMIT 2\b/i.test(query)));
  }finally{x.close();}
});

test('wrong or stale row, wrong group, deleted/disputed link and unknown IDs never fall back to name or phone',async()=>{
  const x=fixture();try{
    for(const v of [
      identity('CUSTOMERS','CUS-0007',3),
      identity('CUSTOMERS','CUS-0009',2),
      identity('CUSTOMERS','CUS-00007',2),
      identity('SUPPLIERS','CUS-0007',2),
      identity('VENDORS','VEN-13',5),
      identity('VENDORS','VEN-13',2),
      identity('EXPENSE_PAYEES','EPAY-1',2)
    ]) assert.equal(await resolveLegacyPartyByProvenance(x.env,v),null);
    assert.equal(x.sql.prepare('SELECT COUNT(*) AS n FROM party_legacy_links').get().n,5);
  }finally{x.close();}
});

test('inactive Party still retains historical source identity without becoming an authorization grant',async()=>{
  const x=fixture();try{
    assert.deepEqual(await resolveLegacyPartyByProvenance(x.env,identity('FINANCE_PERSONS','FPER-10',11)),{
      partyId:'P-HIST',sourceGroup:'FINANCE_PERSONS',sourceId:'FPER-10',
      legacySheetRow:11,linkBasis:'ORIGINAL_RECORD',partyStatus:'INACTIVE'
    });
  }finally{x.close();}
});

test('invalid group, nonphysical row or client-owned shape fails before D1 access',async()=>{
  let queries=0;
  const env={DB:{prepare(){queries++;throw Error('unexpected read');}}};
  const cases=[
    identity('UNKNOWN','CUS-0007',2),identity('CUSTOMERS','',2),
    identity('CUSTOMERS','  ',2),identity('CUSTOMERS',7,2),
    identity('CUSTOMERS','CUS-0007',1),identity('CUSTOMERS','CUS-0007',2.2),
    identity('CUSTOMERS','CUS-0007',Number.MAX_SAFE_INTEGER+1),
    {...identity('CUSTOMERS','CUS-0007',2),actorId:'ADMIN'},
    Object.assign(Object.create({isAdministrator:true}),identity('CUSTOMERS','CUS-0007',2)),
    Object.defineProperty({sourceGroup:'CUSTOMERS',sourceId:'CUS-0007'},'legacySheetRow',{
      enumerable:true,get(){throw Error('accessor');}
    })
  ];
  for(const input of cases){
    await assert.rejects(()=>resolveLegacyPartyByProvenance(env,input),/invalid|source|row|field|shape|unsupported/i);
  }
  assert.equal(queries,0);
  await assert.rejects(()=>resolveLegacyPartyByProvenance({},identity('CUSTOMERS','CUS-0007',2)),/D1|binding/i);
});

test('malformed, duplicate, poisoned or failed D1 readback requires review, not an inferred Party match',async()=>{
  const base={
    party_id:'P-A',source_group:'CUSTOMERS',source_id:'CUS-0007',
    legacy_sheet_row:2,link_basis:'ORIGINAL_RECORD',party_status:'ACTIVE'
  };
  const param=identity('CUSTOMERS','CUS-0007',2);
  for(const result of [
    {success:false,results:[]},
    {success:true,results:[base,base]},
    {success:true,results:[null]},
    {success:true,results:[{...base,party_id:' '}]},
    {success:true,results:[{...base,source_id:'CUS-9999'}]},
    {success:true,results:[{...base,legacy_sheet_row:3}]},
    {success:true,results:[{...base,link_basis:'AUTO_MERGED'}]},
    {success:true,results:[{...base,party_status:'UNKNOWN'}]}
  ]){
    const env={DB:{prepare(){return {bind(){return {async all(){return result;}};}};}}};
    await assert.rejects(()=>resolveLegacyPartyByProvenance(env,param),/D1|ambiguous|invalid|mismatch|integrity/i);
  }
});

test('source provenance read is private and does not activate source RPC or production DB',()=>{
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry+live,/resolveLegacyPartyByProvenance|party-source-row/i);
});
