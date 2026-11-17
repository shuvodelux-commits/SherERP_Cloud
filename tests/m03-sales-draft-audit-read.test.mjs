import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createSalesDraftAuditReadAdapter}
  from '../src/db/sales-draft-audit-read.js';

const HEADERS=Object.freeze([
  'Audit ID','Timestamp','Action','Draft ID','Draft No','Version',
  'Actor ID','Actor Name','Source Owner ID','Invoice ID','Note'
]);
const COLUMNS=Object.freeze([
  'audit_id','timestamp_text','action','draft_id','draft_no','version_text',
  'actor_id','actor_name','source_owner_id','invoice_id','note'
]);
const originals=()=>[
  {'Audit ID':'AUD-1',Timestamp:'2026-11-17T10:01Z',Action:'CREATED',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:'1',
    'Actor ID':'U-1','Actor Name':'শুভ','Source Owner ID':'U-1',
    'Invoice ID':'',Note:'',_rowIndex:2},
  {'Audit ID':'AUD-2',Timestamp:'2026-11-17T10:04Z',Action:'POST_CLEANUP_RETRY',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:'02',
    'Actor ID':'U-1','Actor Name':'শুভ','Source Owner ID':'U-1',
    'Invoice ID':'INV-1',Note:'  retry 🧾 ',_rowIndex:3}
];
function fixture({seed=true}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE legacy_sales_draft_audit ('+
    'row_id INTEGER PRIMARY KEY AUTOINCREMENT, legacy_sheet_row INTEGER, '+
    COLUMNS.map(c=>c+' TEXT NOT NULL').join(',')+
    ') STRICT');
  const values=[...COLUMNS];
  const insert=sqlite.prepare('INSERT INTO legacy_sales_draft_audit(legacy_sheet_row,'+
    values.join(',')+') VALUES ('+Array(values.length+1).fill('?').join(',')+')');
  if(seed)for(const row of originals())
    insert.run(row._rowIndex,...HEADERS.map(k=>row[k]));
  const seen=[];
  const DB={prepare(query){
    const call={query,args:undefined};
    seen.push(call);
    return {bind(...args){
      call.args=args;
      const stmt=sqlite.prepare(query);
      return {async all(){return {success:true,results:stmt.all(...args)}}};
    }};
  }};
  return {sqlite,seen,adapter:createSalesDraftAuditReadAdapter({DB}),
    close:()=>sqlite.close()};
}

