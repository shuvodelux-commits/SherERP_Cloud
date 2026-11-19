import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {readOwnerCatalog} from '../src/db/m03-owner-catalog-read.js';
import worker from '../src/m03-owner-redemption-worker.js';

test('catalog route requires an Owner session before it reads the shop database',async()=>{
  const origin='https://owner.example.test';
  const env={
    OWNER_AUTH_ORIGIN:origin,PLATFORM_AUTH_ORIGIN:'https://admin.example.test',
    PLATFORM_OWNER_CLIENT_ID:'654-example.apps.googleusercontent.com',
    OWNER_LOGIN_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
    OWNER_INGRESS:{async limit(){return {success:true};}},
    CONTROL_DB:{prepare(){assert.fail('Unsigned requests must not query Control D1');}},
    PLATFORM_PILOT_DB:{prepare(){assert.fail('Unsigned requests must not query Shop D1');}},
  };
  assert.equal((await worker.fetch(new Request(origin+'/api/owner/catalog'),env)).status,401);
  assert.equal((await worker.fetch(new Request(origin+'/api/owner/catalog',{method:'POST',headers:{Origin:origin}}),env)).status,404);
});

test('pilot catalog exposes only canonical, nondeleted product display fields',async()=>{
  const sqlite=new DatabaseSync(':memory:');
  try{
    sqlite.exec(readFileSync(new URL('../migrations/0012_legacy_product_snapshots.sql',import.meta.url),'utf8'));
    const insert=sqlite.prepare(`INSERT INTO legacy_product_snapshots
      (source_profile, legacy_sheet_row, product_id, product_name, brand_text,
       category_text, unit_text, selling_price_text, current_stock_text, purchase_price_text, is_deleted_text)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run('canonical',2,'P1','Fixture item','Maker','Hardware','Each','12.50','99','8','');
    insert.run('canonical',3,'P2','Deleted','','','','','','','TRUE');
    insert.run('supplementary',2,'P3','Other source','','','','','','','');
    sqlite.prepare(`INSERT INTO legacy_product_snapshots
      (source_profile,legacy_sheet_row,product_id,product_name,product_type_text,current_stock_text)
      VALUES ('canonical',4,'P4','Fixture bundle','Bundle','9')`).run();
    insert.run('canonical',5,'P5','Fixture adjustment','','','','','-1.25','bad','');
    insert.run('canonical',6,'P6','Fixture zero','','','','','0','0','');
    const db={prepare(sql){return {async all(){return {success:true,results:sqlite.prepare(sql).all()};}};}};
    assert.deepEqual(await readOwnerCatalog(db),[
      {productId:'P1',name:'Fixture item',brand:'Maker',category:'Hardware',unit:'Each',listedPrice:'12.50',savedPurchasePrice:'8',stockAtBackup:'99'},
      {productId:'P4',name:'Fixture bundle',brand:'',category:'',unit:'',listedPrice:'',savedPurchasePrice:null,stockAtBackup:null},
      {productId:'P5',name:'Fixture adjustment',brand:'',category:'',unit:'',listedPrice:'',savedPurchasePrice:null,stockAtBackup:'-1.25'},
      {productId:'P6',name:'Fixture zero',brand:'',category:'',unit:'',listedPrice:'',savedPurchasePrice:'0',stockAtBackup:'0'},
    ]);
  }finally{sqlite.close();}
});

test('unavailable D1 is distinct from a valid empty catalog',async()=>{
  await assert.rejects(()=>readOwnerCatalog({prepare(){return {async all(){return {success:false};}};}}),/catalog unavailable/i);
});
