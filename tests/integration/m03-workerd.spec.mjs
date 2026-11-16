import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import './m04-auth-http-workerd.spec.mjs'; // M04 server-opt-in original RPC envelope against actual isolated D1.
import './m03-settings-workerd.spec.mjs'; // M03 Settings Key/Value and restricted shell projection; local D1 only.
import './m03-m04-settings-workerd.spec.mjs'; // M04 D1 sessions authorize source-shaped Settings CAS inside one SQL mutation.
import './m03-m04-settings-view-workerd.spec.mjs'; // M04 session + settings.view authorized safe shell reads; actual isolated D1.
import './m04-reports-bootstrap-workerd.spec.mjs'; // M04 session + reports.view one-statement bootstrap, local D1 only.
import './m04-atomic-authority-workerd.spec.mjs'; // M04 synthetic same-statement session/RBAC authority; local D1 only.
import './m04-session-workerd.spec.mjs'; // M04 test-only source-shaped session authority via real local D1.
import './m03-transaction-contract-workerd.spec.mjs'; // Separate synthetic atomic/idempotency D1 contract; local-only.
import './m03-intent-fingerprint-workerd.spec.mjs'; // Canonical SHA-256 intent and synthetic D1 replay proof.
import './m03-receipt-workerd.spec.mjs'; // Read-only immutable receipt reconciliation against synthetic local D1.
import './m03-reversal-workerd.spec.mjs'; // Source-guarded exactly-once synthetic reversal in local D1.
import './m03-authorized-receipt-workerd.spec.mjs'; // Session-derived actor and tenant-scoped receipt readback.
import './m03-m04-receipt-workerd.spec.mjs'; // Actual proposed M04 session schema + single-business immutable receipt readback.
import './m03-authorized-post-workerd.spec.mjs'; // Synthetic M04 authority checked inside atomic D1 receipt/post claim.
import './m03-catalog-append-workerd.spec.mjs'; // Existing isolated catalog writer suite.
import './m02-product-unit-import-workerd.spec.mjs'; // M02 frozen Product Units source import / real D1 rollback, local-only.
import './m02-product-category-import-workerd.spec.mjs'; // M02 frozen Product Categories source import / real D1 rollback, local-only.
import './m03-catalog-update-workerd.spec.mjs'; // M03 guarded update with separate local D1 fixture.
import './m03-product-status-workerd.spec.mjs'; // M03 frozen ProductSettings status orchestration, fixed local D1 only.
import './m03-master-atomic-workerd.spec.mjs'; // M03 source PCAT/PUNT, one-statement local D1 creation receipt/cleanup proof.
import './m03-m04-authorized-master-workerd.spec.mjs'; // Current M04 products.add session in the same atomic local D1 master INSERT.
import './m03-catalog-tail-delete-workerd.spec.mjs'; // Tail-only guarded deletes, isolated D1.
import './m03-exactly-one-workerd.spec.mjs'; // Internal atomic write guard on synthetic local D1.
import './m03-id-issuer-workerd.spec.mjs'; // M03 source IDs: isolated D1 receipt+counter trigger, replay and concurrency.
import './m03-id-post-workerd.spec.mjs'; // M03 source INV ID + synthetic stock/journal in same D1 trigger transaction.
import './m05-purchase-posting-workerd.spec.mjs'; // M05 test-only atomic supplier purchase posting; local D1 only.
import './m06-sale-posting-workerd.spec.mjs'; // M06 isolated synthetic sale/tender/Customer due atomic D1 proof.
import './m07-cash-return-workerd.spec.mjs'; // M07 single-invoice Cash return exact-once/rollback proof on M06 source.
import './m07-cash-delete-workerd.spec.mjs'; // M07 test-only original Cash Return deletion, exact-once stock/Cash undo with audit.
import './m07-store-credit-workerd.spec.mjs'; // M07 signed Customer credit with no Cash/Bank and cross-method replay guard.
import './m07-credit-delete-workerd.spec.mjs'; // M07 test-only source-bound signed Customer Store Credit reversal and audit.
import './m07-cash-batch-workerd.spec.mjs'; // M07 2–20 original-invoice Cash batch all-or-nothing local D1.
import './m07-store-credit-batch-workerd.spec.mjs'; // M07 ordered signed Store Credit batch exact-once/rollback local D1.
import './m07-purchase-cash-return-workerd.spec.mjs'; // M07 source-linked purchase Cash refund original-lot local D1 proof.
import './m07-purchase-cash-delete-workerd.spec.mjs'; // M07 source-specific Purchase Cash Return reversal, local D1 only.
import './m07-purchase-supplier-credit-workerd.spec.mjs'; // M07 signed Supplier Credit original-lot D1 ledger/reversal proof.
import './m07-purchase-credit-delete-workerd.spec.mjs'; // M07 Supplier Credit Purchase Return source-bound deletion, local D1 only.
import './m07-return-edit-read-workerd.spec.mjs'; // M07 source-shaped getReturnForEdit read-only, local D1.
import './m07-cash-price-edit-workerd.spec.mjs'; // M07 price-only Cash Return correction / local D1 audit, no RPC.
import './m07-purchase-multilot-cash-workerd.spec.mjs'; // M07-B4A isolated multi-lot Cash receipt real Workerd/D1 atomic proof.
import './m08-reconciliation-atomic-workerd.spec.mjs'; // M08 single closing-entry atomicity, local D1 only; no public writer.

