import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createLegacyCatalogTailDeleteAdapter} from '../src/db/legacy-catalog-tail-delete.js';
import {createLegacyCatalogReadAdapter} from '../src/db/legacy-catalog-read.js';
import {createLegacyCatalogAppendAdapter} from '../src/db/legacy-catalog-append.js';

const MIGRATION=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(MIGRATION);
  sql.exec(`
    INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row)
      VALUES ('CAT-1','Electrical','Active',2),('CAT-2','Hardware','Active',3),('CAT-3','বাংলা','Inactive',4);
    INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row)
      VALUES ('UNT-1','Pcs','Active',2),('UNT-2','Feet','Inactive',3);
  `);
  const statements=[];
  const DB={prepare(statement){
    statements.push(statement);
    const prepared=sql.prepare(statement);
    return {bind(...values){return {
      async first(){return prepared.get(...values)??null;},
      async all(){return {success:true,results:prepared.all(...values)};}
    };}};
  }};
  return {sql,statements,adapter:createLegacyCatalogTailDeleteAdapter({DB}),
    reader:createLegacyCatalogReadAdapter({DB}),
    append:createLegacyCatalogAppendAdapter({DB}),
    close:()=>sql.close()};
}
const expected=(sourceId,name,status='Active')=>({sourceId,name,status});
const cat=(id,name='বাংলা')=>({'Category ID':id,'Category Name':name,Status:'Active','Created At':''});
const unit=(id,name='Feet')=>({'Unit ID':id,'Unit Name':name,Status:'Active','Created At':''});
const ids=(db,table,col)=>db.prepare('SELECT '+col+',legacy_sheet_row FROM '+table+' ORDER BY legacy_sheet_row').all()
  .map(r=>[r[col],r.legacy_sheet_row]);

test('deletes final category physical row with source ID/name/status CAS; leaves other rows in place',async()=>{
  const f=fixture();
  try {
    assert.equal(await f.adapter.deleteLastRow_('PRODUCT_CATEGORIES',4,expected('CAT-3','বাংলা','Inactive')),undefined);
    assert.deepEqual(ids(f.sql,'product_categories','category_id'),[['CAT-1',2],['CAT-2',3]]);
    assert.deepEqual((await f.reader.getAllRows_('PRODUCT_CATEGORIES')).map(r=>r._rowIndex),[2,3]);
    assert.equal(f.statements.filter(s=>s.startsWith('DELETE FROM')).length,1);
    assert.equal(await f.append.appendRow_('PRODUCT_CATEGORIES',cat('CAT-4')),4);
    assert.deepEqual(ids(f.sql,'product_categories','category_id'),[['CAT-1',2],['CAT-2',3],['CAT-4',4]]);
  }finally{f.close();}
});

test('deletes final unit then sole remaining row and appends next original ID at physical row 2',async()=>{
  const f=fixture();
  try {
    assert.equal(await f.adapter.deleteLastRow_('PRODUCT_UNITS',3,expected('UNT-2','Feet','Inactive')),undefined);
    assert.equal(await f.adapter.deleteLastRow_('PRODUCT_UNITS',2,expected('UNT-1','Pcs')),undefined);
    assert.deepEqual(await f.reader.getAllRows_('PRODUCT_UNITS'),[]);
    assert.equal(await f.append.appendRow_('PRODUCT_UNITS',unit('UNT-NEW','গিরা')),2);
    assert.deepEqual(ids(f.sql,'product_units','unit_id'),[['UNT-NEW',2]]);
  }finally{f.close();}
});

test('middle row refuses deletion even with valid ID and preimage, preserving contiguous provenance',async()=>{
  const f=fixture();
  try {
    for(const [row,pre] of [[2,expected('CAT-1','Electrical')],[3,expected('CAT-2','Hardware')]]){
      await assert.rejects(()=>f.adapter.deleteLastRow_('PRODUCT_CATEGORIES',row,pre),
        /tail|last|stale|unsafe|refus/i);
    }
    assert.deepEqual(ids(f.sql,'product_categories','category_id'),[['CAT-1',2],['CAT-2',3],['CAT-3',4]]);
  }finally{f.close();}
});

test('stale ID, status, name, or row position is rejected without any delete',async()=>{
  const f=fixture();
  try {
    const candidates=[
      [4,expected('CAT-OTHER','বাংলা','Inactive')],
      [4,expected('CAT-3','Wrong','Inactive')],
      [4,expected('CAT-3','বাংলা','Active')],
      [3,expected('CAT-3','বাংলা','Inactive')],
      [1001,expected('CAT-3','বাংলা','Inactive')]
    ];
    for(const [row,pre] of candidates){
      await assert.rejects(()=>f.adapter.deleteLastRow_('PRODUCT_CATEGORIES',row,pre),
        /stale|tail|unsafe|refus/i);
    }
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n,3);
  }finally{f.close();}
});

