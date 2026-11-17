import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createGuardedExpenseCategoryTextUpdateAdapter}
  from '../src/db/expense-category-text-update.js';
import {createLegacyCatalogReadAdapter}
  from '../src/db/legacy-catalog-read.js';

const ddl=readFileSync(new URL('../migrations/0005_expense_categories.sql',import.meta.url),'utf8');
const rows=[
  {legacy_sheet_row:2,category_id:'EXCAT-0001',category_name:'দোকান ভাড়া',
   description:'  মাসিক ভাড়া  ',status:'Active',created_at:'2026-11-15T10:00:00.000Z'},
  {legacy_sheet_row:3,category_id:'EXCAT-0002',category_name:'দোকান ভাড়া',
   description:'',status:'Inactive',created_at:''},
  {legacy_sheet_row:4,category_id:'EXCAT-0003',category_name:'İstanbul',
   description:'ফি',status:'',created_at:''}
];
const old=row=>({sourceId:row.category_id,name:row.category_name,
  description:row.description,status:row.status,createdAt:row.created_at});
const fields=(name,description)=>({'Category Name':name,Description:description});
function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(ddl);
  const insert=sqlite.prepare('INSERT INTO expense_categories(legacy_sheet_row,category_id,category_name,description,status,created_at) VALUES (?,?,?,?,?,?)');
  for(const row of rows)insert.run(row.legacy_sheet_row,row.category_id,row.category_name,
    row.description,row.status,row.created_at);
  const statements=[];
  let beforeWrite=null;
  const DB={prepare(sql){
    statements.push(sql);
    const stmt=sqlite.prepare(sql);
    return {bind(...args){return {
      async all(){return {success:true,results:stmt.all(...args)};},
      async first(){
        if(beforeWrite && /^UPDATE /i.test(sql)){const callback=beforeWrite;beforeWrite=null;callback();}
        return stmt.get(...args)??null;
      }
    };}};
  }};
  return {sqlite,DB,statements,adapter:createGuardedExpenseCategoryTextUpdateAdapter({DB}),
    reader:createLegacyCatalogReadAdapter({DB}),
    injectAtWrite(fn){beforeWrite=fn;},
    get(id){return {...sqlite.prepare(
     'SELECT legacy_sheet_row,category_id,category_name,description,status,created_at FROM expense_categories WHERE category_id=?'
    ).get(id)};},
    close(){sqlite.close();}
  };
}

test('real 0005 STRICT SQLite source-compatible name/description edit trims inputs and preserves immutable identity',async()=>{
 const x=fixture();try{
  const outcome=await x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
    fields('  নতুন দোকান ভাড়া  ','  আগামী মাসে  '),old(rows[0]));
  assert.equal(outcome,undefined,'Database.gs updateRowFields_ is void');
  assert.deepEqual(x.get('EXCAT-0001'),{...rows[0],
    category_name:'নতুন দোকান ভাড়া',description:'আগামী মাসে'});
  assert.deepEqual(x.get('EXCAT-0002'),rows[1]);
  assert.deepEqual(x.get('EXCAT-0003'),rows[2]);
  assert.equal(x.statements.filter(s=>/^UPDATE /i.test(s)).length,1);
  assert(x.statements.every(s=>/^(?:SELECT|UPDATE)\b/i.test(s.trim())));
  assert.equal((await x.reader.findRow_('EXPENSE_CATEGORIES','Category ID','EXCAT-0001')).row['Category Name'],'নতুন দোকান ভাড়া');
  assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM expense_categories').get().n,3);
 }finally{x.close();}
});

test('source String(name).toLowerCase duplicate check keeps historical duplicates but prevents adding another',async()=>{
 const x=fixture();try{
  for(const [row,name] of [[rows[0],'দোকান ভাড়া'],[rows[2],'দোকান ভাড়া'],
     [rows[1],'  দোকান ভাড়া  ']]){
    await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',
      row.legacy_sheet_row,fields(name,'changed'),old(row)),/duplicate|already exists/i);
  }
  assert.deepEqual(x.get('EXCAT-0001'),rows[0]);
  assert.deepEqual(x.get('EXCAT-0002'),rows[1]);
 }finally{x.close();}
});

