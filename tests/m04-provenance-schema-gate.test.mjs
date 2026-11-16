import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const file=name=>readFileSync(new URL(name,root),'utf8');

test('fourth source-provenance D1 migration adds original staff and role history without seeding identities',()=>{
  const sqls=readdirSync(new URL('migrations/',root)).filter(n=>n.endsWith('.sql')).sort();
  assert.deepEqual(sqls,[
    '0001_core_catalog.sql','0002_party_identity.sql',
    '0003_auth_core.sql','0004_auth_source_provenance.sql','0005_expense_categories.sql',
  ]);
  const sql=file('migrations/0004_auth_source_provenance.sql');
  for(const [table,column] of [
    ['auth_users','source_created_by'],['auth_users','source_created_at_iso'],
    ['auth_users','source_last_login_iso'],['auth_roles','source_created_at_iso'],
  ]) assert.match(sql,new RegExp('ALTER TABLE '+table+' ADD COLUMN '+column+'\\s+TEXT'));
  for(const trigger of ['trg_auth_user_provenance_immutable','trg_auth_role_provenance_immutable'])
    assert.match(sql,new RegExp('CREATE TRIGGER '+trigger+'\\b'));
  assert.doesNotMatch(sql,/\bINSERT INTO auth_users|\bINSERT INTO auth_roles/i);
  assert.doesNotMatch(sql,/\bDROP TABLE\b|\bDELETE FROM\b/i);
});

test('remote staging apply still fails closed while only the first two migrations are approved',()=>{
  const workflow=file('.github/workflows/remote-d1-staging.yml');
  assert.match(workflow,/EXPECTED_REMOTE_MIGRATION_COUNT=2/);
  assert.match(workflow,/Gate approved migration count before any remote apply/);
  assert.equal(JSON.parse(file('wrangler.preview.jsonc')).d1_databases,undefined);
  assert.match(file('src/rpc/registry.js'),/Object\.create\(null\)/);
});

test('source-created actor and original last login never substitute live auth sessions',()=>{
  const source=file('legacy/source/Config.gs');
  assert.match(source,/"Created By"/);
  assert.match(source,/"Last Login"/);
  const worker=file('src/index.js');
  assert.doesNotMatch(worker,/staff-provenance-preflight|source_last_login_iso/);
});
