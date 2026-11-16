import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';

// This suite uses only a dedicated nondeployable Worker + ephemeral LOCAL D1.
// It does not import/modify the actual deployed Worker or any remote D1.
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-party-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-party-workerd-local-test');
let DB;
const now='2026-11-15T00:00:00Z';
const addParty=(id,name='Synthetic Shared Name',phone='01700000000')=>DB.prepare(
  'INSERT INTO parties(party_id,display_name,phone,created_at) VALUES(?,?,?,?)'
).bind(id,name,phone,now).run();
const addRole=(party,role,status='ACTIVE')=>DB.prepare(
  'INSERT INTO party_roles(party_id,role,status,created_at) VALUES(?,?,?,?)'
).bind(party,role,status,now).run();
const addLink=(party,group,id,basis='ORIGINAL_RECORD',reviewer=null,reviewTime=null,row=null)=>
  DB.prepare(`INSERT INTO party_legacy_links
    (party_id,source_group,source_id,link_basis,reviewed_by,reviewed_at,legacy_sheet_row,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).bind(party,group,id,basis,reviewer,reviewTime,row,now).run();
const count=(table)=>DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first().then(x=>x.n);

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
after(async()=>{await harness.close();});

test('twelve versioned migrations retain the initial seven identity/catalog tables on real workerd D1',async()=>{
  const rows=await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('settings','product_categories','product_units','parties','party_roles','party_legacy_links','party_identity_review') ORDER BY name").all();
  assert.deepEqual(rows.results.map(x=>x.name),[
    'parties','party_identity_review','party_legacy_links','party_roles','product_categories','product_units','settings'
  ]);
  const n=await DB.prepare('SELECT COUNT(*) AS n FROM d1_migrations').first();
  assert.equal(n.n,12);
  const triggers=await DB.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_party_%' ORDER BY name").all();
  assert.deepEqual(triggers.results.map(x=>x.name),[
    'trg_party_cross_source_verification','trg_party_legacy_identity_immutable',
    'trg_party_legacy_link_delete_forbidden','trg_party_role_delete_forbidden'
  ]);
  const forbidden=await DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('party_accounts','party_account_entries','party_settlements','journal_entries','journal_lines')").all();
  assert.equal(forbidden.results.length,0);
});

test('same name/phone remain separate Party identities; name/phone do not establish a merge',async()=>{
  await addParty('PT-M02-A');
  await addParty('PT-M02-B');
  const result=await DB.prepare('SELECT party_id FROM parties WHERE phone=? ORDER BY party_id').bind('01700000000').all();
  assert.deepEqual(result.results.map(x=>x.party_id),['PT-M02-A','PT-M02-B']);
  await assert.rejects(()=>addParty('PT-M02-A','Different'),/unique|constraint/i);
});

test('seven descriptive roles coexist but staff role, duplicates and orphan references are forbidden',async()=>{
  for(const role of ['Customer','Supplier','Vendor','Owner','Lender','Borrower','Payee'])
    await addRole('PT-M02-A',role);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM party_roles WHERE party_id=?').bind('PT-M02-A').first()).n,7);
  await assert.rejects(()=>addRole('PT-M02-A','Administrator'),/check|constraint/i);
  await assert.rejects(()=>addRole('PT-M02-A','Customer'),/unique|constraint/i);
  await assert.rejects(()=>addRole('PT-UNKNOWN','Customer'),/foreign|constraint/i);
  await DB.prepare("UPDATE party_roles SET status='INACTIVE' WHERE party_id='PT-M02-A' AND role='Supplier'").run();
  await assert.rejects(()=>DB.prepare("DELETE FROM party_roles WHERE party_id='PT-M02-A' AND role='Supplier'").run(),/historical|delete/i);
});

test('second source to same Party requires explicit human-verification evidence',async()=>{
  await addLink('PT-M02-A','CUSTOMERS','CUS-A','ORIGINAL_RECORD',null,null,2);
  await addLink('PT-M02-B','CUSTOMERS','CUS-B','ORIGINAL_RECORD',null,null,3);
  await assert.rejects(()=>addLink('PT-M02-A','SUPPLIERS','SUP-A'),/review|verif/i);
  await assert.rejects(()=>addLink('PT-M02-A','SUPPLIERS','SUP-A','HUMAN_VERIFIED'),/check|constraint/i);
  await addLink('PT-M02-A','SUPPLIERS','SUP-A','HUMAN_VERIFIED','synthetic-reviewer',now,2);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM party_legacy_links WHERE party_id=?').bind('PT-M02-A').first()).n,2);
  await assert.rejects(()=>addLink('PT-M02-B','SUPPLIERS','SUP-A','HUMAN_VERIFIED','reviewer-2',now,5),/unique|constraint/i);
});

test('legacy group/ID/source row are immutable; historical provenance cannot be deleted',async()=>{
  await assert.rejects(()=>DB.prepare("UPDATE party_legacy_links SET source_id='CUS-REWRITTEN' WHERE source_group='CUSTOMERS' AND source_id='CUS-A'").run(),/immutable/i);
  await assert.rejects(()=>DB.prepare("UPDATE party_legacy_links SET source_group='VENDORS' WHERE source_group='CUSTOMERS' AND source_id='CUS-A'").run(),/immutable/i);
  await assert.rejects(()=>DB.prepare("UPDATE party_legacy_links SET party_id='PT-M02-B' WHERE source_group='CUSTOMERS' AND source_id='CUS-A'").run(),/immutable/i);
  await assert.rejects(()=>DB.prepare("DELETE FROM party_legacy_links WHERE source_group='CUSTOMERS' AND source_id='CUS-A'").run(),/historical|delete/i);
  await assert.rejects(()=>DB.prepare("DELETE FROM parties WHERE party_id='PT-M02-A'").run(),/foreign|constraint/i);
  await assert.rejects(()=>addLink('PT-M02-B','CUSTOMERS','CUS-C','ORIGINAL_RECORD',null,null,2),/unique|constraint/i);
  assert.equal((await DB.prepare("SELECT source_id FROM party_legacy_links WHERE party_id='PT-M02-A' AND source_group='CUSTOMERS'").first()).source_id,'CUS-A');
});

test('ambiguous review queue never adds a link or automatically confirms without reviewer',async()=>{
  const before=await count('party_legacy_links');
  await DB.prepare(`INSERT INTO party_identity_review
     (review_id,source_group,reason,status,created_at,candidate_party_id)
     VALUES (?,?,?,?,?,?)`)
    .bind('REV-M02','CUSTOMERS','MISSING_ID','OPEN',now,'PT-M02-A').run();
  assert.equal(await count('party_legacy_links'),before);
  await assert.rejects(()=>DB.prepare("UPDATE party_identity_review SET status='CONFIRMED' WHERE review_id='REV-M02'").run(),/check|constraint/i);
  await DB.prepare("UPDATE party_identity_review SET status='CONFIRMED',reviewer_id='reviewer-1',reviewed_at=? WHERE review_id='REV-M02'").bind(now).run();
  assert.equal(await count('party_legacy_links'),before);
});

test('actual D1 batch is atomic: invalid provenance rolls back a prior valid insert',async()=>{
  await addParty('PT-M02-BATCH');
  const before=await count('party_legacy_links');
  const batch=[
    DB.prepare(`INSERT INTO party_legacy_links
      (party_id,source_group,source_id,link_basis,legacy_sheet_row,created_at)
      VALUES('PT-M02-BATCH','VENDORS','VEN-BATCH-OK','ORIGINAL_RECORD',2,?)`).bind(now),
    DB.prepare(`INSERT INTO party_legacy_links
      (party_id,source_group,source_id,link_basis,reviewed_by,reviewed_at,legacy_sheet_row,created_at)
      VALUES('PT-M02-BATCH','CUSTOMERS','CUS-A','HUMAN_VERIFIED',?,?,4,?)`).bind('synthetic-reviewer',now,now)
  ];
  await assert.rejects(()=>DB.batch(batch),/unique|constraint/i);
  assert.equal(await count('party_legacy_links'),before);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM party_legacy_links WHERE source_id='VEN-BATCH-OK'").first().then(x=>x.n),0);
});

test('two concurrent attempts to claim the same original source ID permit exactly one winner',async()=>{
  await addParty('PT-M02-C');
  await addParty('PT-M02-D');
  const results=await Promise.allSettled([
    addLink('PT-M02-C','VENDORS','VEN-RACE','ORIGINAL_RECORD',null,null,3),
    addLink('PT-M02-D','VENDORS','VEN-RACE','ORIGINAL_RECORD',null,null,4)
  ]);
  assert.deepEqual(results.map(x=>x.status).sort(),['fulfilled','rejected']);
  const row=await DB.prepare("SELECT party_id FROM party_legacy_links WHERE source_group='VENDORS' AND source_id='VEN-RACE'").first();
  assert.ok(['PT-M02-C','PT-M02-D'].includes(row.party_id));
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM party_legacy_links WHERE source_group='VENDORS' AND source_id='VEN-RACE'").first()).n,1);
});

test('test-only Worker exposes no RPC, no staging routes, and no D1 methods',async()=>{
  const response=await worker.fetch('http://local-only.test/api/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,404);
  assert.equal((await worker.fetch('http://local-only.test/')).status,404);
});

test('expense master category schema enforces stable source identity on real local Workerd/D1',async()=>{
  const names=await DB.prepare("PRAGMA table_info('expense_categories')").all();
  assert.deepEqual(names.results.map(x=>x.name),[
    'row_id','legacy_sheet_row','category_id','category_name','description','status','created_at'
  ]);
  const sql='INSERT INTO expense_categories (legacy_sheet_row,category_id,category_name,description,status,created_at) VALUES(?,?,?,?,?,?)';
  await DB.prepare(sql).bind(2,'EXP-D1-001','দোকান ভাড়া','মাসিক','Active','').run();
  const row=await DB.prepare('SELECT category_name,description,status FROM expense_categories WHERE category_id=?').bind('EXP-D1-001').first();
  assert.deepEqual(row,{category_name:'দোকান ভাড়া',description:'মাসিক',status:'Active'});
  await assert.rejects(()=>DB.prepare(sql).bind(3,'EXP-D1-001','Other','','Active','').run(),/unique|constraint/i);
  await assert.rejects(()=>DB.prepare(sql).bind(2,'EXP-D1-002','Other','','Active','').run(),/unique|constraint/i);
  await assert.rejects(()=>DB.prepare(sql).bind(4,'EXP-D1-002','Other','','Deleted','').run(),/check|constraint/i);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM expense_categories').first()).n,1);
});