test('Unicode JS lowercase duplicate semantics are enforced, not SQLite ASCII-only NOCASE',async()=>{
 const x=fixture();try{
  assert.equal('İstanbul'.toLowerCase(),'i\u0307stanbul');
  await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',3,
    fields('  i\u0307STANBUL  ','new'),old(rows[1])),/duplicate|already exists/i);
  assert.deepEqual(x.get('EXCAT-0002'),rows[1]);
  await x.adapter.updateRowFields_('EXPENSE_CATEGORIES',4,
    fields('İstanbul','  new description  '),old(rows[2]));
  assert.equal(x.get('EXCAT-0003').description,'new description');
 }finally{x.close();}
});

test('distinct concurrent category renames cannot both use one stale all-rows snapshot',async()=>{
 const x=fixture();try{
  const outcomes=await Promise.allSettled([
    x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
      fields('Shop A','A'),old(rows[0])),
    x.adapter.updateRowFields_('EXPENSE_CATEGORIES',4,
      fields('Shop B','B'),old(rows[2]))
  ]);
  assert.deepEqual(outcomes.map(o=>o.status).sort(),['fulfilled','rejected']);
  assert.equal([x.get('EXCAT-0001').category_name==='Shop A',
   x.get('EXCAT-0003').category_name==='Shop B'].filter(Boolean).length,1);
 }finally{x.close();}
});

test('insert, rename and status change between the D1 read and UPDATE invalidate the atomic snapshot',async()=>{
 for(const mutation of [
   sql=>sql.prepare("UPDATE expense_categories SET category_name='changed' WHERE category_id='EXCAT-0002'").run(),
   sql=>sql.prepare("UPDATE expense_categories SET status='Inactive' WHERE category_id='EXCAT-0003'").run(),
   sql=>sql.prepare("INSERT INTO expense_categories(legacy_sheet_row,category_id,category_name) VALUES(5,'EXCAT-NEW','new row')").run()
 ]){
  const x=fixture();try{
   x.injectAtWrite(()=>mutation(x.sqlite));
   await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
     fields('Shop Renamed','test'),old(rows[0])),/stale|unsafe|review|refus/i);
   assert.deepEqual(x.get('EXCAT-0001'),rows[0]);
  }finally{x.close();}
 }
});

test('gapped or NULL source row provenance blocks edits, even if the target itself is valid',async()=>{
 for(const kind of ['gap','null']){
  const x=fixture();try{
   x.sqlite.prepare("UPDATE expense_categories SET legacy_sheet_row=? WHERE category_id='EXCAT-0002'")
     .run(kind==='gap'?8:null);
   await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
     fields('Unique name','changed'),old(rows[0])),/stale|unsafe|physical|review|invalid/i);
   assert.deepEqual(x.get('EXCAT-0001'),rows[0]);
  }finally{x.close();}
 }
});

test('stale stable ID, old name, description, status, timestamp and physical position never change another row',async()=>{
 const x=fixture();try{
  for(const [rowIndex,pre] of [
   [3,old(rows[0])],[2,{...old(rows[0]),sourceId:'EXCAT-0002'}],
   [2,{...old(rows[0]),name:'corrupt'}],
   [2,{...old(rows[0]),description:'corrupt'}],
   [2,{...old(rows[0]),status:'Inactive'}],
   [2,{...old(rows[0]),createdAt:'2026-11-16'}]
  ]){
   await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',rowIndex,
     fields('Unique name','new'),pre),/stale|unsafe|review|refus/i);
  }
  assert.deepEqual(x.get('EXCAT-0001'),rows[0]);
 }finally{x.close();}
});

test('one-row old-preimage replay and lost updates to same original ID fail closed',async()=>{
 const x=fixture();try{
  await x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,fields('Unique A','a'),old(rows[0]));
  await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
    fields('Unique B','b'),old(rows[0])),/stale|unsafe|review|refus/i);
  assert.equal(x.get('EXCAT-0001').category_name,'Unique A');
 }finally{x.close();}
});

