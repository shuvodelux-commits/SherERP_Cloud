import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSealedSourceLookup} from '../src/db/m03-sealed-source-lookup.js';
import {FROZEN_SOURCE_COLUMNS,FROZEN_SOURCE_COMMIT}
  from '../src/db/m03-frozen-source-headers.js';

const FROZEN=Object.keys(FROZEN_SOURCE_COLUMNS);
const DDL=[
 "CREATE TABLE m03_private_source_seals(source_commit TEXT NOT NULL,source_group TEXT NOT NULL,headers_json TEXT NOT NULL,expected_rows INTEGER NOT NULL,source_digest TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(source_commit,source_group)) STRICT;",
 "CREATE TABLE m03_private_source_rows(source_commit TEXT NOT NULL,source_group TEXT NOT NULL,legacy_sheet_row INTEGER NOT NULL, cells_json TEXT NOT NULL, PRIMARY KEY(source_commit,source_group,legacy_sheet_row)) STRICT;"
].join('\n');
function digest(group,headers,rows){
 return createHash('sha256').update(JSON.stringify([
  'SherERP_M02_offline_source_parity_v1',group,headers,
  rows.map(row=>[row.sheetRow,row.cells])
 ])).digest('hex');
}
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(DDL);
 const prepared=sql.prepare('INSERT INTO m03_private_source_seals VALUES(?,?,?,?,?,?)');
 const insert=sql.prepare('INSERT INTO m03_private_source_rows VALUES(?,?,?,?)');
 const raw={};
 for(const group of FROZEN){
  const headers=FROZEN_SOURCE_COLUMNS[group];
  const positions=group==='PRODUCTS'?[2,8]:[2];
  const rows=positions.map((sheetRow,index)=>({
   sheetRow,
   cells:headers.map((h,col)=>
    group==='PRODUCTS'&&h==='Product ID'?'PRD-000'+(index+7):
    group==='PRODUCTS'&&h==='Product Name'?'নবাবী দড়ি':
    group==='PRODUCTS'&&h==='Purchase Price'?'001.50':
    group==='PRODUCTS'&&h==='Current Stock'?'0002.000':
    group==='SETTINGS'&&h==='Key'?'Shop Name':
    group==='SETTINGS'&&h==='Value'?'SECRET_STORE_VALUE':
    group==='CUSTOMERS'&&h==='Phone'?'01700000000':
    group==='LOGS'&&h==='Message'?'secret SQL log':
    group+' / '+h+' / '+col
   )
  }));
  raw[group]={headers,rows};
  prepared.run(FROZEN_SOURCE_COMMIT,group,JSON.stringify(headers),
    rows.length,digest(group,headers,rows),'SEALED');
  for(const row of rows)insert.run(FROZEN_SOURCE_COMMIT,group,row.sheetRow,JSON.stringify(row.cells));
 }
 const reads=[];
 const DB={prepare(query){
  reads.push(query);
  const prepared=sql.prepare(query);
  return {bind(...args){return {async all(){return {
   success:true,results:prepared.all(...args).map(row=>({...row}))
  };}};}};
 }};
 return {env:{DB},sql,raw,reads,close:()=>sql.close()};
}

test('opens one awaited, sealed snapshot across exactly 49 frozen groups and 659 original column headers',async()=>{
 const x=fixture();try{
  const lookup=createSealedSourceLookup(x.env);
  assert.deepEqual(Object.keys(lookup),['openSnapshot_']);
  const pending=lookup.openSnapshot_();
  assert.equal(typeof pending.then,'function');
  const snapshot=await pending;
  assert.deepEqual(Object.keys(snapshot).sort(),[
   'findFirstRow_','findRowIndex_','findRow_','findRows_','getAllRows_','getSheetHeaders_'
  ].sort());
  let cols=0;
  for(const group of FROZEN){
   const expected=x.raw[group],headers=await snapshot.getSheetHeaders_(group);
   assert.deepEqual(headers,expected.headers);
   cols+=headers.length;
   const rows=await snapshot.getAllRows_(group);
   assert.deepEqual(rows,expected.rows.map(r=>Object.fromEntries([
    ...expected.headers.map((h,i)=>[h,r.cells[i]]),['_rowIndex',r.sheetRow]
   ])));
   assert(rows.every(row=>Object.keys(row).length===headers.length+1));
  }
  assert.equal(cols,659);
  assert(x.reads.every(q=>/^SELECT\s/i.test(q.trim())));
  assert(x.reads.every(q=>!q.includes('SELECT *')&&!/UPDATE|DELETE|INSERT/.test(q)));
 }finally{x.close();}
});

test('Products source find helpers preserve text identifiers, duplicate human names, physical gaps and original return shapes',async()=>{
 const x=fixture();try{
  const source=await createSealedSourceLookup(x.env).openSnapshot_();
  const rows=await source.findRows_('PRODUCTS','Product Name','নবাবী দড়ি');
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>r._rowIndex),[2,8]);
  assert.equal(rows[0]['Purchase Price'],'001.50');
  assert.equal(rows[0]['Current Stock'],'0002.000');
  assert.equal((await source.findFirstRow_('PRODUCTS','Product ID','PRD-0008'))._rowIndex,8);
  assert.deepEqual(await source.findRow_('PRODUCTS','Product ID','PRD-0007'),
   {row:rows[0],rowIndex:2});
  assert.equal(await source.findRowIndex_('PRODUCTS','Product ID','PRD-0008'),8);
  assert.equal(await source.findRowIndex_('PRODUCTS','Product ID','PRD-008'),-1);
  assert.equal(await source.findFirstRow_('PRODUCTS','Product ID','UNKNOWN'),null);
  assert.equal(await source.findRow_('PRODUCTS','Product ID','UNKNOWN'),null);
  assert.deepEqual(await source.findRows_('PRODUCTS','Purchase Price',1.5),[]);
  assert.equal((await source.findRows_('PRODUCTS','Product ID','PRD-0007'))[0]._rowIndex,2);
 }finally{x.close();}
});

