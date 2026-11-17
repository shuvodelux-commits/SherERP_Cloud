import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
 assessExistingStagingForAuthPrefix,
} from '../scripts/check-m03-auth-staging-prefix.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const config=p=>JSON.parse(read(p));
const STAGING='aa04618e-1639-4cb9-bdf5-7b967d8b968b';
const HISTORY='3328e5c8-7695-4d6c-8bcf-9725437ebdd5';
const CORE=[
 'd1_migrations','parties','party_identity_review','party_legacy_links',
 'party_roles','product_categories','product_units','settings',
];
const PARTY_TRIGGERS=[
 'trg_party_cross_source_verification',
 'trg_party_legacy_identity_immutable',
 'trg_party_legacy_link_delete_forbidden',
 'trg_party_role_delete_forbidden',
];
const q=results=>[{success:true,results,meta:{changed_db:false,rows_written:0}}];
const observation=()=>({
 staging:config('wrangler.staging.jsonc'),
 preview:config('wrangler.preview.jsonc'),
 resources:[
  {name:'shererp-staging-db',uuid:STAGING},
  {name:'shererp-legacy-history-staging-20261118',uuid:HISTORY},
 ],
 tables:q(CORE.map(name=>({name}))),
 triggers:q(PARTY_TRIGGERS.map(name=>({name}))),
 migrations:q([
  {id:1,name:'0001_core_catalog.sql'},
  {id:2,name:'0002_party_identity.sql'},
 ]),
});
const assess=object=>assessExistingStagingForAuthPrefix(object);

