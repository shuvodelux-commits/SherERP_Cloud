import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createGuardedExpenseCategoryStatusAdapter}
  from '../src/db/expense-category-status-update.js';
import {createLegacyCatalogReadAdapter}
  from '../src/db/legacy-catalog-read.js';

const migration=readFileSync(new URL('../migrations/0005_expense_categories.sql',import.meta.url),'utf8');
const original=[
  {legacy_sheet_row:2,category_id:'EXCAT-0001',category_name:'দোকান ভাড়া',
    description:'  মাসিক ভাড়া  ',status:'Active',created_at:'2026-11-15T10:00:00.000Z'},
  {legacy_sheet_row:3,category_id:'EXCAT-0002',category_name:'দোকান ভাড়া',
    description:'',status:'Inactive',created_at:''},
  {legacy_sheet_row:4,category_id:'EXCAT-0003',category_name:'বিদ্যুৎ বিল',
    description:'ফি',status:'',created_at:''}
];
const pre=row=>({
  sourceId:row.category_id,name:row.category_name,description:row.description,
  status:row.status,createdAt:row.created_at
});
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(migration);
 const insert=sqlite.prepare(
  'INSERT INTO expense_categories(legacy_sheet_row,category_id,category_name,description,status,created_at) VALUES (?,?,?,?,?,?)');
 for(const row of original)insert.run(row.legacy_sheet_row,row.category_id,row.category_name,
   row.description,row.status,row.created_at);
 const statements=[];
 const DB={prepare(sql){
   statements.push(sql);
   const prepared=sqlite.prepare(sql);
   return {bind(...args){return {
     async first(){return prepared.get(...args)??null;},
     async all(){return {success:true,results:prepared.all(...args)};}
   };}};
 }};
 return {sqlite,DB,statements,
   change:createGuardedExpenseCategoryStatusAdapter({DB}),
   reader:createLegacyCatalogReadAdapter({DB}),close:()=>sqlite.close()};
}
const get=(x,id)=>({...x.sqlite.prepare(
 'SELECT legacy_sheet_row,category_id,category_name,description,status,created_at FROM expense_categories WHERE category_id=?'
).get(id)});

test('actual 0005 STRICT SQLite status CAS changes exactly one source category and leaves all other text unchanged',async()=>{
 const x=fixture();try{
  const result=await x.change.updateRowFields_('EXPENSE_CATEGORIES',2,{Status:'Inactive'},pre(original[0]));
  assert.equal(result,undefined,'original Database.gs updateRowFields_ returns void');
  assert.deepEqual(get(x,'EXCAT-0001'),{...original[0],status:'Inactive'});
  assert.deepEqual(get(x,'EXCAT-0002'),original[1],'same-name historical identity must be separate');
  assert.deepEqual(get(x,'EXCAT-0003'),original[2],'blank status and UTF8 remain unchanged');
  assert.equal(x.statements.filter(sql=>/^UPDATE /i.test(sql)).length,1,'single SQL CAS statement');
  assert(!x.statements.some(sql=>/\bINSERT\b|\bDELETE\b|\bDROP\b/i.test(sql)),
    'no financial posting, migration or hard-delete SQL');
  assert.equal((await x.reader.getAllRows_('EXPENSE_CATEGORIES'))[0].Status,'Inactive');
 }finally{x.close();}
});

test('source historical blank Status is allowed as exact preimage; reopening never deletes prior rows',async()=>{
 const x=fixture();try{
  await x.change.updateRowFields_('EXPENSE_CATEGORIES',4,{Status:'Active'},pre(original[2]));
  assert.deepEqual(get(x,'EXCAT-0003'),{...original[2],status:'Active'});
  assert.equal((await x.reader.findRow_('EXPENSE_CATEGORIES','Category ID','EXCAT-0003')).rowIndex,4);
  assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM expense_categories').get().n,3);
 }finally{x.close();}
});

test('two parallel calls with the same source-ID/physical-row/full-preimage can never both succeed',async()=>{
 const x=fixture();try{
  const tries=await Promise.allSettled([
   x.change.updateRowFields_('EXPENSE_CATEGORIES',2,{Status:'Inactive'},pre(original[0])),
   x.change.updateRowFields_('EXPENSE_CATEGORIES',2,{Status:'Inactive'},pre(original[0]))
  ]);
  assert.deepEqual(tries.map(x=>x.status).sort(),['fulfilled','rejected']);
  assert.equal(get(x,'EXCAT-0001').status,'Inactive');
  await assert.rejects(()=>x.change.updateRowFields_('EXPENSE_CATEGORIES',2,
    {Status:'Inactive'},pre(original[0])),/stale|unsafe|review|refus/i);
 }finally{x.close();}
});

test('stale name, description, status, timestamp or wrong stable ID or row position fail closed',async()=>{
 const x=fixture();try{
  const row=original[0];
  const attempts=[
   {index:3,pre:pre(row)},
   {index:2,pre:{...pre(row),sourceId:'EXCAT-0002'}},
   {index:2,pre:{...pre(row),name:'অন্য নাম'}},
   {index:2,pre:{...pre(row),description:'changed'}},
   {index:2,pre:{...pre(row),status:'Inactive'}},
   {index:2,pre:{...pre(row),createdAt:'2026-11-16'}},
  ];
  for(const item of attempts)await assert.rejects(()=>
   x.change.updateRowFields_('EXPENSE_CATEGORIES',item.index,{Status:'Inactive'},item.pre),
   /stale|unsafe|review|refus|invalid/i);
  assert.deepEqual(get(x,'EXCAT-0001'),row);
 }finally{x.close();}
});

