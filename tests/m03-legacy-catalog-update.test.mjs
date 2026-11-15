import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createGuardedCatalogUpdateAdapter} from '../src/db/legacy-catalog-update.js';
import {createLegacyCatalogReadAdapter} from '../src/db/legacy-catalog-read.js';

const migration=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(migration);
  sqlite.exec(`
    INSERT INTO product_categories(category_id,category_name,status,created_at,legacy_sheet_row)
      VALUES('CAT-1','Electrical','Active','2026-11-14',2),
            ('CAT-2','Hardware','Active','2026-11-14',3);
    INSERT INTO product_units(unit_id,unit_name,status,created_at,legacy_sheet_row)
      VALUES('UNIT-1','Pcs','Active','2026-11-14',2),
            ('UNIT-2','Feet','Active','2026-11-14',3);
  `);
  const statements=[];
  const DB={prepare(sql){
    statements.push(sql);
    const statement=sqlite.prepare(sql);
    return {bind(...args){return {
      async first(){return statement.get(...args)??null;},
      async all(){return {success:true,results:statement.all(...args)};}
    };}};
  }};
  return {sqlite,statements,update:createGuardedCatalogUpdateAdapter({DB}),
    read:createLegacyCatalogReadAdapter({DB}),close:()=>sqlite.close()};
}
const before=(sourceId,name,status='Active')=>({sourceId,name,status});
const fetchRow=(sqlite,table,idColumn,id)=>sqlite.prepare(
  'SELECT * FROM '+table+' WHERE '+idColumn+'=?').get(id);

test('updates only Status by source ID + physical row + exact preimage, leaving adjacent row untouched',async()=>{
  const f=fixture();
  try {
    const result=await f.update.updateRowFields_('PRODUCT_CATEGORIES',2,
      {Status:'Inactive'},before('CAT-1','Electrical'));
    assert.equal(result,undefined);
    const changed=fetchRow(f.sqlite,'product_categories','category_id','CAT-1');
    assert.equal(changed.category_name,'Electrical');
    assert.equal(changed.status,'Inactive');
    assert.equal(changed.created_at,'2026-11-14');
    assert.equal(changed.legacy_sheet_row,2);
    assert.equal(fetchRow(f.sqlite,'product_categories','category_id','CAT-2').status,'Active');
    assert.equal(f.statements.filter(s=>s.startsWith('UPDATE')).length,1);
  }finally{f.close();}
});

test('updates UTF-8 display name and Status together without touching source ID or Created At',async()=>{
  const f=fixture();
  try {
    assert.equal(await f.update.updateRowFields_('PRODUCT_UNITS',3,
      {'Unit Name':'গিরা',Status:'Inactive'},before('UNIT-2','Feet')),undefined);
    const rows=await f.read.getAllRows_('PRODUCT_UNITS');
    assert.deepEqual(rows.map(r=>[r['Unit ID'],r['Unit Name'],r.Status,r._rowIndex]),[
      ['UNIT-1','Pcs','Active',2],['UNIT-2','গিরা','Inactive',3]]);
    assert.equal(fetchRow(f.sqlite,'product_units','unit_id','UNIT-2').created_at,'2026-11-14');
  }finally{f.close();}
});

test('stale name/status preimage fails rather than overwriting newer catalog values',async()=>{
  const f=fixture();
  try {
    await f.update.updateRowFields_('PRODUCT_CATEGORIES',2,{Status:'Inactive'},before('CAT-1','Electrical'));
    await assert.rejects(()=>f.update.updateRowFields_('PRODUCT_CATEGORIES',2,
      {'Category Name':'Stale overwrite'},before('CAT-1','Electrical')),/stale|precondition|refus|mismatch/i);
    await assert.rejects(()=>f.update.updateRowFields_('PRODUCT_CATEGORIES',2,
      {'Category Name':'Stale overwrite'},before('CAT-1','Electrical','Inactive-X')),/stale|precondition|refus|mismatch/i);
    assert.equal(fetchRow(f.sqlite,'product_categories','category_id','CAT-1').category_name,'Electrical');
    assert.equal(fetchRow(f.sqlite,'product_categories','category_id','CAT-1').status,'Inactive');
  }finally{f.close();}
});

test('stale physical row or wrong original stable source ID can never modify a different row',async()=>{
  const f=fixture();
  try {
    for(const [index,pre] of [[3,before('CAT-1','Electrical')],[2,before('CAT-2','Hardware')],[500,before('CAT-1','Electrical')]]){
      await assert.rejects(()=>f.update.updateRowFields_('PRODUCT_CATEGORIES',index,{Status:'Inactive'},pre),
        /stale|precondition|refus|mismatch/i);
    }
    assert.deepEqual(f.sqlite.prepare('SELECT status FROM product_categories ORDER BY legacy_sheet_row').all().map(x=>x.status),
      ['Active','Active']);
  }finally{f.close();}
});

