import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import './m03-catalog-append-workerd.spec.mjs'; // Existing isolated catalog writer suite.
import './m03-catalog-update-workerd.spec.mjs'; // M03 guarded update with separate local D1 fixture.
import './m03-exactly-one-workerd.spec.mjs'; // Internal atomic write guard on synthetic local D1.

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

test('workerd applies actual M02 migrations to its isolated D1 binding',async()=>{
  const result=await db.prepare("SELECT (SELECT COUNT(*) FROM d1_migrations) AS applied_migrations, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('settings','product_categories','product_units','parties','party_roles','party_legacy_links','party_identity_review')) AS application_tables").first();
  assert.equal(result.applied_migrations,2);
  assert.equal(result.application_tables,7);
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
