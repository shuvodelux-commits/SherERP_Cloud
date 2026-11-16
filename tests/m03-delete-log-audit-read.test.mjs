import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createDeleteLogAuditReadAdapter}
  from '../src/db/delete-log-audit-read.js';

const HEADERS=['Log ID','Date','Time','Module','Record ID','Invoice No','Reason','Deleted By','Deleted By Mobile'];
const FIELDS=['log_id','date_text','time_text','module','record_id','invoice_no','reason','deleted_by','deleted_by_mobile'];
const rows=()=>[
  {'Log ID':'DEL-1',Date:'2026-11-15',Time:'09:05',Module:'SALES','Record ID':'INV-123',
    'Invoice No':'INV-123',Reason:'  ভুল সংশোধন  ','Deleted By':'মিনা','Deleted By Mobile':'01700123456',_rowIndex:2},
  {'Log ID':'DEL-2',Date:'2026-11-15',Time:'09:05',Module:'SALES','Record ID':'INV-123',
    'Invoice No':'INV-123',Reason:'  ভুল সংশোধন  ','Deleted By':'মিনা','Deleted By Mobile':'01700123456',_rowIndex:3}
];
function fixture({seed=true}={}){
  const sql=new DatabaseSync(':memory:');
  sql.exec('CREATE TABLE legacy_delete_log (legacy_sheet_row INTEGER,'+
    FIELDS.map(x=>x+' TEXT NOT NULL DEFAULT \'\'').join(',')+') STRICT;');
  const insert=sql.prepare('INSERT INTO legacy_delete_log(legacy_sheet_row,'+FIELDS.join(',')+
    ') VALUES ('+Array(10).fill('?').join(',')+')');
  if(seed)for(const x of rows())insert.run(x._rowIndex,...HEADERS.map(key=>x[key]));
  const seen=[];
  const DB={prepare(query){
    seen.push(query);
    const stmt=sql.prepare(query);
    return {bind(...params){return {all:async()=>({success:true,results:stmt.all(...params)})}}};
  }};
  return {sql,seen,adapter:createDeleteLogAuditReadAdapter({DB}),close:()=>sql.close()};
}

test('frozen Config.gs DELETE_LOG header inventory has exactly nine columns',()=>{
  const source=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  const start=source.indexOf('    DELETE_LOG: [');
  assert(start>=0);
  const end=source.indexOf('    ],',start);
  assert.deepEqual([...source.slice(start,end).matchAll(/"([^"]+)"/g)].map(x=>x[1]),HEADERS);
});

test('awaited archived DELETE_LOG read preserves all text and original physical source row indexes',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.adapter.getSheetHeaders_('DELETE_LOG'),HEADERS);
    const actual=await x.adapter.getAllRows_('DELETE_LOG');
    assert.deepEqual(actual,rows());
    assert.deepEqual(Object.keys(actual[0]),[...HEADERS,'_rowIndex']);
    assert.equal(actual[0]['Deleted By Mobile'],'01700123456');
    assert.equal(actual[0].Reason,'  ভুল সংশোধন  ');
    assert.equal(actual[0].then,undefined);
    actual[0].Reason='mutated client copy';
    assert.deepEqual(await x.adapter.getAllRows_('DELETE_LOG'),rows());
    assert(x.seen.every(q=>/^SELECT\s/i.test(q) && /ORDER BY legacy_sheet_row ASC LIMIT\s+\?/i.test(q)));
  }finally{x.close();}
});

test('exact source String() find methods do not dedupe repeated original record IDs',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.adapter.findRows_('DELETE_LOG','Record ID','INV-123'),rows());
    assert.deepEqual(await x.adapter.findRows_('DELETE_LOG','Invoice No','INV-123'),rows());
    assert.deepEqual(await x.adapter.findFirstRow_('DELETE_LOG','Record ID','INV-123'),rows()[0]);
    assert.deepEqual(await x.adapter.findRow_('DELETE_LOG','Log ID','DEL-2'),{row:rows()[1],rowIndex:3});
    assert.equal(await x.adapter.findRowIndex_('DELETE_LOG','Log ID','DEL-1'),2);
    assert.equal(await x.adapter.findRowIndex_('DELETE_LOG','Log ID','missing'),-1);
    assert.equal(await x.adapter.findFirstRow_('DELETE_LOG','Reason','ভুল সংশোধন'),null);
    assert.equal(await x.adapter.findFirstRow_('DELETE_LOG','Deleted By Mobile','1700123456'),null);
  }finally{x.close();}
});