test('duplicate delete replay and empty catalog are both refused, never fake a success',async()=>{
  const f=fixture();
  try {
    assert.equal(await f.adapter.deleteLastRow_('PRODUCT_UNITS',3,expected('UNT-2','Feet','Inactive')),undefined);
    await assert.rejects(()=>f.adapter.deleteLastRow_('PRODUCT_UNITS',3,expected('UNT-2','Feet','Inactive')),
      /stale|tail|unsafe|refus/i);
    assert.equal(await f.adapter.deleteLastRow_('PRODUCT_UNITS',2,expected('UNT-1','Pcs')),undefined);
    await assert.rejects(()=>f.adapter.deleteLastRow_('PRODUCT_UNITS',2,expected('UNT-1','Pcs')),
      /stale|tail|unsafe|refus/i);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM product_units').get().n,0);
  }finally{f.close();}
});

test('gapped or NULL physical source position refuses even final-row deletion',async()=>{
  const f=fixture();
  try {
    f.sql.exec("UPDATE product_categories SET legacy_sheet_row=9 WHERE category_id='CAT-3'");
    await assert.rejects(()=>f.adapter.deleteLastRow_('PRODUCT_CATEGORIES',9,expected('CAT-3','বাংলা','Inactive')),
      /stale|unsafe|provenance|tail|refus/i);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n,3);
    f.sql.exec("UPDATE product_units SET legacy_sheet_row=NULL WHERE unit_id='UNT-1'");
    await assert.rejects(()=>f.adapter.deleteLastRow_('PRODUCT_UNITS',3,expected('UNT-2','Feet','Inactive')),
      /stale|unsafe|provenance|tail|refus/i);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM product_units').get().n,2);
  }finally{f.close();}
});

test('unknown sheets, invalid row numbers and incomplete preimage cannot prepare any delete SQL',async()=>{
  const f=fixture();
  try {
    for(const sheet of ['SETTINGS','SALES','PARTIES','product_units',"PRODUCT_UNITS; DROP TABLE settings"]){
      await assert.rejects(()=>f.adapter.deleteLastRow_(sheet,3,expected('UNT-2','Feet','Inactive')),
        /unsupported|sheet/i);
    }
    for(const rowIndex of [1,1.5,0,1002,'3',NaN]){
      await assert.rejects(()=>f.adapter.deleteLastRow_('PRODUCT_UNITS',rowIndex,expected('UNT-2','Feet','Inactive')),
        /invalid|row|index/i);
    }
    for(const pre of [undefined,null,{},[],{sourceId:'',name:'Feet',status:'Inactive'},
      {sourceId:'UNT-2',name:'',status:'Inactive'},
      {sourceId:'UNT-2',name:'Feet',status:7},
      {...expected('UNT-2','Feet','Inactive'),role:'staff'}]){
      await assert.rejects(()=>f.adapter.deleteLastRow_('PRODUCT_UNITS',3,pre),
        /invalid|precondition|source/i);
    }
    assert.equal(f.statements.length,0);
    assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM settings').get().n,0);
  }finally{f.close();}
});

test('concurrent duplicate deletion of the same tail index permits exactly one commit',async()=>{
  const f=fixture();
  try {
    const attempts=await Promise.allSettled([
      f.adapter.deleteLastRow_('PRODUCT_CATEGORIES',4,expected('CAT-3','বাংলা','Inactive')),
      f.adapter.deleteLastRow_('PRODUCT_CATEGORIES',4,expected('CAT-3','বাংলা','Inactive'))
    ]);
    assert.deepEqual(attempts.map(r=>r.status).sort(),['fulfilled','rejected']);
    assert.deepEqual(ids(f.sql,'product_categories','category_id'),[['CAT-1',2],['CAT-2',3]]);
  }finally{f.close();}
});

test('missing D1 binding is refused; malformed D1 DELETE result cannot report success',async()=>{
  assert.throws(()=>createLegacyCatalogTailDeleteAdapter({}),/D1|binding/i);
  assert.throws(()=>createLegacyCatalogTailDeleteAdapter({DB:{}}),/D1|binding/i);
  const broken={DB:{prepare(){return {bind(){return {first:async()=>({legacy_sheet_row:'3'})}}}}}};
  await assert.rejects(()=>createLegacyCatalogTailDeleteAdapter(broken)
    .deleteLastRow_('PRODUCT_UNITS',3,expected('UNT-2','Feet','Inactive')),/invalid|result|row/i);
});