import './m03-delete-log-audit-read-workerd.spec.mjs'; // M03 private frozen DELETE_LOG M02 import-to-read Workerd/D1 parity.
// Separate, nondeployable, local-only Worker with synthetic D1 binding UUID.
// The actual deployed src/index.js and wrangler.preview.jsonc are untouched.
const server=createTestHarness({workers:[{configPath:'./wrangler.m03-test.jsonc'}]});
const worker=server.getWorker('shererp-m03-workerd-test');
let db;

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB:db}=await worker.getEnv());
  await db.prepare('INSERT INTO product_categories (category_id,category_name,status,legacy_sheet_row) VALUES (?,?,?,?)')
    .bind('CAT-1','Electrical','Active',2).run();
  await db.prepare('INSERT INTO product_categories (category_id,category_name,status,legacy_sheet_row) VALUES (?,?,?,?)')
    .bind('CAT-2','দড়ি','Inactive',3).run();
  await db.prepare('INSERT INTO product_units (unit_id,unit_name,status,legacy_sheet_row) VALUES (?,?,?,?)')
    .bind('UNIT-1','Pcs','Active',2).run();
  await db.prepare('INSERT INTO product_units (unit_id,unit_name,status,legacy_sheet_row) VALUES (?,?,?,?)')
    .bind('UNIT-2','Feet','Active',3).run();
  await db.prepare('INSERT INTO parties (party_id,display_name,created_at) VALUES (?,?,?)')
    .bind('PARTY-1','Rahim','2026-11-15T00:00:00Z').run();
  await db.prepare('INSERT INTO parties (party_id,display_name,created_at) VALUES (?,?,?)')
    .bind('PARTY-2','Rahim','2026-11-15T00:00:00Z').run();
  await db.prepare('INSERT INTO party_legacy_links (source_group,source_id,party_id,link_basis,created_at) VALUES (?,?,?,?,?)')
    .bind('CUSTOMERS','CUS-1','PARTY-1','ORIGINAL_RECORD','2026-11-15T00:00:00Z').run();
  await db.prepare('INSERT INTO party_legacy_links (source_group,source_id,party_id,link_basis,created_at) VALUES (?,?,?,?,?)')
    .bind('CUSTOMERS','CUS-2','PARTY-2','ORIGINAL_RECORD','2026-11-15T00:00:00Z').run();
  await db.prepare('INSERT INTO party_legacy_links (source_group,source_id,party_id,link_basis,reviewed_by,reviewed_at,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind('SUPPLIERS','SUP-1','PARTY-1','HUMAN_VERIFIED','reviewer-1','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z').run();
});