test('gapped or NULL physical provenance blocks otherwise valid updates in one SQL statement',async()=>{
  const f=fixture();
  try {
    f.sqlite.exec("UPDATE product_categories SET legacy_sheet_row=8 WHERE category_id='CAT-2'");
    await assert.rejects(()=>f.update.updateRowFields_('PRODUCT_CATEGORIES',2,
      {Status:'Inactive'},before('CAT-1','Electrical')),/stale|provenance|refus|unsafe/i);
    assert.equal(fetchRow(f.sqlite,'product_categories','category_id','CAT-1').status,'Active');
    f.sqlite.exec("UPDATE product_units SET legacy_sheet_row=NULL WHERE unit_id='UNIT-2'");
    await assert.rejects(()=>f.update.updateRowFields_('PRODUCT_UNITS',2,
      {Status:'Inactive'},before('UNIT-1','Pcs')),/stale|provenance|refus|unsafe/i);
    assert.equal(fetchRow(f.sqlite,'product_units','unit_id','UNIT-1').status,'Active');
  }finally{f.close();}
});

test('forbidden fields and invalid values are rejected before preparing SQL',async()=>{
  const f=fixture();
  try {
    const bad=[
      {'Category ID':'CAT-NEW'}, {'Created At':'2026-11-15'}, {_rowIndex:2},
      {'Category Name':' '}, {'Category Name':17}, {Status:'Paused'},
      {Status:0}, {Other:'value'}, {}, [], null
    ];
    for(const fields of bad){
      await assert.rejects(()=>f.update.updateRowFields_('PRODUCT_CATEGORIES',2,fields,
        before('CAT-1','Electrical')),/invalid|unsupported|required|field|column|empty/i);
    }
    assert.equal(f.statements.length,0,'never even prepare SQL for invalid values');
    assert.equal(fetchRow(f.sqlite,'product_categories','category_id','CAT-1').status,'Active');
  }finally{f.close();}
});

test('unsupported sheets, invalid row position, and missing/stale evidence fail closed',async()=>{
  const f=fixture();
  try {
    for(const sheet of ['SETTINGS','SALES','CUSTOMERS','product_categories','PRODUCT_UNITS; DROP TABLE settings']){
      await assert.rejects(()=>f.update.updateRowFields_(sheet,2,{Status:'Inactive'},before('CAT-1','Electrical')),
        /unsupported|sheet/i);
    }
    for(const index of [0,1,1.5,NaN,'2',1002]){
      await assert.rejects(()=>f.update.updateRowFields_('PRODUCT_CATEGORIES',index,
        {Status:'Inactive'},before('CAT-1','Electrical')),/invalid|row|index/i);
    }
    for(const pre of [undefined,null,{}, {sourceId:'',name:'Electrical',status:'Active'},
      {sourceId:'CAT-1',name:2,status:'Active'}, {sourceId:'CAT-1',name:'Electrical',status:2},
      {...before('CAT-1','Electrical'),unexpected:'x'}]){
      await assert.rejects(()=>f.update.updateRowFields_('PRODUCT_CATEGORIES',2,{Status:'Inactive'},pre),
        /invalid|precondition|source|expected/i);
    }
    assert.equal(f.statements.length,0);
  }finally{f.close();}
});

test('two simultaneous writes with same preimage cannot both commit',async()=>{
  const f=fixture();
  try {
    const results=await Promise.allSettled([
      f.update.updateRowFields_('PRODUCT_CATEGORIES',2,{Status:'Inactive'},before('CAT-1','Electrical')),
      f.update.updateRowFields_('PRODUCT_CATEGORIES',2,{'Category Name':'New'},before('CAT-1','Electrical'))
    ]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.filter(x=>x.status==='rejected').length,1);
    const row=fetchRow(f.sqlite,'product_categories','category_id','CAT-1');
    assert.deepEqual([row.category_name,row.status],
      results[0].status==='fulfilled'?['Electrical','Inactive']:['New','Active']);
  }finally{f.close();}
});

test('missing or invalid D1 binding never silently falls back to legacy GAS',()=>{
  assert.throws(()=>createGuardedCatalogUpdateAdapter({}),/D1|binding/i);
  assert.throws(()=>createGuardedCatalogUpdateAdapter({DB:{}}),/D1|binding/i);
});
