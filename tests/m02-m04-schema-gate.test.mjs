import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const file=(name)=>readFileSync(new URL(name,root),'utf8');

test('versioned M02/M04 auth migration has five concrete guarded auth tables, never an import fixture',()=>{
  const migrations=readdirSync(new URL('migrations/',root)).filter(s=>s.endsWith('.sql')).sort();
  assert.deepEqual(migrations,[
    '0001_core_catalog.sql','0002_party_identity.sql','0003_auth_core.sql','0004_auth_source_provenance.sql','0005_expense_categories.sql','0006_legacy_error_logs.sql','0007_legacy_delete_log.sql','0008_legacy_sales_draft_audit.sql','0009_legacy_invoice_edit_audit.sql','0010_legacy_opening_balance_edit_audit.sql','0011_legacy_stock_lot_cost_corrections.sql','0012_legacy_product_snapshots.sql',
  ]);
  const sql=file('migrations/0003_auth_core.sql');
  for(const table of ['auth_roles','auth_users','auth_legacy_credentials','auth_sessions','auth_login_throttle']){
    assert.match(sql,new RegExp('CREATE TABLE '+table+'\\s*\\('));
  }
  for(const trigger of [
    'trg_auth_last_admin_update','trg_auth_last_admin_delete',
    'trg_auth_user_version','trg_auth_role_version','trg_auth_session_no_replace',
    'trg_auth_session_identity_seal','trg_auth_session_no_delete',
    'trg_auth_credential_downgrade','trg_auth_legacy_purge',
  ]) assert.ok(sql.includes('CREATE TRIGGER '+trigger),trigger);
  assert.doesNotMatch(sql,/NONDEPLOYABLE LOCAL TEST FIXTURE|NOT A MIGRATION/);
  assert.doesNotMatch(sql,/INSERT INTO auth_users|INSERT INTO auth_legacy_credentials/i);
});

test('manual remote staging apply remains blocked while only M02 first two migrations are approved',()=>{
  const workflow=file('.github/workflows/remote-d1-staging.yml');
  assert.match(workflow,/Gate approved migration count before any remote apply/);
  assert.match(workflow,/EXPECTED_REMOTE_MIGRATION_COUNT=2/);
  const preview=JSON.parse(file('wrangler.preview.jsonc'));
  assert.equal(preview.d1_databases,undefined);
  const index=file('src/index.js');
  assert.doesNotMatch(index,/createD1LegacyAuthRpc|authAdapter:/);
  assert.match(file('src/rpc/registry.js'),/Object\.create\(null\)/);
});

test('frozen ROLES Role ID retains an immutable unique source reference in the real auth schema',()=>{
  const config=file('legacy/source/Config.gs');
  assert.match(config,/ROLES:\s*\[\s*"Role ID"/);
  const sql=file('migrations/0003_auth_core.sql');
  assert.match(sql,/source_role_id TEXT UNIQUE/);
  assert.match(sql,/CREATE TRIGGER trg_auth_role_source_id_no_replace/);
  assert.match(sql,/CREATE TRIGGER trg_auth_role_source_id_immutable/);
});