after(async()=>{await server.close();});

async function query(path){
  const response=await worker.fetch('http://m03.local'+path);
  return {status:response.status,body:await response.json()};
}

test('workerd applies all twelve M02/core migrations including isolated expense, LOGS, DELETE_LOG, SALES_DRAFT_AUDIT, INVOICE_EDIT_LOG, OPENING_BALANCE_EDIT_LOG and STOCK_LOT_COST_CORRECTIONS histories',async()=>{
  const result=await db.prepare("SELECT (SELECT COUNT(*) FROM d1_migrations) AS applied_migrations, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('settings','product_categories','product_units','expense_categories','legacy_error_logs','legacy_delete_log','legacy_sales_draft_audit','legacy_invoice_edit_audit','legacy_opening_balance_edit_audit','legacy_stock_lot_cost_corrections','legacy_product_snapshots','legacy_product_unit_conversion_snapshots','parties','party_roles','party_legacy_links','party_identity_review')) AS application_tables").first();
  assert.equal(result.applied_migrations,12);
  assert.equal(result.application_tables,16);
});

test('Cloudflare Worker runtime executes the real catalog adapter via local D1',async()=>{
  assert.deepEqual(await query('/__m03_test__/categories?limit=1'),{status:200,body:{rows:[
    {category_id:'CAT-1',category_name:'Electrical',status:'Active'}
  ]}});
  assert.deepEqual(await query('/__m03_test__/categories'),{status:200,body:{rows:[
    {category_id:'CAT-1',category_name:'Electrical',status:'Active'},
    {category_id:'CAT-2',category_name:'দড়ি',status:'Inactive'}
  ]}});
  assert.deepEqual(await query('/__m03_test__/units'),{status:200,body:{rows:[
    {unit_id:'UNIT-1',unit_name:'Pcs',status:'Active'},
    {unit_id:'UNIT-2',unit_name:'Feet',status:'Active'}
  ]}});
});

test('exact Party links retain separate identities and require human-verified second source',async()=>{
  assert.deepEqual(await query('/__m03_test__/party-id?source=CUSTOMERS&id=CUS-1'),{status:200,body:{partyId:'PARTY-1'}});
  assert.deepEqual(await query('/__m03_test__/party-id?source=CUSTOMERS&id=CUS-2'),{status:200,body:{partyId:'PARTY-2'}});
  assert.deepEqual(await query('/__m03_test__/party-id?source=SUPPLIERS&id=SUP-1'),{status:200,body:{partyId:'PARTY-1'}});
  assert.deepEqual(await query('/__m03_test__/party-id?source=VENDORS&id=SUP-1'),{status:200,body:{partyId:null}});
  assert.deepEqual(await query('/__m03_test__/party-id?source=CUSTOMERS&id=CUS-3'),{status:200,body:{partyId:null}});
});

test('invalid requests fail closed without leaking data, and test routes never write',async()=>{
  assert.equal((await query('/__m03_test__/categories?limit=0')).status,400);
  assert.equal((await query('/__m03_test__/categories?limit=101')).status,400);
  assert.equal((await query('/__m03_test__/categories?limit=1%3BDROP')).status,400);
  assert.equal((await query('/__m03_test__/party-id?source=UNKNOWN&id=CUS-1')).status,400);
  assert.equal((await query('/__m03_test__/settings')).status,404);
  const response=await worker.fetch('http://m03.local/__m03_test__/categories',{method:'POST'});
  assert.equal(response.status,405);
  const counts=await db.prepare('SELECT (SELECT COUNT(*) FROM product_categories) AS categories, (SELECT COUNT(*) FROM parties) AS parties').first();
  assert.deepEqual(counts,{categories:2,parties:2});
});

