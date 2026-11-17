import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectPrivateHistoryArchive} from '../src/db/private-history-archive-read.js';
import {validateStagingConfig} from '../scripts/check-staging-d1.mjs';
import {assertExactD1Resource} from '../scripts/guard-remote-staging.mjs';

const staging=JSON.parse(readFileSync(new URL('../wrangler.staging.jsonc',import.meta.url),'utf8'));
const preview=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
const publicConfig=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const operational={name:'shererp-staging-db',uuid:'aa04618e-1639-4cb9-bdf5-7b967d8b968b'};
const archive={name:'shererp-legacy-history-staging-20261118',uuid:'3328e5c8-7695-4d6c-8bcf-9725437ebdd5'};

test('M03 private config binds two distinct exact D1 resources and keeps all public previews DB-free',()=>{
 assert.equal(validateStagingConfig(staging,preview),true);
 assert.deepEqual(staging.d1_databases.map(x=>x.binding),['DB','HISTORY_ARCHIVE']);
 assert.equal(staging.d1_databases[0].database_id,operational.uuid);
 assert.equal(staging.d1_databases[1].database_id,archive.uuid);
 assert.equal(staging.workers_dev,false);
 assert.equal(publicConfig.d1_databases,undefined);
 assert.equal(preview.d1_databases,undefined);
 assert.deepEqual(preview.previews,{});
 assert.equal(assertExactD1Resource([operational,archive]),true);
});

test('M03 private binding rejects swapped IDs, public exposure, extra bindings, staging/archival alias and routes',()=>{
 for(const [unsafe,match] of [
  [{...staging,d1_databases:[staging.d1_databases[1],staging.d1_databases[0]]},/binding|database/i],
  [{...staging,d1_databases:[{...staging.d1_databases[0],database_id:archive.uuid},staging.d1_databases[1]]},/database|id/i],
  [{...staging,d1_databases:[staging.d1_databases[0],{...staging.d1_databases[1],database_id:operational.uuid}]},/database|id/i],
  [{...staging,d1_databases:[...staging.d1_databases,staging.d1_databases[1]]},/exactly|binding/i],
  [{...staging,workers_dev:true},/workers_dev/i],
  [{...staging,routes:['example.com/*']},/unexpected|route/i],
 ]){
  assert.throws(()=>validateStagingConfig(unsafe,preview),match);
 }
 assert.throws(()=>assertExactD1Resource([operational]),/archive|database|resource/i);
 assert.throws(()=>assertExactD1Resource([operational,{...archive,uuid:'wrong'}]),/identity|UUID|archive/i);
});

function mockArchive(){
 const sql=[];
 const source={
  prepare(query){
   sql.push(query);
   if(query.includes('FROM archive_sheets'))return {first:async()=>({
    total_sheets:50,populated_rows:10397,physical_rows:20597
   })};
   if(query.includes('FROM archive_source_parts'))return {first:async()=>({
    workbook_chunks:12
   })};
   throw new Error('query not allowlisted');
  }
 };
 const db={prepare(){throw new Error('operational D1 must not be read in archive preflight')}};
 return {env:{DB:db,HISTORY_ARCHIVE:source},sql};
}
test('fixed SQL private archive read only returns safe aggregate counts, no source identities or values',async()=>{
 const {env,sql}=mockArchive();
 const result=await inspectPrivateHistoryArchive(env);
 assert.deepEqual(result,{
  status:'private-staging-archive-verified',
  sourceGroups:49,sheets:50,populatedRows:10397,physicalRows:20597,
  workbookParts:12,operationalImportAuthorized:false,publicRpcEnabled:false
 });
 assert.equal(sql.length,2);
 assert.ok(sql.every(x=>/^\s*SELECT\s/i.test(x)));
 assert.doesNotMatch(JSON.stringify(result),/Customer Name|Password Hash|Settings|phone|token/i);
});
test('missing, aliased, corrupted or incomplete D1 archive fail closed',async()=>{
 const {env}=mockArchive();
 for(const candidate of [
  {},{DB:env.DB},{HISTORY_ARCHIVE:env.HISTORY_ARCHIVE},
  {DB:env.DB,HISTORY_ARCHIVE:env.DB}
 ])await assert.rejects(()=>inspectPrivateHistoryArchive(candidate),/binding|archive/i);
 const malformed={DB:env.DB,HISTORY_ARCHIVE:{prepare:()=>({first:async()=>({total_sheets:1,populated_rows:0,physical_rows:0})})}};
 await assert.rejects(()=>inspectPrivateHistoryArchive(malformed),/archive|count/i);
});