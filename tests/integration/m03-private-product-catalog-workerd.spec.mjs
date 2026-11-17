import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestHarness} from 'wrangler';
import {readProductCatalogCandidateD1} from '../../src/db/product-catalog-d1-read.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createM03AuthenticatedProductsBootstrap} from '../../src/db/m03-authenticated-products-bootstrap.js';
import {SYNTHETIC_M03_PRODUCTS_BOOTSTRAP_DDL} from '../fixtures/m03-products-bootstrap-tenant-schema.mjs';
import {formatM05ProductStockCell} from '../../src/modules/m05-product-form-stock-preview.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-product-catalog-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-product-catalog-local-only');
let DB;
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>harness.close());

test('real local D1 reads no unapproved product if candidate catalog empty',async()=>{
 assert.equal(await readProductCatalogCandidateD1({DB,productId:'P-UNKNOWN'}),null);
});
test('real local D1 preserves canonical snapshot identity and exact barcode/factor text',async()=>{
 await DB.prepare("INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id,unit_text,current_stock_text) VALUES('canonical',2,'P-0001','Gira','37.000')").run();
 await DB.prepare("INSERT INTO products(product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,product_name,base_unit_name,barcode_text,purchase_price_text,selling_price_text) VALUES('P-0001','canonical',1,2,'তার','Gira','00010','4.375','25.000')").run();
 let got=await readProductCatalogCandidateD1({DB,productId:'P-0001'});
 assert.equal(got.sourceProfile,'canonical');assert.equal(got.legacySheetRow,2);
 assert.equal(got.purchasePriceText,'4.375');assert.equal(got.barcodeText,'00010');
 assert.equal(got.unitConfig.revision,0);assert.deepEqual(got.unitConfig.conversions,[]);
 await DB.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,purchase_anchor_unit_name,selling_anchor_unit_name) VALUES('P-0001',1,'Gira','Gauge','Gira')").run();
 await DB.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text,purchase_price_override_text,selling_price_override_text,sort_order,status) VALUES('P-0001',1,'CG','Gauge','16.000','70.000','400.00',1,'Inactive')").run();
 await DB.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id='P-0001'").run();
 got=await readProductCatalogCandidateD1({DB,productId:'P-0001'});
 assert.equal(got.unitConfig.conversions[0].factorText,'16.000');
 assert.equal(got.unitConfig.conversions[0].purchasePriceOverrideText,'70.000');
 assert.equal(got.unitConfig.conversions[0].status,'Inactive');
 assert.equal(got.stockAuthority,'not-loaded');
 await assert.rejects(()=>readProductCatalogCandidateD1({DB,productId:'P-0001',revision:2}),/revision|NEEDS_REVIEW/);
});
test('read-only adapter writes nothing and test worker exposes no source data over HTTP',async()=>{
 const before=(await DB.prepare('SELECT COUNT(*) n FROM products').first()).n;
 const snapshot=(await DB.prepare('SELECT COUNT(*) n FROM legacy_product_snapshots').first()).n;
 await readProductCatalogCandidateD1({DB,productId:'P-0001',revision:1});
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM products').first()).n,before);
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM legacy_product_snapshots').first()).n,snapshot);
 for(const url of ['/api/rpc','/products','/api/products','/__m03_product_catalog__']){
  const res=await worker.fetch('https://fixture.local'+url,{method:'POST',body:'{}'});
  assert.equal(res.status,404);
 }
});


const N621=1_800_000_000_000;
const T621={A:'a'.repeat(64),B:'b'.repeat(64),DENY:'c'.repeat(64),
 REVOKED:'d'.repeat(64),INACTIVE:'e'.repeat(64),STRING:'f'.repeat(64),
 STALE:'0'.repeat(64),ADMIN:'1'.repeat(64)};