test('source-shaped catalog reads execute via real local D1 and preserve physical sheet row indexes',async()=>{
  assert.deepEqual(await query('/__m03_test__/legacy-rows?sheet=PRODUCT_CATEGORIES'),{status:200,body:{rows:[
    {'Category ID':'CAT-1','Category Name':'Electrical',Status:'Active','Created At':'',_rowIndex:2},
    {'Category ID':'CAT-2','Category Name':'দড়ি',Status:'Inactive','Created At':'',_rowIndex:3}
  ]}});
  assert.deepEqual(await query('/__m03_test__/legacy-rows?sheet=PRODUCT_UNITS'),{status:200,body:{rows:[
    {'Unit ID':'UNIT-1','Unit Name':'Pcs',Status:'Active','Created At':'',_rowIndex:2},
    {'Unit ID':'UNIT-2','Unit Name':'Feet',Status:'Active','Created At':'',_rowIndex:3}
  ]}});
  assert.deepEqual(await query('/__m03_test__/legacy-find?sheet=PRODUCT_CATEGORIES&column=Category%20ID&value=CAT-2'),{
    status:200,body:{match:{row:{'Category ID':'CAT-2','Category Name':'দড়ি',Status:'Inactive','Created At':'',_rowIndex:3},rowIndex:3}}
  });
});

test('Products bootstrap reference slice awaits actual D1 catalogs and Settings with source defaults',async()=>{
  const before=await db.prepare("SELECT (SELECT COUNT(*) FROM product_categories) AS categories, (SELECT COUNT(*) FROM product_units) AS units, (SELECT COUNT(*) FROM settings) AS settings").first();
  const result=await query('/__m03_test__/product-bootstrap-references');
  assert.deepEqual(result,{
    status:200,
    body:{
      categories:[{id:'CAT-1',name:'Electrical'}],
      units:[{id:'UNIT-1',name:'Pcs'},{id:'UNIT-2',name:'Feet'}],
      currencySymbol:'',
      lowStockThreshold:5
    }
  });
  const after=await db.prepare("SELECT (SELECT COUNT(*) FROM product_categories) AS categories, (SELECT COUNT(*) FROM product_units) AS units, (SELECT COUNT(*) FROM settings) AS settings").first();
  assert.deepEqual(after,before);
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('product-bootstrap-references'),false);
});

test('original ProductSettings creation preflight runs against real local D1 without mutating master rows',async()=>{
  const before=await db.prepare(
    'SELECT (SELECT COUNT(*) FROM product_categories) AS categories, '+
    '(SELECT COUNT(*) FROM product_units) AS units, '+
    '(SELECT COUNT(*) FROM settings) AS settings'
  ).first();
  assert.deepEqual(await query('/__m03_test__/category-create-preflight'),{
    status:200,
    body:{
      canCreate:true,name:'দড়ি',cleanup:[
        {sourceId:'CAT-2',rowIndex:3,name:'দড়ি',status:'Inactive'}
      ]
    }
  });
  assert.deepEqual(await query('/__m03_test__/unit-create-preflight'),{
    status:200,
    body:{
      canCreate:false,message:'A unit with this name already exists.',
      name:'pCs',cleanup:[]
    }
  });
  assert.deepEqual(await query('/__m03_test__/new-category-create-preflight'),{
    status:200,body:{canCreate:true,name:'New Electric',cleanup:[]}
  });
  assert.deepEqual(await query(
    '/__m03_test__/category-create-preflight?name=SHOULD-BE-IGNORED&sheet=SETTINGS'
  ),{
    status:200,body:{
      canCreate:true,name:'দড়ি',cleanup:[
        {sourceId:'CAT-2',rowIndex:3,name:'দড়ি',status:'Inactive'}
      ]
    }
  });
  assert.deepEqual(await db.prepare(
    'SELECT (SELECT COUNT(*) FROM product_categories) AS categories, '+
    '(SELECT COUNT(*) FROM product_units) AS units, '+
    '(SELECT COUNT(*) FROM settings) AS settings'
  ).first(),before);
  const stillThere=await db.prepare(
    "SELECT category_name,status,legacy_sheet_row FROM product_categories WHERE category_id='CAT-2'"
  ).first();
  assert.deepEqual({...stillThere},{category_name:'দড়ি',status:'Inactive',legacy_sheet_row:3});
  const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('category-create-preflight'),false);
});

