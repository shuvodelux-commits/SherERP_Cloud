import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,statSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {makeM03AuthOnlyBundle} from '../scripts/prepare-m03-auth-only-bundle.mjs';
import {assessM03AuthOnlyPostApply} from '../scripts/check-m03-auth-only-post.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const NAMES=[
 '0001_core_catalog.sql','0002_party_identity.sql',
 '0003_auth_core.sql','0004_auth_source_provenance.sql',
];
const AUTH=['auth_legacy_credentials','auth_login_throttle','auth_roles','auth_sessions','auth_users'];
const CORE=['settings','product_categories','product_units',
 'parties','party_roles','party_legacy_links','party_identity_review'];
const PARTY_TRIGGERS=[
 'trg_party_cross_source_verification','trg_party_legacy_identity_immutable',
 'trg_party_legacy_link_delete_forbidden','trg_party_role_delete_forbidden',
];
const sha=b=>createHash('sha256').update(b).digest('hex');
function workspace(){return mkdtempSync(join(tmpdir(),'m03-auth-only-'));}
const q=results=>[{success:true,results,meta:{changed_db:false,rows_written:0}}];
const triggers=()=>{
 const text=NAMES.slice(2).map(n=>read('migrations/'+n)).join('\n');
 return [...PARTY_TRIGGERS,...Array.from(text.matchAll(/\bCREATE\s+TRIGGER\s+([a-z][a-z0-9_]*)/gi),m=>m[1])].sort();
};
const after=()=>({
 migrations:q(NAMES.map((name,i)=>({id:i+1,name}))),
 tables:q([...CORE,'d1_migrations',...AUTH].sort().map(name=>({name}))),
 triggers:q(triggers().map(name=>({name}))),
 columns:q([
  {table_name:'auth_roles',name:'source_created_at_iso'},
  {table_name:'auth_users',name:'source_created_at_iso'},
  {table_name:'auth_users',name:'source_created_by'},
  {table_name:'auth_users',name:'source_last_login_iso'},
 ]),
 emptyAuth:q([{users:0,roles:0,legacy_credentials:0,sessions:0,throttle:0}]),
});

