import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createStockLotCostAuditReadAdapter}
  from '../src/db/stock-lot-cost-history-read.js';

const HEADERS=[
  'Correction ID','Date','Lot ID','Product ID','Product Name','Source',
  'Old Purchase Price','New Purchase Price','Original Quantity',
  'Remaining Quantity','Matched Historical Quantity','Affected Invoice Count',
  'Historical COGS Delta','Reason','Corrected By','Created At'
];
const COLUMNS=[
  'correction_id','date_text','lot_id','product_id','product_name','source',
  'old_purchase_price_text','new_purchase_price_text','original_quantity_text',
  'remaining_quantity_text','matched_historical_quantity_text',
  'affected_invoice_count_text','historical_cogs_delta_text','reason',
  'corrected_by','created_at_text'
];
const input=()=>[
  {'Correction ID':'COR-1',Date:'2026-11-17T10:00Z',
    'Lot ID':'LOT-1','Product ID':'PROD-1','Product Name':'তার',
    Source:'PUR-1','Old Purchase Price':'-0.00',
    'New Purchase Price':'12.50','Original Quantity':'20',
    'Remaining Quantity':'12.00','Matched Historical Quantity':'8',
    'Affected Invoice Count':'2','Historical COGS Delta':'-17.250',
    Reason:'  revised 🧾  ','Corrected By':'রহিম',
    'Created At':'2026-11-17T10:01Z',_rowIndex:2},
  {'Correction ID':'COR-2',Date:'2026-11-17T11:00Z',
    'Lot ID':'LOT-1','Product ID':'PROD-1','Product Name':'তার',
    Source:'PUR-1','Old Purchase Price':'12.50',
    'New Purchase Price':'9.750','Original Quantity':'20',
    'Remaining Quantity':'0','Matched Historical Quantity':'20',
    'Affected Invoice Count':'3','Historical COGS Delta':'-1.00',
    Reason:' changed ','Corrected By':'মিতা',
    'Created At':'2026-11-17T11:01Z',_rowIndex:3}
];

function fixture({seed=true}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE legacy_stock_lot_cost_corrections ('+
    'row_id INTEGER PRIMARY KEY AUTOINCREMENT, legacy_sheet_row INTEGER, '+
    COLUMNS.map(c=>c+' TEXT NOT NULL').join(',')+') STRICT');
  const insert=sqlite.prepare('INSERT INTO legacy_stock_lot_cost_corrections ('+
    'legacy_sheet_row,'+COLUMNS.join(',')+') VALUES ('+
    Array(17).fill('?').join(',')+')');
  if(seed)for(const row of input())
    insert.run(row._rowIndex,...HEADERS.map(h=>row[h]));
  const seen=[];
  const DB={prepare(sql){
    const statement=sqlite.prepare(sql);
    const call={sql,params:undefined};
    seen.push(call);
    return {bind(...params){
      call.params=params;
      return {async all(){return {success:true,results:statement.all(...params)}}};
    }};
  }};
  return {sqlite,seen,read:createStockLotCostAuditReadAdapter({DB}),
    close:()=>sqlite.close()};
}