test('source-shaped test routes refuse Settings, other sheets and arbitrary columns without writes',async()=>{
  for(const key of ['SETTINGS','SALES','CUSTOMERS',"PRODUCT_CATEGORIES;DROP TABLE parties"]){
    assert.equal((await query('/__m03_test__/legacy-rows?sheet='+encodeURIComponent(key))).status,400);
  }
  assert.equal((await query('/__m03_test__/legacy-find?sheet=PRODUCT_CATEGORIES&column=Unsafe&value=x')).status,400);
  const count=await db.prepare('SELECT COUNT(*) AS n FROM product_categories').first();
  assert.equal(count.n,2);
});

test('product dropdown projection awaits actual Worker D1 and leaves catalog records untouched',async()=>{
  const before=await db.prepare('SELECT (SELECT COUNT(*) FROM product_categories) AS categories, (SELECT COUNT(*) FROM product_units) AS units').first();
  assert.deepEqual(await query('/__m03_test__/product-master-options'),{
    status:200,
    body:{
      categories:[{id:'CAT-1',name:'Electrical'}],
      units:[{id:'UNIT-1',name:'Pcs'},{id:'UNIT-2',name:'Feet'}]
    }
  });
  const after=await db.prepare('SELECT (SELECT COUNT(*) FROM product_categories) AS categories, (SELECT COUNT(*) FROM product_units) AS units').first();
  assert.deepEqual(after,before);
});


test('M09 Reports bootstrap derives safe source-shaped projection through actual Workerd/D1 Settings',async()=>{
  // This endpoint exists ONLY in wrangler.m03-test.jsonc; not in the live Worker.
  const before=await db.prepare('SELECT COUNT(*) AS n FROM settings').first();
  try{
    await db.prepare('INSERT INTO settings(key,value) VALUES (?,?)')
      .bind('Shop Name','মেসার্স হার্ডওয়্যার').run();
    await db.prepare('INSERT INTO settings(key,value) VALUES (?,?)')
      .bind('Currency Symbol','৳').run();
    await db.prepare('INSERT INTO settings(key,value) VALUES (?,?)')
      .bind('JWT_SECRET','PRIVATE-REPORT-CANARY').run();
    const result=await query('/__m03_test__/reports-bootstrap?today=2020-01-01');
    assert.equal(result.status,200);
    assert.deepEqual(Object.keys(result.body),[
      'reportTypes','currencySymbol','shopName','defaultFrom','defaultTo'
    ]);
    assert.equal(result.body.currencySymbol,'৳');
    assert.equal(result.body.shopName,'মেসার্স হার্ডওয়্যার');
    assert.equal(result.body.defaultFrom,'2026-11-01');
    assert.equal(result.body.defaultTo,'2026-11-15');
    assert.deepEqual(result.body.reportTypes.map(row=>row.key),[
      'sales','purchase','stock','cashbank','profit','balancesheet'
    ]);
    assert.doesNotMatch(JSON.stringify(result.body),/PRIVATE-REPORT-CANARY/);
    const during=await db.prepare('SELECT COUNT(*) AS n FROM settings').first();
    assert.equal(during.n,before.n+3);
    const live=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
      readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
    assert.equal(live.includes('/__m03_test__/reports-bootstrap'),false);
  }finally{
    await db.prepare("DELETE FROM settings WHERE key IN ('Shop Name','Currency Symbol','JWT_SECRET')").run();
    const after=await db.prepare('SELECT COUNT(*) AS n FROM settings').first();
    assert.equal(after.n,before.n);
  }
});