test('frozen Config.gs declares exactly 11 original SALES_DRAFT_AUDIT source headers',()=>{
  const source=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  const start=source.indexOf('    SALES_DRAFT_AUDIT: [');
  assert(start>=0);
  const end=source.indexOf('    ],',start);
  assert(end>start);
  assert.deepEqual([...source.slice(start,end).matchAll(/"([^"]+)"/g)].map(m=>m[1]),HEADERS);
});

test('private archive reader restores source-shaped rows, physical indexes, Bengali actor and Version 02 text',async()=>{
  const f=fixture();
  try{
    const a=f.adapter;
    const headers=await a.getSheetHeaders_('SALES_DRAFT_AUDIT');
    assert.deepEqual(headers,HEADERS);
    headers[0]='CLIENT MUTATION';
    assert.deepEqual(await a.getSheetHeaders_('SALES_DRAFT_AUDIT'),HEADERS);
    const rows=await a.getAllRows_('SALES_DRAFT_AUDIT');
    assert.deepEqual(rows,originals());
    assert.deepEqual(Object.keys(rows[0]),[...HEADERS,'_rowIndex']);
    assert.equal(rows[1].Version,'02');
    assert.equal(rows[1].Note,'  retry 🧾 ');
    assert.equal(rows[1]['Actor Name'],'শুভ');
    assert.equal(rows[0].row_id,undefined);
    assert.equal(rows[0].then,undefined);
    rows[0].Note='CLIENT MUTATION';
    assert.deepEqual(await a.getAllRows_('SALES_DRAFT_AUDIT'),originals());
    assert(f.seen.every(call=>
      /^SELECT\s/i.test(call.query) &&
      /ORDER BY legacy_sheet_row ASC LIMIT\s+\?/i.test(call.query) &&
      call.args?.length===1 && call.args[0]===1001));
  }finally{f.close();}
});

test('all six source helper shapes preserve repeated Draft No, exact String equality and first physical match',async()=>{
  const f=fixture();
  try{
    const a=f.adapter;
    assert.deepEqual(await a.findRows_('SALES_DRAFT_AUDIT','Draft ID','DR-1'),originals());
    assert.deepEqual(await a.findRows_('SALES_DRAFT_AUDIT','Draft No','D-0001'),originals());
    assert.deepEqual(await a.findFirstRow_('SALES_DRAFT_AUDIT','Draft ID','DR-1'),originals()[0]);
    assert.deepEqual(await a.findRow_('SALES_DRAFT_AUDIT','Audit ID','AUD-2'),
      {row:originals()[1],rowIndex:3});
    assert.equal(await a.findRowIndex_('SALES_DRAFT_AUDIT','Audit ID','AUD-2'),3);
    assert.equal(await a.findRowIndex_('SALES_DRAFT_AUDIT','Audit ID','missing'),-1);
    assert.equal(await a.findFirstRow_('SALES_DRAFT_AUDIT','Version','2'),null);
    assert.equal(await a.findFirstRow_('SALES_DRAFT_AUDIT','Note','retry 🧾'),null);
  }finally{f.close();}
});

test('empty history yields [] / null / -1 and never guesses an archived draft number',async()=>{
  const f=fixture({seed:false});
  try{
    const a=f.adapter;
    assert.deepEqual(await a.getAllRows_('SALES_DRAFT_AUDIT'),[]);
    assert.deepEqual(await a.findRows_('SALES_DRAFT_AUDIT','Draft No','D-0001'),[]);
    assert.equal(await a.findFirstRow_('SALES_DRAFT_AUDIT','Draft No','D-0001'),null);
    assert.equal(await a.findRow_('SALES_DRAFT_AUDIT','Draft No','D-0001'),null);
    assert.equal(await a.findRowIndex_('SALES_DRAFT_AUDIT','Draft No','D-0001'),-1);
  }finally{f.close();}
});

test('unknown sheet and SQL-like/private headers reject before any D1 access; adapter contains no writer or number issuer',async()=>{
  const f=fixture();
  try{
    const a=f.adapter;
    for(const sheet of ['SALES_DRAFTS','SALES','SALES_DRAFT_AUDIT; DROP TABLE users','settings']){
      await assert.rejects(()=>a.getSheetHeaders_(sheet),/unsupported|sheet|source/i);
      await assert.rejects(()=>a.getAllRows_(sheet),/unsupported|sheet|source/i);
    }
    for(const column of ['audit_id','row_id','_rowIndex','Draft No; DROP TABLE auth_users']){
      await assert.rejects(()=>a.findRows_('SALES_DRAFT_AUDIT',column,'D-0001'),/column|unsupported/i);
    }
    assert.equal(f.seen.length,0);
    assert.deepEqual(Object.keys(a).sort(),[
      'findFirstRow_','findRowIndex_','findRow_','findRows_',
      'getAllRows_','getSheetHeaders_'
    ].sort());
    for(const name of ['appendRow_','deleteRow_','updateRowFields_',
      'generateDraftInvoiceNo_','postSalesDraft'])
      assert.equal(a[name],undefined);
  }finally{f.close();}
});

test('physical row gaps or NULL cannot return partial archived audit history',async()=>{
  const f=fixture();
  try{
    f.sqlite.exec("UPDATE legacy_sales_draft_audit SET legacy_sheet_row=8 WHERE audit_id='AUD-2'");
    await assert.rejects(()=>f.adapter.getAllRows_('SALES_DRAFT_AUDIT'),/invalid|archive|source|row/i);
    f.sqlite.exec("UPDATE legacy_sales_draft_audit SET legacy_sheet_row=NULL WHERE audit_id='AUD-2'");
    await assert.rejects(()=>f.adapter.findRowIndex_('SALES_DRAFT_AUDIT','Audit ID','AUD-1'),/invalid|archive|source|row/i);
  }finally{f.close();}
});

test('1001st source record is an error, never silently truncated by bounded SELECT',async()=>{
  const f=fixture({seed:false});
  try{
    const full=f.sqlite.prepare('INSERT INTO legacy_sales_draft_audit(legacy_sheet_row,'+
      COLUMNS.join(',')+') VALUES ('+Array(12).fill('?').join(',')+')');
    for(let i=0;i<1001;i++)
      full.run(i+2,'AUD-'+i,'','CREATED','DR-1','D-0001','1','','','','','');
    await assert.rejects(()=>f.adapter.getAllRows_('SALES_DRAFT_AUDIT'),
      /invalid|archive|limit|1000/i);
  }finally{f.close();}
});

test('invalid D1 response, private data, duplicate Audit ID and unsafe provenance fail closed and redact errors',async()=>{
  assert.throws(()=>createSalesDraftAuditReadAdapter({}),/D1|binding/i);
  const first=originals()[0],last=originals()[1];
  const mapped=row=>({legacy_sheet_row:row._rowIndex,
    ...Object.fromEntries(HEADERS.map((name,i)=>[COLUMNS[i],row[name]]))});
  const a=mapped(first),b=mapped(last);
  const getter={...a};
  Object.defineProperty(getter,'note',{enumerable:true,get(){throw Error('SECRET_AUDIT_NOTE');}});
  const invalidReplies=[
    {success:false,results:[]},
    {success:true,results:[null]},
    {success:true,results:[{...a,row_id:900}]},
    {success:true,results:[{...a,audit_id:' '}]},
    {success:true,results:[{...a,draft_id:''}]},
    {success:true,results:[{...a,draft_no:''}]},
    {success:true,results:[{...a,version_text:'0'}]},
    {success:true,results:[{...a,version_text:'2.0'}]},
    {success:true,results:[{...a,version_text:2}]},
    {success:true,results:[{...a,action:'WRONG'}]},
    {success:true,results:[{...a,legacy_sheet_row:2.5}]},
    {success:true,results:[getter]},
    {success:true,results:[a,{...b,audit_id:a.audit_id}]}
  ];
  for(const reply of invalidReplies){
    const reader=createSalesDraftAuditReadAdapter({DB:{
      prepare(){return {bind(){return {async all(){return reply;}}}};}
    }});
    let error;
    try{await reader.getAllRows_('SALES_DRAFT_AUDIT');}catch(e){error=e;}
    assert(error instanceof Error,'invalid D1 archive must never return partial history');
    assert.doesNotMatch(String(error),/SECRET_AUDIT_NOTE|PRIVATE_SQL|row_id/);
  }
  const bad=createSalesDraftAuditReadAdapter({DB:{prepare(){throw Error('PRIVATE_SQL');}}});
  await assert.rejects(()=>bad.getAllRows_('SALES_DRAFT_AUDIT'),err=>
    err instanceof Error&&!String(err).includes('PRIVATE_SQL'));
});