const h621=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const reject621=/M03 authenticated Products bootstrap rejected/;
let read621;
const insert621=async(sql,...params)=>{
 const result=await DB.prepare(sql).bind(...params).run();
 assert.equal(result.success,true);
};
async function seed621(){
 for(const ddl of SYNTHETIC_M03_PRODUCTS_BOOTSTRAP_DDL)
  assert.equal((await DB.prepare(ddl).run()).success,true);
 for(const [role,status,permissions] of [
  ['ViewA','Active',JSON.stringify({products:{view:true}})],
  ['ViewB','Active',JSON.stringify({products:{view:true}})],
  ['NoView','Active',JSON.stringify({products:{view:false}})],
  ['DisabledRole','Inactive',JSON.stringify({products:{view:true}})],
  ['StringView','Active',JSON.stringify({products:{view:'true'}})]
 ]){
  await insert621('INSERT INTO auth_roles(role_name,status,permissions_json) VALUES (?,?,?)',
   role,status,permissions);
 }
 const actors=[
  ['A','ViewA','BUS-A',T621.A],['B','ViewB','BUS-B',T621.B],
  ['DENY','NoView','BUS-A',T621.DENY],
  ['REVOKED','ViewA','BUS-A',T621.REVOKED],
  ['INACTIVE','DisabledRole','BUS-A',T621.INACTIVE],
  ['STRING','StringView','BUS-A',T621.STRING],
  ['STALE','ViewA','BUS-A',T621.STALE],
  ['ADMIN','Administrator','BUS-A',T621.ADMIN]
 ];
 let n=0;
 for(const [id,role,tenant,token] of actors){
  ++n;
  await insert621('INSERT INTO auth_users (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
   "VALUES (?,?,?,?, 'Active',?,?,210000)",
   'USR-P621-'+id,'Test '+id,'0171010'+String(n).padStart(4,'0'),
   role,'ab'.repeat(32),'cd'.repeat(24));
  await insert621('INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) '+
   'VALUES(?,?,1,?,1,?,?,?,?)',
   h621(token),'USR-P621-'+id,role==='Administrator'?null:id==='STALE'?0:1,
   N621-100000,N621-1000,N621+1000000,id==='REVOKED'?N621-10:null);
  await insert621('INSERT INTO synthetic_m03_session_tenants VALUES (?,?)',h621(token),tenant);
 }
 const units=[
  ['PUNT-000011','Pcs','BUS-A'],['PUNT-000012','Box','BUS-A'],
  ['PUNT-000013','Carton','BUS-A'],['PUNT-000014','Feet','BUS-A'],
  ['PUNT-000015','Set','BUS-A'],['PUNT-000016','Pcs','BUS-B']
 ];
 for(const [id,name,tenant] of units){
  await insert621('INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES(?,?,?,?)',
   id,name,'Active',100+units.findIndex(x=>x[0]===id));
  await insert621('INSERT INTO synthetic_m03_unit_tenants VALUES(?,?)',tenant,id);
 }
 const categories=[['PCAT-000020','Hardware','BUS-A'],['PCAT-000021','Other','BUS-B']];
 for(const [id,name,tenant] of categories){
  await insert621('INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES(?,?,?,?)',
   id,name,'Active',100+categories.findIndex(x=>x[0]===id));
  await insert621('INSERT INTO synthetic_m03_category_tenants VALUES(?,?)',tenant,id);
 }
 const products=[
  ['PRD-000010','Cable','Pcs','45','BUS-A','Standard','5','PUNT-000011',0],
  ['PRD-000011','Tile 24x24','Pcs','128','BUS-A','Standard','10','PUNT-000011',1],
  ['PRD-000012','Carton Item','Pcs','628','BUS-A','Standard','10','PUNT-000011',0],
  ['PRD-000013','Plain','Feet','12','BUS-A','Standard','3','PUNT-000014',0],
  ['PRD-000014','Bundle Kit','Set','0','BUS-A','Bundle','0','PUNT-000015',0],
  ['PRD-000015','Private Other Tenant','Pcs','7','BUS-B','Standard','3','PUNT-000016',0]
 ];
 for(const [id,name,unit,stock,tenant,type,cost,unitId,isTile] of products){
  const rowIndex=100+products.findIndex(x=>x[0]===id);
  await insert621('INSERT INTO legacy_product_snapshots(source_profile,legacy_sheet_row,product_id,unit_text,current_stock_text) VALUES (?,?,?,?,?)',
   'canonical',rowIndex,id,unit,stock);
  const archive=await DB.prepare('SELECT row_id FROM legacy_product_snapshots WHERE product_id=? AND source_profile=?').bind(id,'canonical').first();
  assert.ok(Number.isSafeInteger(archive?.row_id));
  await insert621('INSERT INTO products(product_id,source_profile,source_snapshot_row_id,legacy_sheet_row,product_name,category_name,base_unit_name,base_unit_id,purchase_price_text,selling_price_text,product_type_text,bundle_revision_text) '+
    'VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
   id,'canonical',archive.row_id,rowIndex,name,tenant==='BUS-A'?'Hardware':'Other',
   unit,unitId,cost,'20',type,type==='Bundle'?'1':'');
  await insert621('INSERT INTO synthetic_m03_product_tenants VALUES (?,?)',tenant,id);
  await insert621('INSERT INTO synthetic_m03_product_stock VALUES (?,?,?,?)',
   tenant,id,stock,isTile);
 }
 const profiles=[
  ['PRD-000010',2],['PRD-000011',3],['PRD-000012',2]
 ];
 for(const [id,revision] of profiles){
  await insert621('INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES(?,?,?)',
   id,revision,'Pcs');
 }
 const relations=[
  ['PRD-000010',2,'BOX-20','Box','PUNT-000012','20','20','Pcs',1],
  ['PRD-000011',3,'BOX-25','Box','PUNT-000012','25','25','Pcs',1],
  ['PRD-000012',2,'CARTON-250','Carton','PUNT-000013','250','10','Box',1],
  ['PRD-000012',2,'BOX-25','Box','PUNT-000012','25','25','Pcs',2]
 ];
 for(const [id,rev,cid,name,unitId,factor,qty,relative,order] of relations){
  await insert621('INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,reviewed_unit_master_id,factor_text,relation_qty_text,relation_unit_name,sort_order) VALUES(?,?,?,?,?,?,?,?,?)',
   id,rev,cid,name,unitId,factor,qty,relative,order);
 }
 for(const [id,rev] of profiles){
  await insert621('UPDATE products SET current_unit_revision=? WHERE product_id=?',rev,id);
 }
 const tileMeasurement={
  productId:'PRD-000011',revision:'5',baseUnit:'Pcs',
  boxConversionId:'BOX-25',boxUnitName:'Box',
  length:'24',width:'24',dimensionUnit:'in',piecesPerBox:'25',coveragePolicy:'nominal'
 };
 await insert621('INSERT INTO synthetic_m03_tile_current VALUES(?,?,?,?,?)',
  'BUS-A','PRD-000011',3,5,JSON.stringify(tileMeasurement));
 await insert621('INSERT INTO synthetic_m03_bundle_components VALUES (?,?,?,?,?,?,?)',
  'BUS-A','PRD-000014','PRD-000010','5','Pcs',1,'Active');
 await insert621('INSERT INTO synthetic_m03_stock_lots VALUES(?,?,?,?,?,?)',
  'BUS-A','LOT-P621-A','PRD-000010','40','2','PUR-P621-A');
 for(const tenant of ['BUS-A','BUS-B'])
  await insert621('INSERT INTO synthetic_m03_tenant_settings VALUES(?,?,?)',tenant,'৳','5');
 read621=createM03AuthenticatedProductsBootstrap({DB},{now:()=>N621});
}
const call621=token=>read621.getProductsBootstrap_({token});
const display621=row=>formatM05ProductStockCell({
 ...row['M05 Stock Preview'],baseStockText:String(row['Current Stock'])
}).stockCellText;

