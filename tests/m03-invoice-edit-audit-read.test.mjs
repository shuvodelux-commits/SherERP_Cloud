import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createInvoiceEditAuditReadAdapter}
  from '../src/db/invoice-edit-audit-read.js';

const HEADERS=[
  'Log ID','Invoice ID','Edit Date','Reason',
  'Before Grand Total','After Grand Total','Return ID',
  'Before Return Amount','After Return Amount',
  'Before Return Items JSON','After Return Items JSON','Edited By'
];
const COLUMNS=[
  'log_id','invoice_id','edit_date_text','reason',
  'before_grand_total_text','after_grand_total_text','return_id',
  'before_return_amount_text','after_return_amount_text',
  'before_return_items_json','after_return_items_json','edited_by'
];
const input=()=>[
  {'Log ID':'IEL-A','Invoice ID':'INV-001','Edit Date':'2026-11-16T11:00Z',
   Reason:'  বাংলায় পরিবর্তন  ','Before Grand Total':'',
   'After Grand Total':'','Return ID':'RET-A',
   'Before Return Amount':'12.50','After Return Amount':'13.50',
   'Before Return Items JSON':' [1, 2] ','After Return Items JSON':' [2, 3] ',
   'Edited By':'মিনা',_rowIndex:2},
  {'Log ID':'IEL-B','Invoice ID':'INV-001','Edit Date':'2026-11-16T11:01Z',
   Reason:'  বাংলায় পরিবর্তন  ','Before Grand Total':'100.00',
   'After Grand Total':'90.50','Return ID':'RET-A',
   'Before Return Amount':'13.50','After Return Amount':'14',
   'Before Return Items JSON':' [2, 3] ','After Return Items JSON':' [3, 4] ',
   'Edited By':'মিনা',_rowIndex:3}
];
function fixture({seed=true}={}){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE legacy_invoice_edit_audit (
    row_id INTEGER PRIMARY KEY AUTOINCREMENT,
    legacy_sheet_row INTEGER,
    ${COLUMNS.map(c=>c+' TEXT NOT NULL').join(',')}
  ) STRICT;`);
  const values=[...COLUMNS];
  const insert=sql.prepare('INSERT INTO legacy_invoice_edit_audit(legacy_sheet_row,'+
    values.join(',')+') VALUES ('+Array(13).fill('?').join(',')+')');
  if(seed)for(const row of input()){
    insert.run(row._rowIndex,...HEADERS.map(key=>row[key]));
  }
  const seen=[];
  const DB={prepare(query){
    seen.push(query);
    const stmt=sql.prepare(query);
    return {bind(...params){
      return {async all(){return {success:true,results:stmt.all(...params)}}};
    }};
  }};
  return {sql,seen,DB,adapter:createInvoiceEditAuditReadAdapter({DB}),close:()=>sql.close()};
}

test('original Config.gs defines the twelve exact INVOICE_EDIT_LOG source headers',()=>{
  const source=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  const at=source.indexOf('    INVOICE_EDIT_LOG: [');
  assert(at>=0);
  const list=source.slice(at,source.indexOf('    ],',at)+6);
  assert.deepEqual([...list.matchAll(/"([^"]+)"/g)].map(x=>x[1]),HEADERS);
});

test('private archived D1 reader projects source headings, blank totals, raw JSON and physical row indexes',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.adapter.getSheetHeaders_('INVOICE_EDIT_LOG'),HEADERS);
    const rows=await x.adapter.getAllRows_('INVOICE_EDIT_LOG');
    assert.deepEqual(rows,input());
    assert.deepEqual(Object.keys(rows[0]),[...HEADERS,'_rowIndex']);
    assert.equal(rows[0]['Before Return Items JSON'],' [1, 2] ');
    assert.equal(rows[0]['Before Grand Total'],'');
    assert.equal(rows[0]['Before Return Amount'],'12.50');
    assert.equal(rows[1]['After Return Amount'],'14');
    assert.equal(rows[0].then,undefined);
    rows[0].Reason='CLIENT MUTATION';
    assert.deepEqual(await x.adapter.getAllRows_('INVOICE_EDIT_LOG'),input(),
      'a source row must not be cached by the reader');
    assert(x.seen.every(q=>/^SELECT\s/i.test(q)&&/ORDER BY legacy_sheet_row ASC LIMIT\s+\?/i.test(q)));
  }finally{x.close();}
});

test('findRows_, findFirstRow_, findRow_ and findRowIndex_ retain exact original String equality',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.adapter.findRows_('INVOICE_EDIT_LOG','Invoice ID','INV-001'),input());
    assert.deepEqual(await x.adapter.findRows_('INVOICE_EDIT_LOG','Return ID','RET-A'),input());
    assert.deepEqual(await x.adapter.findFirstRow_('INVOICE_EDIT_LOG','Invoice ID','INV-001'),input()[0]);
    assert.deepEqual(await x.adapter.findRow_('INVOICE_EDIT_LOG','Log ID','IEL-B'),
      {row:input()[1],rowIndex:3});
    assert.equal(await x.adapter.findRowIndex_('INVOICE_EDIT_LOG','Log ID','IEL-A'),2);
    assert.equal(await x.adapter.findRowIndex_('INVOICE_EDIT_LOG','Log ID','not-found'),-1);
    assert.equal(await x.adapter.findRow_('INVOICE_EDIT_LOG','Reason','বাংলায় পরিবর্তন'),null);
    assert.equal(await x.adapter.findFirstRow_('INVOICE_EDIT_LOG','Before Return Amount','12.5'),null);
  }finally{x.close();}
});

test('empty history remains readable and returns null/-1 lookup results',async()=>{
  const x=fixture({seed:false});
  try{
    assert.deepEqual(await x.adapter.getAllRows_('INVOICE_EDIT_LOG'),[]);
    assert.deepEqual(await x.adapter.findRows_('INVOICE_EDIT_LOG','Invoice ID','INV-001'),[]);
    assert.equal(await x.adapter.findFirstRow_('INVOICE_EDIT_LOG','Invoice ID','INV-001'),null);
    assert.equal(await x.adapter.findRow_('INVOICE_EDIT_LOG','Log ID','IEL-A'),null);
    assert.equal(await x.adapter.findRowIndex_('INVOICE_EDIT_LOG','Log ID','IEL-A'),-1);
  }finally{x.close();}
});

test('unapproved Sheet keys/columns fail before D1 access with no writes or generic SQL',async()=>{
  const x=fixture();
  try{
    for(const key of ['SETTINGS','SALES','INVOICE_EDIT_LOG;DROP TABLE parties','invoice_edit_log','EXPENSE_PAYEES']){
      await assert.rejects(()=>x.adapter.getAllRows_(key),/INVOICE_EDIT_LOG|Unsupported|sheet/i);
      await assert.rejects(()=>x.adapter.getSheetHeaders_(key),/INVOICE_EDIT_LOG|Unsupported|sheet/i);
    }
    for(const field of ['log_id','Invoice ID; DROP TABLE users','Password Hash','_rowIndex']){
      await assert.rejects(()=>x.adapter.findRows_('INVOICE_EDIT_LOG',field,'INV-001'),/column|unsupported/i);
    }
    assert.equal(x.seen.length,0,'untrusted identifiers must not trigger any SQL');
    assert.equal(x.adapter.appendRow_,undefined);
    assert.equal(x.adapter.updateRowFields_,undefined);
    assert.equal(x.adapter.deleteRow_,undefined);
  }finally{x.close();}
});

test('missing or gapped legacy physical row refuses reads, instead of misaddressing a historical edit',async()=>{
  const x=fixture();
  try{
    x.sql.exec("UPDATE legacy_invoice_edit_audit SET legacy_sheet_row=7 WHERE log_id='IEL-B'");
    await assert.rejects(()=>x.adapter.getAllRows_('INVOICE_EDIT_LOG'),/physical|source|row|archive/i);
    x.sql.exec("UPDATE legacy_invoice_edit_audit SET legacy_sheet_row=NULL WHERE log_id='IEL-B'");
    await assert.rejects(()=>x.adapter.findRowIndex_('INVOICE_EDIT_LOG','Log ID','IEL-A'),/physical|source|row|archive/i);
  }finally{x.close();}
});

test('1001 source rows cannot be silently truncated by LIMIT',async()=>{
  const x=fixture();
  try{
    const stmt=x.sql.prepare('INSERT INTO legacy_invoice_edit_audit(legacy_sheet_row,log_id) VALUES(?,?)');
    // Cannot insert a minimal row with NOT NULL fields; provide all descriptive columns.
    const full=x.sql.prepare('INSERT INTO legacy_invoice_edit_audit(legacy_sheet_row,'+
      COLUMNS.join(',')+') VALUES ('+Array(13).fill('?').join(',')+')');
    for(let row=4;row<=1002;row++)
      full.run(row,'IEL-'+row,...Array(11).fill(''));
    await assert.rejects(()=>x.adapter.getAllRows_('INVOICE_EDIT_LOG'),/1000|limit|exceed|archive/i);
    assert.equal(typeof stmt.run,'function');
  }finally{x.close();}
});

test('invalid D1 reply, additional private columns, getter, nonsafe ID or nontext are refused',async()=>{
  assert.throws(()=>createInvoiceEditAuditReadAdapter({}),/D1|binding/i);
  const good={
    legacy_sheet_row:2,
    ...Object.fromEntries(COLUMNS.map((key,i)=>[key,input()[0][HEADERS[i]]]))
  };
  const getters={...good};
  Object.defineProperty(getters,'edited_by',{enumerable:true,get(){throw Error('PRIVATE_SENSITIVE_SQL');}});
  const cases=[
    {success:false,results:[]},
    {success:true,results:[null]},
    {success:true,results:[{...good,sql_secret:'DO_NOT_LEAK'}]},
    {success:true,results:[{...good,legacy_sheet_row:2.5}]},
    {success:true,results:[{...good,log_id:''}]},
    {success:true,results:[{...good,before_return_amount_text:12.5}]},
    {success:true,results:[getters]}
  ];
  for(const reply of cases){
    const adapter=createInvoiceEditAuditReadAdapter({DB:{
      prepare:()=>({bind:()=>({all:async()=>reply})})
    }});
    let error;
    try{await adapter.getAllRows_('INVOICE_EDIT_LOG');}
    catch(e){error=e;}
    assert(error instanceof Error,'malformed D1 must never return partial rows');
    assert.doesNotMatch(String(error),/DO_NOT_LEAK|PRIVATE_SENSITIVE_SQL/);
  }
});