test('prepare a fresh private standalone bundle containing only SHA-pinned 0001-0004; no Worker/archive binding',()=>{
 const root=workspace(),target=join(root,'four-files');
 try{
  const report=makeM03AuthOnlyBundle(target);
  assert.deepEqual(report.migrations,NAMES);
  assert.equal(report.authMigrationsToApply,2);
  assert.equal(report.remoteMigrationAuthorized,false);
  assert.equal(report.staffImportAuthorized,false);
  assert.equal(report.publicAuthenticationEnabled,false);
  assert.equal(report.productionReady,false);
  assert.deepEqual(readdirSync(target).sort(),['migrations','wrangler.auth-only.jsonc']);
  assert.deepEqual(readdirSync(join(target,'migrations')).sort(),NAMES);
  const cfg=JSON.parse(readFileSync(join(target,'wrangler.auth-only.jsonc'),'utf8'));
  assert.equal(cfg.d1_databases.length,1);
  assert.equal(cfg.d1_databases[0].database_id,'aa04618e-1639-4cb9-bdf5-7b967d8b968b');
  assert.equal(cfg.d1_databases[0].database_name,'shererp-staging-db');
  assert.equal(cfg.d1_databases[0].migrations_dir,'migrations');
  assert.equal(JSON.stringify(cfg).includes('HISTORY_ARCHIVE'),false);
  for(const name of NAMES)assert.equal(sha(readFileSync(join(target,'migrations',name))),sha(read('migrations/'+name)));
  assert.equal(statSync(target).mode&0o777,0o700);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_PASSWORD|secret|0171234/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('changed SQL hash fails before any bundle creation or upload',()=>{
 const root=workspace(),src=join(root,'sources'),target=join(root,'out');
 try{
  mkdirSync(src);for(const name of NAMES)writeFileSync(join(src,name),read('migrations/'+name));
  writeFileSync(join(src,'0003_auth_core.sql'),read('migrations/0003_auth_core.sql')+'\n-- unauthorized drift\n');
  assert.throws(()=>makeM03AuthOnlyBundle(target,{migrationRoot:src}),/M03 auth-only migration bundle rejected/);
  assert.equal(readdirSync(root).includes('out'),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('output must be fresh, absolute and outside the source checkout; refuse overwrite',()=>{
 const root=workspace();try{
  const existing=join(root,'exists');mkdirSync(existing);
  assert.throws(()=>makeM03AuthOnlyBundle(existing),/rejected/);
  assert.throws(()=>makeM03AuthOnlyBundle('relative-bundle'),/rejected/);
  assert.throws(()=>makeM03AuthOnlyBundle(resolve('scripts/unreviewed-bundle')),/rejected/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('post-apply validation requires exactly four ordered migrations, seven preserved Party/catalog tables, five auth tables and zero staff rows',()=>{
 const r=assessM03AuthOnlyPostApply(after());
 assert.equal(r.documentaryPostSchemaMatch,true);
 assert.equal(r.appliedMigrationCount,4);
 assert.equal(r.preservedCoreTableCount,7);
 assert.equal(r.preservedPartyTriggerCount,4);
 assert.equal(r.authTableCount,5);
 assert.equal(r.authSourceProvenanceColumns,4);
 assert.equal(r.authRecordsCreatedBySchema,0);
 assert.equal(r.remoteMigrationAuthorized,false);
 assert.equal(r.staffImportAuthorized,false);
 assert.equal(r.publicAuthenticationEnabled,false);
 assert.equal(r.productionReady,false);
});
test('forged post state, extra migration, missing Party trigger or preloaded staff fail closed',()=>{
 for(const mutate of [
  x=>x.migrations[0].results.pop(),
  x=>x.migrations[0].results.reverse(),
  x=>x.migrations[0].results.push({id:5,name:'0005_expense_categories.sql'}),
  x=>x.tables[0].results.push({name:'unreviewed_finance_table'}),
  x=>x.tables[0].results.pop(),
  x=>x.triggers[0].results.pop(),
  x=>x.triggers[0].results.push({name:'trg_unreviewed'}),
  x=>x.columns[0].results.pop(),
  x=>x.emptyAuth[0].results[0].users=1,
  x=>x.emptyAuth[0].results[0].legacy_credentials=1,
  x=>x.emptyAuth[0].results[0].sessions=1,
 ]){const x=after();mutate(x);assert.throws(()=>assessM03AuthOnlyPostApply(x),/M03 auth-only post-apply rejected/);}
});
test('post inspection checks SELECT-only D1 metadata, rejects getters and does not echo sensitive values',()=>{
 const a=after();a.tables[0].meta.rows_written=1;
 assert.throws(()=>assessM03AuthOnlyPostApply(a),/rejected/);
 const b=after();b.migrations[0].meta.changed_db=true;
 assert.throws(()=>assessM03AuthOnlyPostApply(b),/rejected/);
 const c=after();let touched=0;
 Object.defineProperty(c.migrations[0].results[0],'name',{enumerable:true,get(){touched++;throw Error('PRIVATE_STAFF_SECRET');}});
 assert.throws(()=>assessM03AuthOnlyPostApply(c),e=>{assert.equal(e.message,'M03 auth-only post-apply rejected');return true;});
 assert.equal(touched,0);
});
test('original protected staging workflow and public Worker stay unchanged; no hidden remote call in bundle script',()=>{
 const old=read('.github/workflows/remote-d1-staging.yml');
 assert.match(old,/EXPECTED_REMOTE_MIGRATION_COUNT=2/);
 assert.match(old,/assert-empty/);
 assert.match(old,/cloudflare-staging-db/);
 const preview=JSON.parse(read('wrangler.preview.jsonc'));
 assert.equal(preview.d1_databases,undefined);
 const p=read('scripts/prepare-m03-auth-only-bundle.mjs');
 const check=read('scripts/check-m03-auth-only-post.mjs');
 assert.doesNotMatch(p+check,/--remote|wrangler d1 migrations apply|execSync\(|spawnSync\(|\bfetch\(/i);
});
test('actual historical 0001/0002 SQLite state can add only 0003/0004 without changing source rows',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE)');
  for(const name of NAMES.slice(0,2)){
   db.exec(read('migrations/'+name));
   db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
  }
  db.prepare("INSERT INTO settings (key,value) VALUES ('unchanged-setting','value')").run();
  db.prepare("INSERT INTO parties (party_id,display_name,created_at) VALUES ('PARTY-SOURCE-ID','Original Party','2026-01-01')").run();
  db.prepare("INSERT INTO party_roles (party_id,role,created_at) VALUES ('PARTY-SOURCE-ID','Owner','2026-01-01')").run();
  const before=db.prepare("SELECT p.party_id,p.display_name,r.role FROM parties p JOIN party_roles r ON r.party_id=p.party_id").all();
  for(const name of NAMES.slice(2)){
   db.exec(read('migrations/'+name));
   db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
  }
  assert.deepEqual(db.prepare("SELECT p.party_id,p.display_name,r.role FROM parties p JOIN party_roles r ON r.party_id=p.party_id").all(),before);
  assert.deepEqual(db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(x=>x.name),NAMES);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{db.close();}
});
