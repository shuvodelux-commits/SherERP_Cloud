import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {
 M05_TILE_RECEIVE_DDL,M05_TILE_RECEIVE_INSERT_SQL
} from './fixtures/m05-tile-receiving-schema.mjs';
import {createSyntheticTileReceivingPoster} from './fixtures/m05-tile-receiving-contract.mjs';

function sqlite(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 const dir=new URL('../migrations/',import.meta.url);
 for(const file of readdirSync(dir).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort())
  db.exec(readFileSync(new URL(file,dir),'utf8'));
 for(const sql of M05_TILE_RECEIVE_DDL)db.exec(sql);
 return db;
}

test('test-only tile receiving DDL creates separate stock, supplier and original-revision receipt history',()=>{
 const db=sqlite();try{
  const rows=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'm05_tile_test_%' ORDER BY name").all();
  assert.ok(rows.length>=7);
  assert.equal(rows.every(r=>r.name.startsWith('m05_tile_test_')),true);
  assert.equal(readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>/^\d{4}_.+\.sql$/.test(x)).length,14);
  assert.match(M05_TILE_RECEIVE_INSERT_SQL,/ON CONFLICT.*DO NOTHING/is);
 }finally{db.close();}
});
test('test-only D1 synthetic receipt contract requires batch; no public route or production writer',()=>{
 assert.throws(()=>createSyntheticTileReceivingPoster(null),/binding|D1/i);
 const module=readFileSync(new URL('./fixtures/m05-tile-receiving-contract.mjs',import.meta.url),'utf8');
 assert.match(module,/createSyntheticTileReceivingPoster/);
 assert.match(module,/previewTilePurchaseLineCandidateD1/);
 assert.doesNotMatch(module,/SpreadsheetApp|LockService|remote|cloudflare.*api\/v4|fetch\s*\(/i);
});
test('test-only schema stores positive whole physical quantities and immutable receipts',()=>{
 const db=sqlite();try{
  assert.throws(()=>db.prepare("INSERT INTO m05_tile_test_receipts(operation_id) VALUES('X')").run());
  const sql=M05_TILE_RECEIVE_DDL.join('\n');
  for(const needle of ['expected_stock_version','expected_catalog_version','request_snapshot_json','measurement_snapshot_json','price_snapshot_json','unit_price_text','supplier_id','purchase_date']){
   assert.match(sql,new RegExp(needle));
  }
  assert.match(sql,/RAISE\(ABORT/i);
 }finally{db.close();}
});