test('Config.gs freezes the exact sixteen STOCK_LOT_COST_CORRECTIONS source headings',()=>{
  const file=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  const start=file.indexOf('    STOCK_LOT_COST_CORRECTIONS: [');
  assert(start>=0);
  const end=file.indexOf('    ],',start);
  assert(end>start);
  assert.deepEqual([...file.slice(start,end).matchAll(/"([^"]+)"/g)].map(x=>x[1]),HEADERS);
});

test('private historical reader preserves signed COGS, -0.00, decimal spelling, UTF-8 and source row index',async()=>{
  const f=fixture();
  try{
    const headers=await f.read.getSheetHeaders_('STOCK_LOT_COST_CORRECTIONS');
    assert.deepEqual(headers,HEADERS);
    headers[0]='MUTATED';
    assert.deepEqual(await f.read.getSheetHeaders_('STOCK_LOT_COST_CORRECTIONS'),HEADERS);
    const rows=await f.read.getAllRows_('STOCK_LOT_COST_CORRECTIONS');
    assert.deepEqual(rows,input());
    assert.deepEqual(Object.keys(rows[0]),[...HEADERS,'_rowIndex']);
    assert.equal(rows[0]['Old Purchase Price'],'-0.00');
    assert.equal(rows[0]['Historical COGS Delta'],'-17.250');
    assert.equal(rows[1]['New Purchase Price'],'9.750');
    assert.equal(rows[0].Reason,'  revised 🧾  ');
    assert.equal(rows[0].then,undefined);
    assert.equal(rows[0].row_id,undefined);
    rows[0].Reason='modified in client';
    assert.deepEqual(await f.read.getAllRows_('STOCK_LOT_COST_CORRECTIONS'),input(),
      'history must not cache source rows');
    assert(f.seen.every(x=>
      /^SELECT\s/i.test(x.sql) &&
      /ORDER BY legacy_sheet_row ASC LIMIT\s+\?/i.test(x.sql) &&
      x.params?.length===1 && x.params[0]===1001));
  }finally{f.close();}
});

test('original source read helpers return repeated Lot IDs but distinct Correction IDs',async()=>{
  const f=fixture();
  try{
    const a=f.read;
    assert.deepEqual(await a.findRows_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1'),input());
    assert.deepEqual(await a.findRows_('STOCK_LOT_COST_CORRECTIONS','Product ID','PROD-1'),input());
    assert.deepEqual(await a.findFirstRow_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1'),input()[0]);
    assert.deepEqual(await a.findRow_('STOCK_LOT_COST_CORRECTIONS','Correction ID','COR-2'),{
      row:input()[1],rowIndex:3
    });
    assert.equal(await a.findRowIndex_('STOCK_LOT_COST_CORRECTIONS','Correction ID','COR-2'),3);
    assert.equal(await a.findRowIndex_('STOCK_LOT_COST_CORRECTIONS','Correction ID','no match'),-1);
    assert.equal(await a.findFirstRow_('STOCK_LOT_COST_CORRECTIONS','New Purchase Price','9.75'),null);
    assert.equal(await a.findFirstRow_('STOCK_LOT_COST_CORRECTIONS','Reason','revised 🧾'),null);
  }finally{f.close();}
});

test('empty archive is safe and does not infer live stock or current cost',async()=>{
  const f=fixture({seed:false});
  try{
    const a=f.read;
    assert.deepEqual(await a.getAllRows_('STOCK_LOT_COST_CORRECTIONS'),[]);
    assert.deepEqual(await a.findRows_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1'),[]);
    assert.equal(await a.findFirstRow_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1'),null);
    assert.equal(await a.findRow_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1'),null);
    assert.equal(await a.findRowIndex_('STOCK_LOT_COST_CORRECTIONS','Lot ID','LOT-1'),-1);
  }finally{f.close();}
});

test('untrusted Sheet/column input rejects before D1; adapter exports six readers and no writers',async()=>{
  const f=fixture();
  try{
    for(const sheet of ['STOCK_LOTS','SALES','STOCK_LOT_COST_CORRECTIONS; DROP TABLE auth_users']){
      await assert.rejects(()=>f.read.getAllRows_(sheet),/Unsupported|source|sheet/i);
      await assert.rejects(()=>f.read.getSheetHeaders_(sheet),/Unsupported|source|sheet/i);
    }
    for(const field of ['lot_id','row_id','_rowIndex','Lot ID; DROP TABLE users']){
      await assert.rejects(()=>f.read.findRows_('STOCK_LOT_COST_CORRECTIONS',field,'LOT-1'),/Unsupported|column/i);
    }
    assert.equal(f.seen.length,0);
    assert.deepEqual(Object.keys(f.read).sort(),
      ['getSheetHeaders_','getAllRows_','findRows_','findFirstRow_','findRow_','findRowIndex_'].sort());
    for(const unsafe of ['appendRow_','updateRowFields_','deleteRow_','correctInternalStockLotCosts','postSale']){
      assert.equal(f.read[unsafe],undefined);
    }
  }finally{f.close();}
});

test('physical gap or NULL cannot misidentify historical lot costs',async()=>{
  const f=fixture();
  try{
    f.sqlite.exec("UPDATE legacy_stock_lot_cost_corrections SET legacy_sheet_row=9 WHERE correction_id='COR-2'");
    await assert.rejects(()=>f.read.getAllRows_('STOCK_LOT_COST_CORRECTIONS'),/archive|source|invalid/i);
    f.sqlite.exec("UPDATE legacy_stock_lot_cost_corrections SET legacy_sheet_row=NULL WHERE correction_id='COR-2'");
    await assert.rejects(()=>f.read.findRowIndex_('STOCK_LOT_COST_CORRECTIONS','Correction ID','COR-1'),/archive|source|invalid/i);
  }finally{f.close();}
});

test('1001 rows cannot silently truncate archived COGS evidence',async()=>{
  const f=fixture({seed:false});
  try{
    const insert=f.sqlite.prepare('INSERT INTO legacy_stock_lot_cost_corrections ('+
      'legacy_sheet_row,'+COLUMNS.join(',')+') VALUES ('+
      Array(17).fill('?').join(',')+')');
    for(let i=0;i<1001;i++){
      const row=input()[0];
      insert.run(i+2,'COR-'+i,...HEADERS.slice(1).map(h=>row[h]));
    }
    await assert.rejects(()=>f.read.getAllRows_('STOCK_LOT_COST_CORRECTIONS'),/archive|limit|invalid/i);
  }finally{f.close();}
});

test('malformed D1 reply, duplicate correction, accessor, non-TEXT or secret exception fails closed',async()=>{
  assert.throws(()=>createStockLotCostAuditReadAdapter({}),/D1|binding/i);
  const shape=(row)=>({legacy_sheet_row:row._rowIndex,
    ...Object.fromEntries(HEADERS.map((header,i)=>[COLUMNS[i],row[header]]))});
  const a=shape(input()[0]),b=shape(input()[1]);
  const accessor={...a};
  Object.defineProperty(accessor,'reason',{enumerable:true,get(){throw Error('PRIVATE_REASON_SECRET')}});
  for(const reply of [
    {success:false,results:[]},{success:true,results:[null]},
    {success:true,results:[{...a,row_id:99}]},
    {success:true,results:[{...a,correction_id:'  '}]},
    {success:true,results:[{...a,lot_id:''}]},
    {success:true,results:[{...a,product_id:''}]},
    {success:true,results:[{...a,old_purchase_price_text:-0}]},
    {success:true,results:[{...a,legacy_sheet_row:2.5}]},
    {success:true,results:[accessor]},
    {success:true,results:[a,{...b,correction_id:'COR-1'}]}
  ]){
    const read=createStockLotCostAuditReadAdapter({DB:{
      prepare(){return {bind(){return {all:async()=>reply}}};}
    }});
    let error;
    try{await read.getAllRows_('STOCK_LOT_COST_CORRECTIONS');}catch(e){error=e;}
    assert(error instanceof Error,'invalid D1 must not return historical rows');
    assert.doesNotMatch(String(error),/PRIVATE_REASON_SECRET|old_purchase_price|row_id|COR-1/);
  }
  const read=createStockLotCostAuditReadAdapter({DB:{
    prepare(){throw Error('PRIVATE_SQL_AND_ACTOR')}
  }});
  await assert.rejects(()=>read.getAllRows_('STOCK_LOT_COST_CORRECTIONS'),
    e=>e instanceof Error&&!String(e).includes('PRIVATE_SQL_AND_ACTOR'));
});
