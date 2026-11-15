import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {compileSyntheticPartyImport} from '../fixtures/m02-party-plan-batch.mjs';

const masters=JSON.parse(readFileSync(new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const approvals=JSON.parse(readFileSync(new URL('../fixtures/party-approved.synthetic.json',import.meta.url),'utf8'));
const source=()=>structuredClone(masters);
const reviewed=()=>structuredClone(approvals);
const now='2026-11-15T00:00:00Z';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-plan-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-party-plan-local-only');
let DB;
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

const compile=(sourceRows=source(),approvedGroups=reviewed())=>
  compileSyntheticPartyImport({DB,sourceRows,approvedGroups,createdAt:now});
const count=async(table)=> (await DB.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
const counts=async()=>Object.fromEntries(await Promise.all([
  'parties','party_roles','party_legacy_links','party_identity_review'
].map(async name=>[name,await count(name)])));

test('unreviewed same-name/phone and missing-ID quarantine prevent any SQL plan',async()=>{
  const before=await counts();
  assert.throws(()=>compile(source(),[]),/review|unresolved|quarantin/i);
  const missing=source();missing.VENDORS[0]['Vendor ID']='';
  assert.throws(()=>compile(missing,[]),/review|unresolved|quarantin/i);
  const duplicate=source();duplicate.CUSTOMERS.push({...duplicate.CUSTOMERS[0],_rowIndex:3});
  assert.throws(()=>compile(duplicate,[]),/review|unresolved|quarantin/i);
  assert.deepEqual(await counts(),before,'pure compile must do no writes');
});

test('reviewed link evidence cannot be forged from missing/unknown source IDs',async()=>{
  const changes=reviewed();changes[0].reviewedBy='';
  assert.throws(()=>compile(source(),changes),/review|evidence|invalid/i);
  const unknown=reviewed();unknown[0].members.push({sourceGroup:'FINANCE_PERSONS',sourceId:'FIN-DOES-NOT-EXIST'});
  assert.throws(()=>compile(source(),unknown),/unknown|quarantin/i);
});

test('one atomic local D1 import preserves 5 source links, 7 roles and 4 independent Parties',async()=>{
  const input=source();const prior=structuredClone(input);
  const out=compile(input);
  assert.equal(out.plan.summary.proposedParties,4);
  assert.equal(out.plan.summary.legacyLinks,5);
  assert.equal(out.plan.summary.roleMemberships,7);
  assert.equal(out.plan.summary.pendingIdentityReviews,0);
  assert.equal(out.statements.length,16);
  assert.deepEqual(input,prior,'source input must remain unchanged');
  await DB.batch(out.statements);
  assert.deepEqual(await counts(),{
    parties:4,party_roles:7,party_legacy_links:5,party_identity_review:0
  });
  const approved=await DB.prepare(`SELECT source_group,source_id,party_id,link_basis,
    reviewed_by,reviewed_at,legacy_sheet_row,status
    FROM party_legacy_links WHERE source_group IN ('CUSTOMERS','SUPPLIERS')
    ORDER BY source_group`).all();
  assert.deepEqual(approved.results.map(x=>x.source_id),['CUS-001','SUP-001']);
  assert.equal(approved.results[0].party_id,approved.results[1].party_id);
  assert.equal(approved.results[0].link_basis,'ORIGINAL_RECORD');
  assert.equal(approved.results[1].link_basis,'HUMAN_VERIFIED');
  assert.equal(approved.results[1].reviewed_by,'admin-01');
  assert.equal(approved.results[1].reviewed_at,'2026-11-14T12:00:00Z');
  assert.equal(approved.results[0].legacy_sheet_row,2);
  assert.equal(approved.results[1].legacy_sheet_row,2);
  const finance=await DB.prepare(`SELECT role FROM party_roles WHERE party_id=(
    SELECT party_id FROM party_legacy_links WHERE source_group='FINANCE_PERSONS' AND source_id='FIN-001'
  ) ORDER BY role`).all();
  assert.deepEqual(finance.results.map(x=>x.role),['Borrower','Lender','Owner']);
  const payee=await DB.prepare(`SELECT status FROM party_roles WHERE party_id=(
    SELECT party_id FROM party_legacy_links WHERE source_group='EXPENSE_PAYEES' AND source_id='PAY-001'
  ) AND role='Payee'`).first();
  assert.equal(payee.status,'INACTIVE');
});

test('repeating same frozen import rejects replay without duplicating any identity, role or link',async()=>{
  const before=await counts();
  await assert.rejects(()=>DB.batch(compile().statements),/unique|constraint|primary key/i);
  assert.deepEqual(await counts(),before);
  const row=await DB.prepare(`SELECT COUNT(*) AS n FROM party_legacy_links
    WHERE source_group='CUSTOMERS' AND source_id='CUS-001'`).first();
  assert.equal(row.n,1);
});

test('failed second D1 write atomically rolls back a new Party and preserves imported snapshot',async()=>{
  const before=await counts();
  const ops=[
    DB.prepare(`INSERT INTO parties (party_id,display_name,created_at)
      VALUES ('PT-ROLLBACK-TEST','Synthetic New Party',?)`).bind(now),
    DB.prepare(`INSERT INTO party_legacy_links
      (party_id,source_group,source_id,link_basis,created_at)
      VALUES ('PT-ROLLBACK-TEST','CUSTOMERS','CUS-001','ORIGINAL_RECORD',?)`).bind(now)
  ];
  await assert.rejects(()=>DB.batch(ops),/unique|constraint/i);
  assert.deepEqual(await counts(),before);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM parties WHERE party_id='PT-ROLLBACK-TEST'").first().then(x=>x.n),0);
});

test('local rehearsal does not create accounts/cash/bank or expose RPC and test-only routes',async()=>{
  const tables=await DB.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('party_accounts','party_account_entries','journal_entries',
                 'party_settlements','cash_book','bank_book')`).all();
  assert.deepEqual(tables.results,[]);
  for(const pathname of ['/', '/api/rpc','/__m02_test__/import']){
    const response=await worker.fetch('http://synthetic.local'+pathname,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(response.status,404);
  }
});