test('empty archive and missing identifiers have source-shaped null and -1 semantics',async()=>{
  const x=fixture({seed:false});
  try{
    assert.deepEqual(await x.adapter.getAllRows_('DELETE_LOG'),[]);
    assert.deepEqual(await x.adapter.findRows_('DELETE_LOG','Log ID','missing'),[]);
    assert.equal(await x.adapter.findRow_('DELETE_LOG','Log ID','missing'),null);
    assert.equal(await x.adapter.findFirstRow_('DELETE_LOG','Log ID','missing'),null);
    assert.equal(await x.adapter.findRowIndex_('DELETE_LOG','Log ID','missing'),-1);
  }finally{x.close();}
});

test('unapproved sheet/field names fail before any SQL and adapter exposes no writes',async()=>{
  const x=fixture();
  try{
    for(const key of ['SALES','SETTINGS','EXPENSE_PAYEES','delete_log','DELETE_LOG; DROP TABLE users']){
      await assert.rejects(()=>x.adapter.getAllRows_(key),/unsupported|DELETE_LOG|sheet/i);
      await assert.rejects(()=>x.adapter.getSheetHeaders_(key),/unsupported|DELETE_LOG|sheet/i);
    }
    for(const key of ['log_id','_rowIndex','Password Hash','Log ID; DROP TABLE accounts']){
      await assert.rejects(()=>x.adapter.findRows_('DELETE_LOG',key,'DEL-1'),/column|field|unsupported/i);
    }
    assert.equal(x.seen.length,0);
    for(const name of ['appendRow_','updateRowFields_','deleteRow_'])assert.equal(x.adapter[name],undefined);
  }finally{x.close();}
});

test('gapped and NULL physical source positions are refused instead of inventing _rowIndex',async()=>{
  const x=fixture();
  try{
    x.sql.exec("UPDATE legacy_delete_log SET legacy_sheet_row=9 WHERE log_id='DEL-2'");
    await assert.rejects(()=>x.adapter.getAllRows_('DELETE_LOG'),/source|physical|row|archive/i);
    x.sql.exec("UPDATE legacy_delete_log SET legacy_sheet_row=NULL WHERE log_id='DEL-2'");
    await assert.rejects(()=>x.adapter.findRowIndex_('DELETE_LOG','Log ID','DEL-1'),/source|physical|row|archive/i);
  }finally{x.close();}
});

test('a 1001st historic deletion entry must fail rather than silently truncate',async()=>{
  const x=fixture();
  try{
    const insert=x.sql.prepare('INSERT INTO legacy_delete_log(legacy_sheet_row,log_id) VALUES(?,?)');
    for(let row=4;row<=1002;row++)insert.run(row,'DEL-'+row);
    await assert.rejects(()=>x.adapter.getAllRows_('DELETE_LOG'),/1000|limit|exceed|archive/i);
  }finally{x.close();}
});

test('D1 missing, malformed, error, getter, duplicate log ID and private extra fields fail closed',async()=>{
  assert.throws(()=>createDeleteLogAuditReadAdapter({}),/D1|binding/i);
  const item={legacy_sheet_row:2,...Object.fromEntries(FIELDS.map((x,i)=>[x,rows()[0][HEADERS[i]]]))};
  const getter={...item};
  Object.defineProperty(getter,'reason',{enumerable:true,get(){throw Error('PRIVATE_DELETION_REASON');}});
  for(const reply of [
    {success:false,results:[]},
    {success:true,results:[null]},
    {success:true,results:[{...item,sql_private:'SENSITIVE'}]},
    {success:true,results:[{...item,legacy_sheet_row:2.5}]},
    {success:true,results:[{...item,log_id:' '}]},
    {success:true,results:[{...item,deleted_by_mobile:1712345678}]},
    {success:true,results:[getter]},
    {success:true,results:[item,{...item,legacy_sheet_row:3}]}
  ]){
    const a=createDeleteLogAuditReadAdapter({DB:{prepare:()=>({bind:()=>({all:async()=>reply})})}});
    let error;
    try{await a.getAllRows_('DELETE_LOG')}catch(e){error=e}
    assert(error instanceof Error,'malformed archive result must be refused');
    assert.doesNotMatch(String(error),/SENSITIVE|PRIVATE_DELETION_REASON/);
  }
});
