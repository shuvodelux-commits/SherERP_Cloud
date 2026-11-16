import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {resolveLegacyPartyId} from '../../src/db/party-identity-read.js';
import {
  projectExpensePayeeViews
} from '../../src/modules/expense-payee-source-projection.js';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m02-party-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m02-party-workerd-local-test');
const now='2026-11-16T00:00:00Z';
const source=()=>[
  {'Payee ID':'PAY-SAME-1','Payee Name':'একই দোকান','Phone':'01700000000',
   Notes:'',Status:'Active','Created At':now,'Is Deleted':'',
   'Deleted By':'','Deleted At':'','Delete Reason':'',_rowIndex:2},
  {'Payee ID':'PAY-SAME-2','Payee Name':'একই দোকান','Phone':'01700000000',
   Notes:'',Status:'Inactive','Created At':now,'Is Deleted':'',
   'Deleted By':'','Deleted At':'','Delete Reason':'',_rowIndex:3},
  {'Payee ID':'PAY-SAME-3','Payee Name':'একই দোকান','Phone':'01700000000',
   Notes:'',Status:'Active','Created At':now,'Is Deleted':'TRUE',
   'Deleted By':'Reviewer','Deleted At':now,'Delete Reason':'Test deletion',_rowIndex:4}
];
let DB;
const count=async(table)=> (await DB.prepare(
  'SELECT COUNT(*) AS n FROM '+table
).first()).n;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  for(const id of ['PT-EX-A','PT-EX-B']){
    await DB.prepare('INSERT INTO parties(party_id,display_name,phone,created_at) VALUES(?,?,?,?)')
      .bind(id,'একই দোকান','01700000000',now).run();
    await DB.prepare("INSERT INTO party_roles(party_id,role,created_at) VALUES(?,'Payee',?)")
      .bind(id,now).run();
  }
  for(const [id,party,row] of [
    ['PAY-SAME-1','PT-EX-A',2],['PAY-SAME-2','PT-EX-B',3]
  ])await DB.prepare(
    'INSERT INTO party_legacy_links(source_group,source_id,legacy_sheet_row,party_id,link_basis,created_at) VALUES(?,?,?,?,?,?)'
  ).bind('EXPENSE_PAYEES',id,row,party,'ORIGINAL_RECORD',now).run();
});
after(async()=>{await harness.close();});

test('real local D1 resolves Payee by exact source ID, never by same Bangla name or phone',async()=>{
  const output=projectExpensePayeeViews(source());
  assert.deepEqual(output.allRows.map(x=>x['Payee ID']),
    ['PAY-SAME-1','PAY-SAME-2','PAY-SAME-3']);
  assert.equal(await resolveLegacyPartyId({DB},'EXPENSE_PAYEES','PAY-SAME-1'),'PT-EX-A');
  assert.equal(await resolveLegacyPartyId({DB},'EXPENSE_PAYEES','PAY-SAME-2'),'PT-EX-B');
  assert.equal(await resolveLegacyPartyId({DB},'EXPENSE_PAYEES','PAY-SAME-3'),null);
  assert.equal(await resolveLegacyPartyId({DB},'CUSTOMERS','PAY-SAME-1'),null);
  const grouped=await DB.prepare('SELECT party_id,source_id FROM party_legacy_links WHERE source_group=? ORDER BY source_id')
    .bind('EXPENSE_PAYEES').all();
  assert.deepEqual(grouped.results,[
    {party_id:'PT-EX-A',source_id:'PAY-SAME-1'},
    {party_id:'PT-EX-B',source_id:'PAY-SAME-2'}
  ]);
  assert.deepEqual(output.activeUiPayees,[
    {id:'PAY-SAME-1',name:'একই দোকান',phone:'01700000000'}
  ]);
  assert.equal(output.managementPayees.length,2,
    'deleted payee hidden but inactive payee remains in management');
});

test('source-only view projection never adds Party rows, roles, links, or money/expense records',async()=>{
  const before={
    parties:await count('parties'),
    roles:await count('party_roles'),
    links:await count('party_legacy_links'),
    reviews:await count('party_identity_review')
  };
  for(let i=0;i<3;i++)projectExpensePayeeViews(source());
  const after={
    parties:await count('parties'),
    roles:await count('party_roles'),
    links:await count('party_legacy_links'),
    reviews:await count('party_identity_review')
  };
  assert.deepEqual(after,before);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='expense_payees'").first()).n,0,
    'a full D1 Payee master migration is NOT included in this PR');
});

test('real D1 forbids cross-source Payee auto-merge and unreviewed Party reassignment',async()=>{
  await assert.rejects(()=>DB.prepare(
    'INSERT INTO party_legacy_links(source_group,source_id,party_id,link_basis,created_at) VALUES(?,?,?,?,?)'
  ).bind('CUSTOMERS','CUS-SAME','PT-EX-A','ORIGINAL_RECORD',now).run(),/review|verif/i);
  await assert.rejects(()=>DB.prepare(
    "UPDATE party_legacy_links SET party_id='PT-EX-B' WHERE source_group='EXPENSE_PAYEES' AND source_id='PAY-SAME-1'"
  ).run(),/immutable/i);
  assert.equal(await resolveLegacyPartyId({DB},'EXPENSE_PAYEES','PAY-SAME-1'),'PT-EX-A');
});

test('test Worker has no public RPC/Payee import endpoint or production DB binding',async()=>{
  for(const path of ['/api/rpc','/api/health','/__m03_test__/expense-payee-import']){
    const r=await worker.fetch('http://local-only.test'+path,{method:'POST'});
    assert.equal(r.status,404);
  }
  const cfg=JSON.parse(readFileSync(
    new URL('../../wrangler.m02-party-test.jsonc',import.meta.url),'utf8'));
  const preview=JSON.parse(readFileSync(
    new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(preview.d1_databases,undefined);
  assert.equal(readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')
    .includes('expense-payee-source-projection'),false);
});
