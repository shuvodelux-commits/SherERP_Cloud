import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createLegacyCatalogAppendAdapter} from '../src/db/legacy-catalog-append.js';
import {createLegacyCatalogReadAdapter} from '../src/db/legacy-catalog-read.js';

const MIGRATION=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
function fixture() {
  const sql=new DatabaseSync(':memory:');
  sql.exec(MIGRATION);
  sql.exec("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES('CAT-1','Electrical','Active',2)");
  sql.exec("INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES('UNIT-1','Pcs','Active',2)");
  const statements=[];
  const DB={prepare(statement){
    statements.push(statement);
    const prepared=sql.prepare(statement);
    return {bind(...values){return {
      async first(){return prepared.get(...values)??null;},
      async all(){return {success:true,results:prepared.all(...values)};}
    };}};
  }};
  return {sql,statements,append:createLegacyCatalogAppendAdapter({DB}),
    read:createLegacyCatalogReadAdapter({DB}),close:()=>sql.close()};
}
const category=(id,name='Hardware')=>({'Category ID':id,'Category Name':name,'Status':'Active','Created At':''});
const unit=(id,name='গিরা')=>({'Unit ID':id,'Unit Name':name,'Status':'Active','Created At':''});
const count=(db,table)=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;

test('appendRows_ atomically appends multiple originals in order and returns undefined',async()=>{
  const x=fixture();
  try {
    const result=await x.append.appendRows_('PRODUCT_CATEGORIES',[
      category('CAT-2','Hardware'),category('CAT-3','Hardware'),category('CAT-4','হাতিয়ার')]);
    assert.equal(result,undefined);
    assert.equal(await x.append.appendRows_('PRODUCT_UNITS',[unit('UNIT-2'),unit('UNIT-3','Feet')]),undefined);
    assert.deepEqual((await x.read.getAllRows_('PRODUCT_CATEGORIES')).map(r=>[r['Category ID'],r['Category Name'],r._rowIndex]),[
      ['CAT-1','Electrical',2],['CAT-2','Hardware',3],['CAT-3','Hardware',4],['CAT-4','হাতিয়ার',5]
    ]);
    assert.deepEqual((await x.read.getAllRows_('PRODUCT_UNITS')).map(r=>r._rowIndex),[2,3,4]);
    const inserts=x.statements.filter(s=>s.startsWith('INSERT INTO'));
    assert.equal(inserts.length,2,'one SQL INSERT must write each multirow batch');
    assert(inserts.every(s=>s.includes('json_each(?)')));
    assert(inserts.every(s=>!s.includes('settings')));
  }finally{x.close();}
});

test('empty array is a source-compatible no-op without SQL; nonarrays fail closed',async()=>{
  const x=fixture();
  try {
    assert.equal(await x.append.appendRows_('PRODUCT_CATEGORIES',[]),undefined);
    assert.equal(x.statements.length,0);
    for(const rows of [null,{},'not-an-array']) {
      await assert.rejects(()=>x.append.appendRows_('PRODUCT_CATEGORIES',rows),/array|invalid/i);
    }
    assert.equal(count(x.sql,'product_categories'),1);
  }finally{x.close();}
});

test('entire batch fails before SQL if any later row is invalid or a group is unreviewed',async()=>{
  const x=fixture();
  try {
    for(const [group,rows] of [
      ['PRODUCT_CATEGORIES',[category('CAT-2'),{...category('CAT-3'),_rowIndex:4}]],
      ['PRODUCT_CATEGORIES',[category('CAT-2'),{...category('CAT-3'),Unsafe:'field'}]],
      ['PRODUCT_UNITS',[unit('UNIT-2'),{'Unit ID':'UNIT-3','Unit Name':'  '}]],
      ['PRODUCT_UNITS',[unit('UNIT-2'),{'Unit ID':17,'Unit Name':'Pcs'}]],
      ['SETTINGS',[category('CAT-2')]],['SALES',[unit('UNIT-2')]]
    ]) {
      await assert.rejects(()=>x.append.appendRows_(group,rows),/unsupported|invalid|required|unknown|row|column|blank/i);
    }
    assert.equal(count(x.sql,'product_categories'),1);
    assert.equal(count(x.sql,'product_units'),1);
  }finally{x.close();}
});

test('existing or within-batch duplicate IDs abort the entire one-statement INSERT',async()=>{
  const x=fixture();
  try {
    await assert.rejects(()=>x.append.appendRows_('PRODUCT_CATEGORIES',[category('CAT-2'),category('CAT-1')]),
      /unique|constraint|duplicate/i);
    assert.equal(count(x.sql,'product_categories'),1);
    await assert.rejects(()=>x.append.appendRows_('PRODUCT_UNITS',[unit('UNIT-2'),unit('UNIT-2')]),
      /unique|constraint|duplicate/i);
    assert.equal(count(x.sql,'product_units'),1);
    assert.equal(await x.append.appendRows_('PRODUCT_CATEGORIES',[category('CAT-2'),category('CAT-3')]),undefined);
    await assert.rejects(()=>x.append.appendRows_('PRODUCT_CATEGORIES',[category('CAT-2'),category('CAT-4')]),
      /unique|constraint|duplicate/i);
    assert.equal(count(x.sql,'product_categories'),3,'replay must not insert nonduplicate sibling');
  }finally{x.close();}
});

test('null or gapped legacy provenance refuses a whole multirow batch with zero writes',async()=>{
  const x=fixture();
  try {
    x.sql.exec("UPDATE product_categories SET legacy_sheet_row=5 WHERE category_id='CAT-1'");
    await assert.rejects(()=>x.append.appendRows_('PRODUCT_CATEGORIES',[category('CAT-2'),category('CAT-3')]),
      /unsafe|provenance|limit|refus/i);
    assert.equal(count(x.sql,'product_categories'),1);
    x.sql.exec("UPDATE product_units SET legacy_sheet_row=NULL WHERE unit_id='UNIT-1'");
    await assert.rejects(()=>x.append.appendRows_('PRODUCT_UNITS',[unit('UNIT-2'),unit('UNIT-3')]),
      /unsafe|provenance|limit|refus/i);
    assert.equal(count(x.sql,'product_units'),1);
  }finally{x.close();}
});

test('whole batch respects 1000-row cap and cannot partially overflow',async()=>{
  const x=fixture();
  try {
    const stmt=x.sql.prepare('INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES(?,?,?,?)');
    for(let i=0;i<998;i++)stmt.run('FILL-'+i,'Unit '+i,'Active',i+3);
    assert.equal(count(x.sql,'product_units'),999);
    await assert.rejects(()=>x.append.appendRows_('PRODUCT_UNITS',[unit('UNIT-2'),unit('UNIT-3')]),
      /unsafe|limit|refus/i);
    assert.equal(count(x.sql,'product_units'),999);
    assert.equal(await x.append.appendRows_('PRODUCT_UNITS',[unit('UNIT-2')]),undefined);
    assert.equal(count(x.sql,'product_units'),1000);
  }finally{x.close();}
});

test('batch method requires a valid D1 binding instead of falling back to Sheets',()=>{
  assert.throws(()=>createLegacyCatalogAppendAdapter({}),/D1|binding/i);
});
