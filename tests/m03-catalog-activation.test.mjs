import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createLegacyCatalogActivationAdapter} from '../src/db/legacy-catalog-activation.js';
import {createLegacyCatalogReadAdapter} from '../src/db/legacy-catalog-read.js';

const migration=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');

function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(migration);
  sql.exec(`
    INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row)
    VALUES ('CAT-A','Electrical','Active',2),('CAT-B','Hardware','Inactive',3);
    INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row)
    VALUES ('UNIT-A','Pieces','Inactive',2),('UNIT-B','Feet','Active',3);
  `);
  const statements=[];
  const DB={prepare(text){
    statements.push(text);
    const prepared=sql.prepare(text);
    return {bind(...values){return {async first(){return prepared.get(...values)??null;},
      async all(){return {success:true,results:prepared.all(...values)};}};}};
  }};
  return {sql,statements,reader:createLegacyCatalogReadAdapter({DB}),activation:createLegacyCatalogActivationAdapter({DB}),
    close:()=>sql.close()};
}
const status=(sql,table,idColumn,id)=>sql.prepare(`SELECT status FROM ${table} WHERE ${idColumn}=?`).get(id)?.status;

test('reactivates exact source row ID and expected status for categories and units',async()=>{
  const x=fixture();
  try {
    assert.equal(await x.activation.activate_('PRODUCT_CATEGORIES',3,'CAT-B','Inactive'),3);
    assert.equal(await x.activation.activate_('PRODUCT_UNITS',2,'UNIT-A','Inactive'),2);
    const cat=await x.reader.findRow_('PRODUCT_CATEGORIES','Category ID','CAT-B');
    assert.equal(cat.row.Status,'Active');
    assert.equal(cat.row._rowIndex,3);
    const unit=await x.reader.findFirstRow_('PRODUCT_UNITS','Unit ID','UNIT-A');
    assert.equal(unit.Status,'Active');
    assert(x.statements.filter(s=>s.startsWith('UPDATE ')).every(s=>/RETURNING legacy_sheet_row/.test(s)));
    assert(x.statements.every(s=>!/\bsettings\b/i.test(s)));
  }finally{x.close();}
});

test('stale status, wrong ID, and shifted source row fail without changing another row',async()=>{
  const x=fixture();
  try {
    for(const args of [
      ['PRODUCT_CATEGORIES',3,'CAT-A','Inactive'],
      ['PRODUCT_CATEGORIES',2,'CAT-B','Inactive'],
      ['PRODUCT_CATEGORIES',3,'CAT-B','Active'],
      ['PRODUCT_UNITS',3,'UNIT-A','Inactive'],
      ['PRODUCT_UNITS',2,'UNIT-A','Active'],
    ]) await assert.rejects(()=>x.activation.activate_(...args),/conflict|stale|refus|unsafe/i);
    assert.equal(status(x.sql,'product_categories','category_id','CAT-B'),'Inactive');
    assert.equal(status(x.sql,'product_units','unit_id','UNIT-A'),'Inactive');
  }finally{x.close();}
});

test('two competing stale activations cannot both succeed',async()=>{
  const x=fixture();
  try {
    const result=await Promise.allSettled([
      x.activation.activate_('PRODUCT_CATEGORIES',3,'CAT-B','Inactive'),
      x.activation.activate_('PRODUCT_CATEGORIES',3,'CAT-B','Inactive')
    ]);
    assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(result.filter(r=>r.status==='rejected').length,1);
    assert.equal(status(x.sql,'product_categories','category_id','CAT-B'),'Active');
  }finally{x.close();}
});

test('invalid inputs and unauthorized sheets never reach SQL',async()=>{
  const x=fixture();
  try {
    const invalid=[
      ['SETTINGS',2,'KEY','Inactive'],
      ['SALES',2,'INV-1','Inactive'],
      ['product_categories',3,'CAT-B','Inactive'],
      ['PRODUCT_CATEGORIES',1,'CAT-B','Inactive'],
      ['PRODUCT_CATEGORIES',1002,'CAT-B','Inactive'],
      ['PRODUCT_CATEGORIES','3','CAT-B','Inactive'],
      ['PRODUCT_CATEGORIES',3,'','Inactive'],
      ['PRODUCT_CATEGORIES',3,17,'Inactive'],
      ['PRODUCT_CATEGORIES',3,'CAT-B',null],
      ['PRODUCT_CATEGORIES',3,'CAT-B',''],
    ];
    for(const args of invalid) await assert.rejects(()=>x.activation.activate_(...args),/unsupported|invalid|row|status/i);
    assert.equal(x.statements.filter(s=>s.startsWith('UPDATE ')).length,0);
    assert.equal(status(x.sql,'product_categories','category_id','CAT-B'),'Inactive');
  }finally{x.close();}
});

test('gapped, NULL and out-of-range source rows fail without repairing corrupted data',async()=>{
  const x=fixture();
  try {
    x.sql.exec("UPDATE product_categories SET legacy_sheet_row=7 WHERE category_id='CAT-A'");
    await assert.rejects(()=>x.activation.activate_('PRODUCT_CATEGORIES',3,'CAT-B','Inactive'),/unsafe|conflict|refus/i);
    x.sql.exec("UPDATE product_categories SET legacy_sheet_row=NULL WHERE category_id='CAT-A'");
    await assert.rejects(()=>x.activation.activate_('PRODUCT_CATEGORIES',3,'CAT-B','Inactive'),/unsafe|conflict|refus/i);
    assert.equal(status(x.sql,'product_categories','category_id','CAT-B'),'Inactive');
  }finally{x.close();}
});

test('catalog greater than 1000 source rows blocks activation atomically',async()=>{
  const x=fixture();
  try {
    const insert=x.sql.prepare('INSERT INTO product_units (unit_id,unit_name,status,legacy_sheet_row) VALUES (?,?,?,?)');
    for(let i=2;i<=1000;i++) insert.run('UNIT-X-'+i,'Label','Active',i+2);
    await assert.rejects(()=>x.activation.activate_('PRODUCT_UNITS',2,'UNIT-A','Inactive'),/unsafe|conflict|refus/i);
    assert.equal(status(x.sql,'product_units','unit_id','UNIT-A'),'Inactive');
  }finally{x.close();}
});

test('missing D1 and malformed D1 status result refuse success',async()=>{
  assert.throws(()=>createLegacyCatalogActivationAdapter({}),/D1|binding/i);
  const broken={DB:{prepare(){return {bind(){return {first:async()=>({legacy_sheet_row:'3'})};}};}}};
  await assert.rejects(()=>createLegacyCatalogActivationAdapter(broken).activate_('PRODUCT_CATEGORIES',3,'CAT-B','Inactive'),/Invalid D1/i);
});