test('unsupported sheets, fields, unsafe inputs and getter injection are rejected BEFORE any D1 query',async()=>{
 const x=fixture();try{
  const before=x.statements.length,good=old(rows[0]);
  for(const sheet of ['SETTINGS','EXPENSES','EXPENSE_PAYEES','PRODUCT_CATEGORIES',
     'expense_categories','EXPENSE_CATEGORIES; DROP TABLE parties',null]){
   await assert.rejects(()=>x.adapter.updateRowFields_(sheet,2,
     fields('Name','Desc'),good),/unsupported|invalid|source|sheet/i);
  }
  for(const candidate of [
    null,[],{}, {'Category Name':'only'},
    {'Category Name':'','Description':'x'},
    {'Category Name':' ','Description':'x'},
    {'Category Name':42,Description:'x'},
    fields('Name',null),
    {...fields('Name','Description'),Status:'Active'},
    {'Category ID':'EXCAT-1','Category Name':'Name',Description:'x'},
    JSON.parse('{"Category Name":"Name","Description":"x","__proto__":"poison"}')
  ]){
   await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
     candidate,good),/invalid|field|source|name|description/i);
  }
  for(const index of [0,1,1002,NaN,2.5,Infinity,'2',null]){
   await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',index,
     fields('Name','Desc'),good),/invalid|row|position/i);
  }
  for(const pre of [
   null,[],{}, {...good,sourceId:''},
   {...good,name:42},{...good,status:'Paused'},
   {...good,createdAt:null},{...good,actorRole:'owner'},
   JSON.parse('{"sourceId":"x","name":"x","description":"x","status":"Active","createdAt":"","__proto__":"bad"}')
  ]){
   await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
     fields('Name','Desc'),pre),/invalid|preimage|source|field/i);
  }
  let called=0;
  const accessor=Object.defineProperty({},'Category Name',{
    enumerable:true,get(){called++;throw Error('SENSITIVE_SQL');}
  });
  await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
    accessor,good),e=>!e.message.includes('SENSITIVE_SQL'));
  assert.equal(called,0);
  assert.equal(x.statements.length,before);
 }finally{x.close();}
});

test('bad, failed and over-limit D1 scan results fail closed without UPDATE or SQL leakage',async()=>{
 assert.throws(()=>createGuardedExpenseCategoryTextUpdateAdapter({}),/D1|binding/i);
 for(const result of [
  null,{success:false,results:[]},{success:true,results:[null]},
  {success:true,results:[{legacy_sheet_row:2,category_id:'EXCAT-1'}]},
  {success:true,results:[{...rows[0],category_name:45}]}
 ]){
  const fake={DB:{prepare(){return {bind(){return {async all(){return result;}};}}}}};
  await assert.rejects(()=>createGuardedExpenseCategoryTextUpdateAdapter(fake)
    .updateRowFields_('EXPENSE_CATEGORIES',2,fields('New','Desc'),old(rows[0])),
     /stale|invalid|review|D1|source/i);
 }
 const hidden={DB:{prepare(){throw Error('SECRET_DATABASE_URL private');}}};
 await assert.rejects(()=>createGuardedExpenseCategoryTextUpdateAdapter(hidden)
   .updateRowFields_('EXPENSE_CATEGORIES',2,fields('Name','Desc'),old(rows[0])),
   e=>e instanceof Error&&!e.message.includes('SECRET_DATABASE_URL'));
 const x=fixture();try{
  const insert=x.sqlite.prepare('INSERT INTO expense_categories(legacy_sheet_row,category_id,category_name) VALUES(?,?,?)');
  for(let n=5;n<=1002;n++)insert.run(n,'EXCAT-'+n,'Unique '+n);
  await assert.rejects(()=>x.adapter.updateRowFields_('EXPENSE_CATEGORIES',2,
   fields('Name','Desc'),old(rows[0])),/limit|invalid|review|stale|source/i);
  assert.deepEqual(x.get('EXCAT-0001'),rows[0]);
 }finally{x.close();}
});

test('the adapter never appears in public Worker/RPC or changes posting, schema or source GAS',()=>{
 const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
 const migr=readFileSync(new URL('../migrations/0005_expense_categories.sql',import.meta.url),'utf8');
 assert(!worker.includes('expense-category-text-update'));
 assert(!registry.includes('expense-category-text-update'));
 assert(!registry.includes('updateExpenseCategory'));
 assert.match(worker,/database:'not-connected'/);
 assert.match(migr,/CREATE TABLE expense_categories/);
});