test('original Sheet rows must remain a dense, non-NULL 2-based position map even for an unrelated row',async()=>{
 const x=fixture();try{
  for(const edit of [
   "UPDATE expense_categories SET legacy_sheet_row=8 WHERE category_id='EXCAT-0002'",
   "UPDATE expense_categories SET legacy_sheet_row=NULL WHERE category_id='EXCAT-0002'"
  ]){
   x.sqlite.exec(edit);
   await assert.rejects(()=>x.change.updateRowFields_('EXPENSE_CATEGORIES',2,
     {Status:'Inactive'},pre(original[0])),/unsafe|review|refus/i);
   assert.equal(get(x,'EXCAT-0001').status,'Active');
   x.sqlite.exec("UPDATE expense_categories SET legacy_sheet_row=3 WHERE category_id='EXCAT-0002'");
  }
 }finally{x.close();}
});

test('unreviewed source groups, unauthorized fields, forged client identity and malformed preimages never reach SQL',async()=>{
 const x=fixture();try{
  const before=x.statements.length,good=pre(original[0]);
  for(const group of ['EXPENSES','EXPENSE_PAYEES','SETTINGS','PRODUCT_CATEGORIES',
    'expense_categories','EXPENSE_CATEGORIES; DROP TABLE parties',null]){
   await assert.rejects(()=>x.change.updateRowFields_(group,2,{Status:'Inactive'},good),
     /unsupported|source|sheet|invalid/i);
  }
  for(const fields of [
   null,[],{}, {Status:'Paused'}, {Status:''},{Status:0},
   {'Category ID':'HACK'}, {Description:'changed'},
   {'Category Name':'Changed'}, {_rowIndex:2},
   {Status:'Active',Description:'changed'},
   JSON.parse('{"Status":"Inactive","__proto__":"HACK"}')
  ]){
   await assert.rejects(()=>x.change.updateRowFields_('EXPENSE_CATEGORIES',2,fields,good),
     /invalid|unsupported|source|field/i);
  }
  for(const index of [0,1,1002,2.5,NaN,Infinity,'2',null]){
   await assert.rejects(()=>x.change.updateRowFields_('EXPENSE_CATEGORIES',index,
     {Status:'Inactive'},good),/invalid|position|source|row/i);
  }
  const bad=[
   null,[],{}, {sourceId:'',name:'X',description:'',status:'Active',createdAt:''},
   {...good,createdAt:null},{...good,description:0},{...good,status:'Paused'},
   {...good,clientRole:'owner'},JSON.parse('{"sourceId":"x","__proto__":"a"}')
  ];
  for(const evidence of bad){
   await assert.rejects(()=>x.change.updateRowFields_('EXPENSE_CATEGORIES',2,
     {Status:'Inactive'},evidence),/invalid|preimage|source|field/i);
  }
  assert.equal(x.statements.length,before,'invalid input must never prepare SQL');
  assert.deepEqual(get(x,'EXCAT-0001'),original[0]);
 }finally{x.close();}
});

test('adversarial input getters are rejected without evaluating code, and D1 exceptions are sanitized',async()=>{
 const x=fixture();try{
  let called=0;
  const evil=Object.defineProperty({},'Status',{
   enumerable:true,get(){called++;throw Error('SECRET_SQL_PREIMAGE');}
  });
  await assert.rejects(()=>x.change.updateRowFields_('EXPENSE_CATEGORIES',2,
    evil,pre(original[0])),err=>!err.message.includes('SECRET_SQL_PREIMAGE'));
  const contaminated=Object.defineProperty({...pre(original[0])},'name',{
   enumerable:true,get(){called++;throw Error('SECRET_SQL_PREIMAGE');}
  });
  await assert.rejects(()=>x.change.updateRowFields_('EXPENSE_CATEGORIES',2,
    {Status:'Inactive'},contaminated),err=>!err.message.includes('SECRET_SQL_PREIMAGE'));
  assert.equal(called,0);
 }finally{x.close();}
 const failing={DB:{prepare(){throw Error('SECRET_D1_SQL_AND_TOKEN');}}};
 await assert.rejects(()=>createGuardedExpenseCategoryStatusAdapter(failing)
   .updateRowFields_('EXPENSE_CATEGORIES',2,{Status:'Inactive'},pre(original[0])),
   err=>err instanceof Error&&!err.message.includes('SECRET_D1_SQL_AND_TOKEN'));
});

test('incomplete driver or fake success response must not become a committed update',async()=>{
 assert.throws(()=>createGuardedExpenseCategoryStatusAdapter({}),/D1|binding/i);
 const invalid=[null,{}, {legacy_sheet_row:2,category_id:'WRONG',status:'Inactive'},
   {legacy_sheet_row:3,category_id:'EXCAT-0001',status:'Inactive'},
   {legacy_sheet_row:2,category_id:'EXCAT-0001',status:'Active'}];
 for(const result of invalid){
  const stub={DB:{prepare(){return {bind(){return {async first(){return result;}};}}}}};
  await assert.rejects(()=>createGuardedExpenseCategoryStatusAdapter(stub)
    .updateRowFields_('EXPENSE_CATEGORIES',2,{Status:'Inactive'},pre(original[0])),
    /stale|unsafe|review|refus|invalid/i);
 }
});

test('no public Worker RPC, live expense posting, cash, bank, or historical transaction mutation',async()=>{
 const {readFileSync}=await import('node:fs');
 const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
 assert.equal(live.includes('expense-category-status-update'),false);
 assert.equal(registry.includes('expense-category-status-update'),false);
 assert.match(live,/database:'not-connected'/);
 const x=fixture();try{
  const before=x.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
  await x.change.updateRowFields_('EXPENSE_CATEGORIES',3,{Status:'Active'},pre(original[1]));
  assert.deepEqual(x.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name),before);
  assert.deepEqual(get(x,'EXCAT-0001'),original[0]);
 }finally{x.close();}
});
