import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createLegacyCatalogAppendAdapter} from '../src/db/legacy-catalog-append.js';
import {createLegacyCatalogReadAdapter} from '../src/db/legacy-catalog-read.js';

const MIGRATION=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');

function fixture({seed=true}={}) {
  const sql=new DatabaseSync(':memory:');
  sql.exec(MIGRATION);
  if(seed) sql.exec(`
    INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row)
      VALUES ('CAT-1','Electrical','Active',2);
    INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row)
      VALUES ('UNIT-1','Pcs','Active',2);
  `);
  const seen=[];
  const DB={prepare(statement){
    seen.push(statement);
    const prepared=sql.prepare(statement);
    return {bind(...values){return {
      async first(){return prepared.get(...values)??null;},
      async all(){return {success:true,results:prepared.all(...values)};},
    };}};
  }};
  return {sql,seen,DB,append:createLegacyCatalogAppendAdapter({DB}),
    read:createLegacyCatalogReadAdapter({DB}),close:()=>sql.close()};
}
const category=(id,name='Electrical')=>({'Category ID':id,'Category Name':name,Status:'Active','Created At':''});
const unit=(id,name='Feet')=>({'Unit ID':id,'Unit Name':name,Status:'Active','Created At':''});
const count=(sql,table)=>sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;

