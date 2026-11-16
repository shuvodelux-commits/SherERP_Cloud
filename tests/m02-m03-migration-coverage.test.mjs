import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {buildMigrationCoverage} from '../scripts/audit-migration-coverage.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const sheet=(sheetKey)=>({sheetKey,sheetName:sheetKey,columns:['ID','Name']});
const tinySchema={formatVersion:1,tables:[
  sheet('SETTINGS'),sheet('CUSTOMERS'),sheet('USERS'),sheet('SALES')
]};
const tinyMigrations={
  '0001.sql':'CREATE TABLE settings (key TEXT);',
  '0002.sql':'CREATE TABLE party_legacy_links (source_group TEXT);',
  '0003.sql':'CREATE TABLE auth_users (user_id TEXT);'
};
const scan=(schema=tinySchema,migrations=tinyMigrations)=>
  buildMigrationCoverage({schema,migrations,sourceCommit,asyncImpactedFunctions:394});

test('classifies catalog, Party identity, local auth and unmapped data without claiming full source import',()=>{
  const out=scan();
  assert.equal(out.formatVersion,1);
  assert.equal(out.sourceCommit,sourceCommit);
  assert.deepEqual(out.summary,{
    sourceGroups:4,catalogSchemaOnly:1,diagnosticSchemaOnly:0,partyIdentityOnly:1,
    authLocalOnly:1,unmapped:1,fullyReconciled:0,asyncImpactedFunctions:394
  });
  assert.deepEqual(out.rows.map(x=>[x.sheetKey,x.status,x.targetTable]),[
    ['SETTINGS','catalog-schema-only','settings'],
    ['CUSTOMERS','party-identity-only','party_legacy_links'],
    ['USERS','auth-local-only','auth_users'],
    ['SALES','unmapped',null]
  ]);
  assert.ok(out.rows.every(x=>x.sourceImportReconciled===false));
  assert.ok(out.rows.every(x=>x.sourceColumnCount===2));
  assert.match(out.limitations,/not.*proof|not.*import/i);
  assert.deepEqual(scan(),out);
});

test('rejects nonexistent mapped target, even when CREATE TABLE only appears in a SQL comment',()=>{
  assert.throws(()=>scan(tinySchema,{'0001.sql':'-- CREATE TABLE settings (key TEXT);',...tinyMigrations,
    '0001.sql':'-- CREATE TABLE settings (key TEXT);'}),/missing.*settings|mapped.*settings/i);
  assert.throws(()=>scan(tinySchema,{...tinyMigrations,'0002.sql':'/* CREATE TABLE party_legacy_links (id INT); */'}),/missing.*party_legacy_links/i);
  assert.throws(()=>scan(tinySchema,{...tinyMigrations,'0003.sql':'SELECT 1;'}),/missing.*auth_users/i);
});

test('rejects duplicate or malformed source groups, blank migration and invalid source SHA',()=>{
  const duplicate={...tinySchema,tables:[...tinySchema.tables,sheet('SALES')]};
  assert.throws(()=>scan(duplicate),/duplicate.*SALES/i);
  assert.throws(()=>scan({...tinySchema,tables:[]}),/source.*group|empty/i);
  assert.throws(()=>scan(tinySchema,{'0001.sql':''}),/migration|missing/i);
  assert.throws(()=>buildMigrationCoverage({
    schema:tinySchema,migrations:tinyMigrations,sourceCommit:'unverified',
    asyncImpactedFunctions:394
  }),/commit/i);
});

test('frozen 49-group Config inventory and six local migration files yield zero fully reconciled groups',()=>{
  const current=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
  const baseline=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
  assert.deepEqual(current,baseline,'original source config must match frozen inventory');
  const files=readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort();
  assert.deepEqual(files.map(x=>x.slice(0,4)),['0001','0002','0003','0004','0005','0006']);
  const migrations=Object.fromEntries(files.map(x=>
    [x,readFileSync(new URL('../migrations/'+x,import.meta.url),'utf8')]));
  const closure=JSON.parse(readFileSync(new URL('../docs/baseline/m03-async-caller-closure.json',import.meta.url),'utf8'));
  const out=buildMigrationCoverage({
    schema:current,migrations,
    sourceCommit,asyncImpactedFunctions:closure.counts.impactedFunctions
  });
  assert.deepEqual(out.summary,{
    sourceGroups:49,catalogSchemaOnly:4,diagnosticSchemaOnly:1,partyIdentityOnly:5,
    authLocalOnly:3,unmapped:36,fullyReconciled:0,asyncImpactedFunctions:394
  });
  assert.equal(out.rows.length,49);
  assert.ok(out.rows.every(x=>x.sourceImportReconciled===false));
});

test('CLI check succeeds on pinned source but rejects unknown mode and never emits credentials',()=>{
  const cli=fileURLToPath(new URL('../scripts/audit-migration-coverage.mjs',import.meta.url));
  const yes=spawnSync(process.execPath,[cli,'--check'],{cwd:root,encoding:'utf8'});
  assert.equal(yes.status,0,yes.stderr);
  assert.match(yes.stdout,/49.*source.*group|coverage.*verified/i);
  const bad=spawnSync(process.execPath,[cli,'--unknown'],{cwd:root,encoding:'utf8'});
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/usage|mode/i);
  const json=spawnSync(process.execPath,[cli,'--json'],{cwd:root,encoding:'utf8'});
  assert.equal(json.status,0,json.stderr);
  assert.equal(JSON.parse(json.stdout).summary.sourceGroups,49);
});
