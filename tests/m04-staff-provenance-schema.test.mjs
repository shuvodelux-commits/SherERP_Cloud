import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const file=name=>readFileSync(new URL(name,root),'utf8');

test('frozen staff and role source columns remain the provenance authority',()=>{
  const source=file('legacy/source/Config.gs');
  const users=source.slice(source.indexOf('USERS: ['),source.indexOf('ROLES: ['));
  const roles=source.slice(source.indexOf('ROLES: ['),source.indexOf('DELETE_LOG: ['));
  for(const field of ['User ID','Created By','Created At','Last Login'])
    assert.ok(users.includes('"'+field+'"'),field);
  for(const field of ['Role ID','Created At'])
    assert.ok(roles.includes('"'+field+'"'),field);
});

test('versioned M04 provenance migration stores exact source staff/role metadata with immutable guards',()=>{
  const migrations=readdirSync(new URL('migrations/',root)).filter(x=>x.endsWith('.sql')).sort();
  assert.deepEqual(migrations,[
    '0001_core_catalog.sql',
    '0002_party_identity.sql',
    '0003_auth_core.sql',
    '0004_auth_staff_provenance.sql',
  ]);
  const sql=file('migrations/0004_auth_staff_provenance.sql');
  for(const table of ['auth_user_source_provenance','auth_role_source_provenance'])
    assert.match(sql,new RegExp('CREATE TABLE '+table+'\\s*\\('));
  for(const field of [
    'source_created_by','source_created_at_iso','source_last_login_at_iso',
    'source_role_id','user_id'
  ]) assert.ok(sql.includes(field),field);
  for(const trigger of [
    'trg_auth_user_provenance_no_replace','trg_auth_user_provenance_no_update',
    'trg_auth_user_provenance_no_delete','trg_auth_role_provenance_no_replace',
    'trg_auth_role_provenance_no_update','trg_auth_role_provenance_no_delete',
  ]) assert.ok(sql.includes('CREATE TRIGGER '+trigger),trigger);
  assert.doesNotMatch(sql,/INSERT INTO auth_users|INSERT INTO auth_roles/i);
  const publicWorker=file('src/index.js')+file('src/rpc/registry.js');
  assert.doesNotMatch(publicWorker,/auth_user_source_provenance|auth_role_source_provenance/);
});

test('remote staging remains blocked for unauthorised new schema count',()=>{
  const workflow=file('.github/workflows/remote-d1-staging.yml');
  assert.match(workflow,/EXPECTED_REMOTE_MIGRATION_COUNT=2/);
  assert.match(workflow,/actual_count.*EXPECTED_REMOTE_MIGRATION_COUNT/);
  assert.equal(JSON.parse(file('wrangler.preview.jsonc')).d1_databases,undefined);
});