test('real staging read-only inventory exactly matches existing reviewed 0001/0002 prefix; remote writes remain forbidden',()=>{
 const r=assess(observation());
 assert.equal(r.reportVersion,1);
 assert.equal(r.existingMigrationCount,2);
 assert.equal(r.existingApplicationTables,7);
 assert.equal(r.existingPartyTriggers,4);
 assert.equal(r.existingAuthTables,0);
 assert.deepEqual(r.nextReviewedAuthMigrations,[
  '0003_auth_core.sql','0004_auth_source_provenance.sql',
 ]);
 assert.equal(r.documentaryPrefixMatch,true);
 assert.equal(r.recoveryBookmarkAttested,false);
 assert.equal(r.remoteMigrationAuthorized,false);
 assert.equal(r.staffImportAuthorized,false);
 assert.equal(r.publicAuthenticationEnabled,false);
 assert.equal(r.productionReady,false);
 assert.doesNotMatch(JSON.stringify(r),/phone|Password|123456|private staff/i);
});
test('staging account/resource, private archive and public preview isolation are mandatory',()=>{
 const a=observation();a.resources[0].uuid='wrong';
 assert.throws(()=>assess(a),/M03 staging auth prefix rejected/);
 const b=observation();b.resources[1].uuid='wrong';
 assert.throws(()=>assess(b),/M03 staging auth prefix rejected/);
 const c=observation();c.preview.d1_databases=[{binding:'DB',database_id:STAGING}];
 assert.throws(()=>assess(c),/M03 staging auth prefix rejected/);
});
test('missing, extra, repeated, reordered and forged remote migration history fail closed',()=>{
 const changes=[
  ms=>ms.reverse(),
  ms=>ms.pop(),
  ms=>ms.push({id:3,name:'0003_auth_core.sql'}),
  ms=>ms[0].id=9,
  ms=>ms[1].name='0002_not_reviewed.sql',
  ms=>ms.push(ms[0]),
 ];
 for(const change of changes){
  const input=observation();change(input.migrations[0].results);
  assert.throws(()=>assess(input),/M03 staging auth prefix rejected/);
 }
});
test('unexpected schema objects, missing Party guard and premature authentication table fail closed',()=>{
 for(const edit of [
  o=>o.tables[0].results.push({name:'auth_users'}),
  o=>o.tables[0].results.push({name:'financial_ledger'}),
  o=>o.tables[0].results.pop(),
  o=>o.tables[0].results[0].name='sqlite_sequence',
  o=>o.triggers[0].results.pop(),
  o=>o.triggers[0].results.push({name:'trg_unreviewed'}),
 ]){
  const item=observation();edit(item);
  assert.throws(()=>assess(item),/M03 staging auth prefix rejected/);
 }
});
test('remote SQL metadata must prove SELECT-only execution, no rows written',()=>{
 const variants=[
  x=>x.tables[0].meta.rows_written=1,
  x=>x.triggers[0].meta.changed_db=true,
  x=>x.migrations[0].success=false,
  x=>x.tables[0].results[0].extra='PRIVATE',
  x=>x.tables.push({success:true,results:[],meta:{changed_db:false,rows_written:0}}),
  x=>delete x.tables[0].meta,
 ];
 for(const modify of variants){
  const item=observation();modify(item);
  assert.throws(()=>assess(item),/M03 staging auth prefix rejected/);
 }
});
test('source accessor traps never execute, and private error text is never reflected',()=>{
 const original=observation();
 let touched=0;
 Object.defineProperty(original.migrations[0].results[0],'name',{
  enumerable:true,configurable:true,get(){touched++;throw Error('PRIVATE_SECRET_PASSWORD');}
 });
 assert.throws(()=>assess(original),e=>{
  assert.equal(e.message,'M03 staging auth prefix rejected');
  return true;
 });
 assert.equal(touched,0);
});
test('actual 0001/0002 → 0003/0004 SQL applies to an already populated synthetic core without erasing Party history',()=>{
 const db=new DatabaseSync(':memory:');
 const migrations=['0001_core_catalog.sql','0002_party_identity.sql',
   '0003_auth_core.sql','0004_auth_source_provenance.sql'];
 try{
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE)');
  for(const name of migrations.slice(0,2)){
   db.exec(read('migrations/'+name));
   db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(name);
  }
  db.prepare("INSERT INTO settings (key,value) VALUES ('synthetic-tax','0')").run();
  db.prepare("INSERT INTO product_categories (category_id,category_name) VALUES ('CAT-1','Synthetic fixture')").run();
  db.prepare("INSERT INTO product_units (unit_id,unit_name) VALUES ('UNT-1','Pcs')").run();
  db.prepare("INSERT INTO parties (party_id,display_name,created_at) VALUES ('P-1','Synthetic Party','2026-01-01')").run();
  db.prepare("INSERT INTO party_roles (party_id,role,created_at) VALUES ('P-1','Owner','2026-01-01')").run();
  const readback=()=>({
   settings:db.prepare('SELECT key,value FROM settings ORDER BY row_id').all(),
   categories:db.prepare('SELECT category_id,category_name FROM product_categories ORDER BY row_id').all(),
   units:db.prepare('SELECT unit_id,unit_name FROM product_units ORDER BY row_id').all(),
   parties:db.prepare('SELECT party_id,display_name,created_at FROM parties ORDER BY party_id').all(),
   roles:db.prepare('SELECT party_id,role,created_at FROM party_roles ORDER BY party_id').all(),
  });
  const original=readback();
  db.exec('BEGIN');
  for(const name of migrations.slice(2)){
   db.exec(read('migrations/'+name));
   db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(name);
  }
  db.exec('COMMIT');
  assert.deepEqual(readback(),original);
  assert.deepEqual(db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(x=>x.name),migrations);
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'auth_%' ORDER BY name").all().map(x=>x.name);
  assert.deepEqual(tables,[
   'auth_legacy_credentials','auth_login_throttle','auth_roles','auth_sessions','auth_users',
  ]);
  const guardNames=db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_party_%' ORDER BY name").all().map(x=>x.name);
  assert.deepEqual(guardNames,PARTY_TRIGGERS);
  const userColumns=db.prepare('PRAGMA table_info(auth_users)').all().map(x=>x.name);
  for(const col of ['source_created_by','source_created_at_iso','source_last_login_iso'])
   assert(userColumns.includes(col));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
  assert.throws(()=>db.prepare("DELETE FROM party_roles WHERE party_id='P-1'").run());
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
});
test('no remote SQL operation or disabled M11 manual apply guard is introduced by this M03 preflight',()=>{
 const source=read('scripts/check-m03-auth-staging-prefix.mjs');
 assert.doesNotMatch(source,/wrangler d1|--remote|CREATE TABLE|INSERT INTO|UPDATE auth_|DELETE FROM|\.batch\(/i);
 const workflow=read('.github/workflows/remote-d1-staging.yml');
 assert.match(workflow,/EXPECTED_REMOTE_MIGRATION_COUNT=2/);
 assert.match(workflow,/assert-empty/);
 assert.doesNotMatch(read('wrangler.preview.jsonc'),/d1_databases/);
});