test('atomic appendRow_ keeps source 1-based physical indexes, original column shape and duplicate labels',async()=>{
  const x=fixture();
  try {
    assert.equal(await x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-2')),3);
    assert.equal(await x.append.appendRow_('PRODUCT_UNITS',unit('UNIT-2','দড়ি')),3);
    assert.equal(await x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-3')),4);
    const rows=await x.read.getAllRows_('PRODUCT_CATEGORIES');
    assert.deepEqual(rows.map(r=>[r['Category ID'],r['Category Name'],r._rowIndex]),[
      ['CAT-1','Electrical',2],['CAT-2','Electrical',3],['CAT-3','Electrical',4],
    ]);
    assert.deepEqual((await x.read.getAllRows_('PRODUCT_UNITS')).map(r=>[r['Unit ID'],r['Unit Name'],r._rowIndex]),
      [['UNIT-1','Pcs',2],['UNIT-2','দড়ি',3]]);
    assert(x.seen.some(s=>s.startsWith('INSERT INTO product_categories')));
    assert(x.seen.some(s=>s.includes('RETURNING legacy_sheet_row')));
    assert(x.seen.every(s=>!/\bsettings\b/i.test(s)));
  }finally{x.close();}
});

test('empty catalog starts at physical row 2 and returns an awaited number',async()=>{
  const x=fixture({seed:false});
  try {
    const rowIndex=await x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-A','New'));
    assert.equal(rowIndex,2);
    assert.equal(await x.read.findRowIndex_('PRODUCT_CATEGORIES','Category ID','CAT-A'),2);
  }finally{x.close();}
});

test('unreviewed groups, forged source row indexes and unexpected fields fail without a DB write',async()=>{
  const x=fixture();
  try {
    const bad=[
      ['SETTINGS',{Key:'Phone 1',Value:'private'}],
      ['SALES',category('CAT-2')],
      ['product_categories',category('CAT-2')],
      ['PRODUCT_CATEGORIES',{...category('CAT-2'),_rowIndex:3}],
      ['PRODUCT_UNITS',{...unit('UNIT-2'),Unsafe:'payload'}],
      ['PRODUCT_CATEGORIES',[]],
      ['PRODUCT_UNITS',null],
    ];
    for(const [sheetKey,row] of bad){
      await assert.rejects(()=>x.append.appendRow_(sheetKey,row),/unsupported|invalid|unknown|row|column/i);
    }
    assert.equal(count(x.sql,'product_categories'),1);
    assert.equal(count(x.sql,'product_units'),1);
  }finally{x.close();}
});

test('missing IDs/names and invalid values are rejected before an INSERT',async()=>{
  const x=fixture();
  try {
    for(const row of [
      {'Category ID':'','Category Name':'New',Status:'Active'},
      {'Category ID':'CAT-2','Category Name':' ',Status:'Active'},
      {'Category ID':17,'Category Name':'New',Status:'Active'},
      {'Category ID':'CAT-2','Category Name':{},Status:'Active'},
      {'Category ID':'CAT-2','Category Name':'New',Status:'Active','Created At':new Date('invalid')},
    ]){
      await assert.rejects(()=>x.append.appendRow_('PRODUCT_CATEGORIES',row),/required|invalid|unsupported|value|date/i);
    }
    assert.equal(count(x.sql,'product_categories'),1);
  }finally{x.close();}
});

test('duplicate stable source ID never double-appends, including on ambiguous retries',async()=>{
  const x=fixture();
  try {
    assert.equal(await x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-2')),3);
    await assert.rejects(()=>x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-2')),
      /UNIQUE|constraint|D1|already|duplicate/i);
    assert.equal(count(x.sql,'product_categories'),2);
    assert.deepEqual((await x.read.getAllRows_('PRODUCT_CATEGORIES')).map(x=>x._rowIndex),[2,3]);
  }finally{x.close();}
});

test('existing gaps or NULL provenance fail closed, without silently repairing a Sheet row',async()=>{
  const x=fixture();
  try {
    x.sql.exec('UPDATE product_categories SET legacy_sheet_row=6 WHERE category_id=\'CAT-1\'');
    await assert.rejects(()=>x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-2')),
      /unsafe|provenance|contiguous|limit|refus/i);
    assert.equal(count(x.sql,'product_categories'),1);
    x.sql.exec('UPDATE product_categories SET legacy_sheet_row=NULL WHERE category_id=\'CAT-1\'');
    await assert.rejects(()=>x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-2')),
      /unsafe|provenance|contiguous|limit|refus/i);
    assert.equal(count(x.sql,'product_categories'),1);
  }finally{x.close();}
});

test('1000-row read limit also guards append atomically',async()=>{
  const x=fixture({seed:false});
  try {
    const stmt=x.sql.prepare('INSERT INTO product_units(legacy_sheet_row,unit_id,unit_name,status) VALUES(?,?,?,?)');
    for(let i=0;i<1000;i++)stmt.run(i+2,'UNIT-'+i,'Unit '+i,'Active');
    await assert.rejects(()=>x.append.appendRow_('PRODUCT_UNITS',unit('UNIT-LIMIT')),
      /limit|unsafe|full|refus/i);
    assert.equal(count(x.sql,'product_units'),1000);
  }finally{x.close();}
});

test('concurrent append attempts allocate distinct source row indexes using one SQL statement each',async()=>{
  const x=fixture();
  try {
    const positions=await Promise.all([
      x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-2','A')),
      x.append.appendRow_('PRODUCT_CATEGORIES',category('CAT-3','B')),
    ]);
    assert.deepEqual(positions.slice().sort((a,b)=>a-b),[3,4]);
    assert.deepEqual((await x.read.getAllRows_('PRODUCT_CATEGORIES')).map(r=>r._rowIndex),[2,3,4]);
    assert.equal(x.seen.filter(s=>s.startsWith('INSERT INTO product_categories')).length,2);
  }finally{x.close();}
});

test('missing D1 binding and malformed write-result shape fail closed',async()=>{
  assert.throws(()=>createLegacyCatalogAppendAdapter({}),/D1|binding/i);
  const broken={DB:{prepare:()=>({bind:()=>({first:async()=>({legacy_sheet_row:'bad'})})})}};
  await assert.rejects(()=>createLegacyCatalogAppendAdapter(broken).appendRow_('PRODUCT_UNITS',unit('UNIT-2')),
    /invalid|row|result/i);
});
