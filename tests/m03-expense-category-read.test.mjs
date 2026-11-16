import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createLegacyCatalogReadAdapter}
  from '../src/db/legacy-catalog-read.js';

const HEADERS=['Category ID','Category Name','Description','Status','Created At'];
const SOURCE_ROWS=[
  {'Category ID':'EXCAT-1','Category Name':'দোকান ভাড়া',
   Description:'  মাসিক ভাড়া  ',Status:'Active','Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'EXCAT-2','Category Name':'দোকান ভাড়া',
   Description:'',Status:'Inactive','Created At':'',_rowIndex:3},
  {'Category ID':'EXCAT-3','Category Name':'বিদ্যুৎ বিল',
   Description:'ফি',Status:'','Created At':'',_rowIndex:4}
];
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE expense_categories (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_sheet_row INTEGER UNIQUE,
    category_id TEXT NOT NULL UNIQUE,
    category_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Active',
    created_at TEXT NOT NULL DEFAULT ''
  ) STRICT;`);
  const stmt=sql.prepare('INSERT INTO expense_categories(legacy_sheet_row,category_id,category_name,description,status,created_at) VALUES(?,?,?,?,?,?)');
  for(const row of SOURCE_ROWS)stmt.run(
    row._rowIndex,row['Category ID'],row['Category Name'],
    row.Description,row.Status,row['Created At']
  );
  const seen=[];
  const DB={prepare(statement){
    seen.push(statement);
    const prepared=sql.prepare(statement);
    return {bind(...args){
      return {async all(){return {success:true,results:prepared.all(...args)};}};
    }};
  }};
  return {sql,DB,seen,adapter:createLegacyCatalogReadAdapter({DB}),close:()=>sql.close()};
}

test('EXPENSE_CATEGORIES returns exact source headers, five text fields and physical row provenance',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.adapter.getSheetHeaders_('EXPENSE_CATEGORIES'),HEADERS);
    const rows=await x.adapter.getAllRows_('EXPENSE_CATEGORIES');
    assert.deepEqual(rows,SOURCE_ROWS);
    assert.equal(rows.length,3,'inactive and blank Status must remain visible in raw source read');
    assert.notStrictEqual(rows[0],SOURCE_ROWS[0]);
    const second=await x.adapter.getAllRows_('EXPENSE_CATEGORIES');
    assert.notStrictEqual(rows,second,'no shared mutable row cache');
    rows[0]['Category Name']='CLIENT-EDIT';
    assert.equal(second[0]['Category Name'],'দোকান ভাড়া');
    assert(x.seen.every(s=>/^SELECT\s/i.test(s) && /LIMIT\s+\?/i.test(s)),
      'reviewed source reads must be bounded SELECTs only');
  }finally{x.close();}
});

test('find helpers retain exact original String matching, repeated labels and first physical row',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.adapter.findRows_('EXPENSE_CATEGORIES','Category Name','দোকান ভাড়া'),
      SOURCE_ROWS.slice(0,2));
    assert.deepEqual(await x.adapter.findFirstRow_('EXPENSE_CATEGORIES','Category Name','দোকান ভাড়া'),
      SOURCE_ROWS[0]);
    assert.deepEqual(await x.adapter.findRow_('EXPENSE_CATEGORIES','Category ID','EXCAT-2'),
      {row:SOURCE_ROWS[1],rowIndex:3});
    assert.equal(await x.adapter.findRowIndex_('EXPENSE_CATEGORIES','Category ID','EXCAT-3'),4);
    assert.equal(await x.adapter.findRowIndex_('EXPENSE_CATEGORIES','Category ID','missing'),-1);
    assert.equal(await x.adapter.findRow_('EXPENSE_CATEGORIES','Category Name','দোকান ভাড়া '),null);
    assert.deepEqual(await x.adapter.findRows_('EXPENSE_CATEGORIES','Status','Inactive'),[SOURCE_ROWS[1]]);
    assert.deepEqual(await x.adapter.findRows_('EXPENSE_CATEGORIES','Status',''),[SOURCE_ROWS[2]]);
  }finally{x.close();}
});

test('reader does not accept unrelated sheets, columns or write methods',async()=>{
  const x=fixture();
  try{
    for(const key of ['EXPENSES','EXPENSE_PAYEES','SETTINGS','BANK_BOOK','expense_categories','EXPENSE_CATEGORIES;DROP TABLE parties']){
      await assert.rejects(()=>x.adapter.getAllRows_(key),/unsupported|sheet/i);
      await assert.rejects(()=>x.adapter.getSheetHeaders_(key),/unsupported|sheet/i);
    }
    for(const key of ['secret','Category ID; DROP TABLE expense_categories','category_id','Status ']){
      await assert.rejects(()=>x.adapter.findRows_('EXPENSE_CATEGORIES',key,'EXCAT-1'),
        /Column not found/i);
    }
    assert.equal(x.adapter.updateRowFields_,undefined);
    assert.equal(x.adapter.appendRow_,undefined);
    assert.equal(x.adapter.deleteRow_,undefined);
    assert.equal((await x.adapter.getAllRows_('EXPENSE_CATEGORIES')).length,3);
    assert(x.seen.every(s=>/^SELECT\s/i.test(s)),'reader must never execute SQL writes');
  }finally{x.close();}
});

test('unknown, missing and gapped original source rows fail closed; never invent _rowIndex',async()=>{
  const x=fixture();
  try{
    x.sql.exec("UPDATE expense_categories SET legacy_sheet_row=8 WHERE category_id='EXCAT-2'");
    await assert.rejects(()=>x.adapter.getAllRows_('EXPENSE_CATEGORIES'),/legacy|row|physical/i);
    x.sql.exec("UPDATE expense_categories SET legacy_sheet_row=NULL WHERE category_id='EXCAT-2'");
    await assert.rejects(()=>x.adapter.getAllRows_('EXPENSE_CATEGORIES'),/legacy|row|physical/i);
    x.sql.exec("UPDATE expense_categories SET legacy_sheet_row=3 WHERE category_id='EXCAT-2'");
    assert.deepEqual(await x.adapter.getAllRows_('EXPENSE_CATEGORIES'),SOURCE_ROWS);
  }finally{x.close();}
});

test('101st-page source records cannot silently truncate 1001-row history',async()=>{
  const x=fixture();
  try{
    const stmt=x.sql.prepare('INSERT INTO expense_categories (legacy_sheet_row,category_id,category_name) VALUES(?,?,?)');
    for(let row=5;row<=1002;row++)stmt.run(row,'EXCAT-'+row,'Name '+row);
    await assert.rejects(()=>x.adapter.getAllRows_('EXPENSE_CATEGORIES'),/1000|limit|exceed/i);
  }finally{x.close();}
});

test('missing D1, unsuccessful query, invalid fields and unsafe source values are errors',async()=>{
  assert.throws(()=>createLegacyCatalogReadAdapter({}),/D1|binding/i);
  for(const results of [
    {success:false,results:[]},
    {success:true,results:[null]},
    {success:true,results:[{legacy_sheet_row:2,category_id:'EXCAT-1',
      category_name:'text',description:9,status:'Active',created_at:''}]},
    {success:true,results:[{legacy_sheet_row:2,category_id:'EXCAT-1',
      category_name:'text',description:'',status:null,created_at:''}]}
  ]){
    const adapter=createLegacyCatalogReadAdapter({DB:{
      prepare:()=>({bind:()=>({all:async()=>results})})
    }});
    await assert.rejects(()=>adapter.getAllRows_('EXPENSE_CATEGORIES'),/D1|invalid|row/i);
  }
});