test('M03 #621 real local Workerd D1 authenticated Products bootstrap preserves tenant, ID, Units, Tiles and stock valuation',async t=>{
 await seed621();
 await t.test('authenticated A reads only A original Product IDs and M05 revisioned previews',async()=>{
  const result=await call621(T621.A);
  assert.equal(result.postingAllowed,false);
  assert.deepEqual(result.products.map(p=>p['Product ID']),[
   'PRD-000010','PRD-000011','PRD-000012','PRD-000013','PRD-000014']);
  assert.equal(result.products[0]['Current Stock'],45);
  assert.equal(result.products[0]['Stock Value'],105,'lot-priced 40 + opening gap 5 from original source');
  assert.equal(display621(result.products[0]),'2 Box 5 Pcs');
  assert.equal(display621(result.products[1]),'5 Box 3 Pcs · 512.00 Sqft');
  assert.equal(display621(result.products[2]),'2 Carton 5 Box 3 Pcs');
  assert.equal(result.products[1]['M05 Stock Preview'].tileMeasurement.revision,'5');
  assert.equal(result.products[3]['M05 Stock Preview'],undefined);
  assert.equal(result.products[3]['Current Stock'],12);
  assert.equal(result.products[4]['Product Type'],'Bundle');
  assert.equal(result.products[4]['Available Sets'],9);
  assert.equal(result.products[4]['M05 Stock Preview'],undefined);
  assert.equal(JSON.stringify(result).includes('BUS-B'),false);
 });
 await t.test('authenticated B cannot read any tenant A product or unit',async()=>{
  const b=await call621(T621.B);
  assert.deepEqual(b.products.map(p=>p['Product ID']),['PRD-000015']);
  assert.deepEqual(b.units.map(u=>u.id),['PUNT-000016']);
  assert.equal(b.products[0]['M05 Stock Preview'],undefined);
 });
 await t.test('denied, revoked, inactive, stale and string view permissions never fetch Products',async()=>{
  for(const token of [T621.DENY,T621.REVOKED,T621.INACTIVE,T621.STRING,T621.STALE,
   '9'.repeat(64)]){
   const queries=[];
   const proxy={DB:{prepare(sql){
    queries.push(sql);
    return DB.prepare(sql);
   }}};
   const reader=createM03AuthenticatedProductsBootstrap(proxy,{now:()=>N621});
   await assert.rejects(()=>reader.getProductsBootstrap_({token}),reject621);
   assert.equal(queries.length,1);
   assert.match(queries[0],/auth_sessions/);
   assert.doesNotMatch(queries[0],/FROM products|JOIN products|FROM product_units|FROM synthetic_m03_product_stock/);
  }
 });
 await t.test('oversold signed physical stock preserves negative shortage, no guessed availability',async()=>{
  await insert621("UPDATE synthetic_m03_product_stock SET physical_qty_text='-45' WHERE product_id='PRD-000010'");
  const a=await call621(T621.A);
  assert.equal(a.products[0]['Current Stock'],-45);
  assert.equal(display621(a.products[0]),'Shortage: 2 Box 5 Pcs');
  await insert621("UPDATE synthetic_m03_product_stock SET physical_qty_text='45' WHERE product_id='PRD-000010'");
 });
 await t.test('stale Tile measurement, mismatched pack and missing coverage cannot fabricate sqft',async()=>{
  const original=(await DB.prepare("SELECT measurement_json FROM synthetic_m03_tile_current WHERE product_id='PRD-000011'").first()).measurement_json;
  const tile=JSON.parse(original);
  for(const bad of [
   {...tile,revision:'4'},
   {...tile,piecesPerBox:'24'},
   {...tile,coveragePolicy:'manufacturer'}
  ]){
   await insert621("UPDATE synthetic_m03_tile_current SET measurement_json=? WHERE product_id='PRD-000011'",JSON.stringify(bad));
   await assert.rejects(()=>call621(T621.A),reject621);
  }
  await insert621("UPDATE synthetic_m03_tile_current SET measurement_json=? WHERE product_id='PRD-000011'",original);
  await insert621("UPDATE synthetic_m03_tile_current SET unit_revision=2 WHERE product_id='PRD-000011'");
  await assert.rejects(()=>call621(T621.A),reject621);
  await insert621("UPDATE synthetic_m03_tile_current SET unit_revision=3 WHERE product_id='PRD-000011'");
 });
 await t.test('unknown/stale conversion Unit master and bad stock source deny without leaking IDs',async()=>{
  await insert621("UPDATE product_units SET status='Inactive' WHERE unit_id='PUNT-000012'");
  await assert.rejects(()=>call621(T621.A),reject621);
  await insert621("UPDATE product_units SET status='Active' WHERE unit_id='PUNT-000012'");
  await insert621("UPDATE synthetic_m03_product_stock SET physical_qty_text='not-a-number' WHERE product_id='PRD-000010'");
  await assert.rejects(()=>call621(T621.A),reject621);
  await insert621("UPDATE synthetic_m03_product_stock SET physical_qty_text='45' WHERE product_id='PRD-000010'");
 });
 await t.test('public Worker does not expose private Products data or mutate any table',async()=>{
  for(const route of ['/api/rpc','/products','/api/products','/__m03_products__/bootstrap'])
   assert.equal((await worker.fetch('https://private.test'+route)).status,404);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM products').first()).n>=6,true);
  const a=await call621(T621.ADMIN);
  assert.deepEqual(a.products.map(x=>x['Product ID']),
   (await call621(T621.A)).products.map(x=>x['Product ID']));
 });
});
