import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {M06_SALE_TEST_DDL} from './fixtures/m06-sale-posting-schema.mjs';

const text=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');

test('M06 synthetic sale schema is strictly test-only and never deployed or migrated',()=>{
  const cfg=JSON.parse(text('../wrangler.m06-sale-posting-test.jsonc'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.main,'tests/fixtures/m06-sale-posting-worker.mjs');
  assert.deepEqual(cfg.d1_databases.map(x=>x.database_id),
    ['00000000-0000-0000-0000-000000000016']);
  assert.ok(!text('../src/index.js').includes('m06_invoices'));
  assert.ok(!text('../src/rpc/registry.js').includes('m06-sale-posting-contract'));
  assert.equal(text('../src/rpc/registry.js').includes('rpcRegistry'),true);
  assert.ok(M06_SALE_TEST_DDL.every(sql=>!sql.includes('DROP TABLE')));
  assert.ok(M06_SALE_TEST_DDL.some(sql=>sql.includes('m06-stale-stock')));
  assert.ok(M06_SALE_TEST_DDL.some(sql=>sql.includes('m06-customer-link-stale')));
});

test('M06 uses the source-faithful split calculator and reviewed M03 canonical SHA-256 fingerprint',()=>{
  const contract=text('./fixtures/m06-sale-posting-contract.mjs');
  assert.ok(contract.includes("from '../../src/modules/sale-payments.js'"));
  assert.ok(contract.includes("from '../../src/db/operation-intent-fingerprint.js'"));
  assert.ok(contract.includes('DB.batch(['));
  assert.ok(contract.includes('ON CONFLICT(tenant_id,operation_id) DO NOTHING'));
  assert.ok(contract.includes('NEEDS_REVIEW'));
  assert.ok(!contract.includes('LockService'));
  assert.ok(!contract.includes('getAllRows_'));
});