test('private snapshot clones outputs so mutation and getters cannot poison later source reads',async()=>{
 const x=fixture();try{
  const source=await createSealedSourceLookup(x.env).openSnapshot_();
  const headers=await source.getSheetHeaders_('PRODUCTS');headers[0]='forged';
  const rows=await source.getAllRows_('PRODUCTS');
  rows[0]['Product ID']='POISONED';rows[0]._rowIndex=200;
  rows.push({'Product ID':'POISONED'});
  const next=await source.getAllRows_('PRODUCTS');
  assert.deepEqual(await source.getSheetHeaders_('PRODUCTS'),FROZEN_SOURCE_COLUMNS.PRODUCTS);
  assert.equal(next[0]['Product ID'],'PRD-0007');
  assert.equal(next[0]._rowIndex,2);
  assert.equal(next.length,2);
  assert.equal((await source.findRow_('PRODUCTS','Product ID','PRD-0007')).rowIndex,2);
 }finally{x.close();}
});

test('source group and header names are exact allowlist keys, not caller-controlled SQL identifiers',async()=>{
 const x=fixture();try{
  const source=await createSealedSourceLookup(x.env).openSnapshot_();
  const n=x.reads.length;
  for(const name of ['products','NOT_A_SHEET','__proto__','constructor',
   'PRODUCTS; DROP TABLE m03_private_source_rows',null]){
   await assert.rejects(()=>source.getSheetHeaders_(name),/source|group|unsupported|invalid/i);
   await assert.rejects(()=>source.getAllRows_(name),/source|group|unsupported|invalid/i);
  }
  for(const col of ['product_id','__proto__','Product ID; DROP',null]){
   await assert.rejects(()=>source.findRows_('PRODUCTS',col,'PRD-0007'),
    /source|column|invalid|unsupported/i);
   await assert.rejects(()=>source.findRowIndex_('PRODUCTS',col,'PRD-0007'),
    /source|column|invalid|unsupported/i);
  }
  for(const value of [{toString(){throw Error('SECRET_ACCESS')}},Symbol('id'),1n,NaN]){
   await assert.rejects(()=>source.findRows_('PRODUCTS','Product ID',value),
     /source|value|invalid|unsupported/i);
  }
  assert.equal(x.reads.length,n,'invalid lookup must never reach D1');
  assert.throws(()=>createSealedSourceLookup({}),/D1|binding/i);
  await assert.rejects(()=>createSealedSourceLookup(x.env).openSnapshot_({group:'SALES'}),
    /source|argument|invalid/i);
 }finally{x.close();}
});

test('source archive is a single sealed read per request; a new request cannot reuse stale data',async()=>{
 const x=fixture();try{
  const adapter=createSealedSourceLookup(x.env);
  const before=await adapter.openSnapshot_();
  assert.equal((await before.findRow_('PRODUCTS','Product ID','PRD-0007')).row['Purchase Price'],'001.50');
  const id='PRD-0007',headers=x.raw.PRODUCTS.headers;
  const product=x.raw.PRODUCTS.rows[0];
  product.cells[headers.indexOf('Purchase Price')]='009.00';
  x.sql.prepare("UPDATE m03_private_source_rows SET cells_json=? WHERE source_group='PRODUCTS' AND legacy_sheet_row=2")
   .run(JSON.stringify(product.cells));
  x.sql.prepare("UPDATE m03_private_source_seals SET source_digest=? WHERE source_group='PRODUCTS'")
   .run(digest('PRODUCTS',headers,x.raw.PRODUCTS.rows));
  const after=await adapter.openSnapshot_();
  assert.equal((await after.findRow_('PRODUCTS','Product ID',id)).row['Purchase Price'],'009.00');
  assert.equal((await before.findRow_('PRODUCTS','Product ID',id)).row['Purchase Price'],'001.50');
 }finally{x.close();}
});

test('seal mismatch and driver failures reject all source lookups with a redacted private error',async()=>{
 const x=fixture();try{
  x.sql.prepare("UPDATE m03_private_source_rows SET cells_json='[123]' WHERE source_group='LOGS'").run();
  await assert.rejects(()=>createSealedSourceLookup(x.env).openSnapshot_(),err=>
   err instanceof Error && /Invalid or incomplete private M03 source archive/.test(err.message) &&
   !/SECRET|SQL|01700000000/.test(err.message));
 }finally{x.close();}
 const DB={prepare(){throw new Error('SECRET-SQL-CREDENTIALS');}};
 await assert.rejects(()=>createSealedSourceLookup({DB}).openSnapshot_(),
  err=>!err.message.includes('SECRET-SQL-CREDENTIALS'));
});

test('sealed lookup is not imported by public Worker, registry or finance posting',()=>{
 const publicCode=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
 assert.equal(publicCode.includes('m03-sealed-source-lookup'),false);
 assert.equal(registry.includes('m03-sealed-source-lookup'),false);
 assert.match(publicCode,/database:'not-connected'/);
 assert.equal(Object.keys(FROZEN_SOURCE_COLUMNS).length,49);
});
