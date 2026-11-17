import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {insertSql,row,values} from './fixtures/m02-tile-measurement-rows.mjs';

// Superpowers RED: independent M06-only UI/checkout composition is absent
// on this commit. Do not register it as a public RPC or a database writer.
const loaded=await import('../src/modules/m06-posv2-unified-cart-preview.js')
  .then(x=>x.previewPosV2UnifiedCartCandidateD1)
  .catch(e=>{if(e?.code==='ERR_MODULE_NOT_FOUND')return undefined;throw e;});
const preview=(...args)=>{
  assert.equal(typeof loaded,'function','M06 POS V2 unified multi-unit+Tile cart preview is missing');
  return loaded(...args);
};

const product=(id,name,unit,price,stock)=>({
 'Product ID':id,'Product Name':name,'Product Type':'Standard',
 Unit:unit,'Selling Price':price,'Current Stock':stock,
 Status:'Active','Is Deleted':'FALSE'
});
const conversion=(id,name,factor,price)=>({
 'Conversion ID':id,'Product ID':'P-MIX','Unit Name':name,
 'Conversion Factor':factor,'Selling Price':price,'Sort Order':1,
 Status:'Active','Is Deleted':'FALSE'
});
const lot=(id,productId,day,qty,sell)=>({
 'Lot ID':id,'Product ID':productId,'Purchase Date':day,
 'Remaining Quantity':qty,'Sell Price':sell,'Purchase Price':5,
 Status:'Active','Is Deleted':'FALSE'
});
const accounts=()=>[
 {'Bank Account ID':'BANK-1','Account Name':'Account One','Account Type':'Bank',Status:'Active'},
 {'Bank Account ID':'MOB-1','Account Name':'Wallet One','Account Type':'Mobile Banking',Status:'Active'}
];
function sqlite(){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');
 const dir=new URL('../migrations/',import.meta.url);
 for(const name of readdirSync(dir).filter(x=>/^\d{4}_.+\.sql$/.test(x)).sort())
  db.exec(readFileSync(new URL(name,dir),'utf8'));
 return db;
}
function d1(db){
 return {prepare(sql){return {bind(...args){return {
   async first(){return db.prepare(sql).get(...args)??null;},
   async all(){return {success:true,results:db.prepare(sql).all(...args)};}
 };}};}};
}
function seedTile(db){
 db.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name,selling_price_text,purchase_price_text) VALUES('T-A','new','Wall Tile','Pcs','5.25','15.00')").run();
 db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,selling_anchor_unit_name) VALUES('T-A',1,'Pcs','Pcs')").run();
 db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES('T-A',1,'CTN','Carton','25.000')").run();
 db.prepare(insertSql).run(...values(row('T-A',{
   length_text:'12',width_text:'8',pieces_per_box:25,
   selling_pricing_unit:'Sqft',selling_sqft_price_override_text:'38.00'
 })));
 db.prepare("UPDATE products SET current_unit_revision=1 WHERE product_id='T-A'").run();
}
function snapshot(db){
 return {
  products:[product('P-MIX','Fasteners','Pcs',10,145),product('P-PIPE','Pipe','Feet',30,10)],
  conversionRows:[conversion('C-BAG','Bag',100,900),conversion('C-BOX','Box',20,190)],
  stockLots:[
   lot('L-OLD','P-MIX','2026-11-10',100,10),
   lot('L-NEW','P-MIX','2026-11-12',45,12),
   lot('L-PIPE','P-PIPE','2026-11-10',10,30)
  ],
  bankAccounts:accounts(),DB:d1(db)
 };
}
const standard=()=>({
 kind:'Standard',productId:'P-MIX',claimedBaseQty:145,shortageMode:'Own',
 unitBreakdown:[
  {conversionId:'C-BAG',qty:1},
  {conversionId:'C-BOX',qty:2},
  {conversionId:'BASE',qty:5}
 ]
});
const tile=()=>({
 kind:'Tile',productId:'T-A',
 request:{mode:'pack',boxes:'2',extraPieces:'3'}
});
const mixed=()=>({
 lines:[standard(),tile()],
 discount:'42.67',
 payments:[
  {id:'B-1',method:'Bank',accountId:'BANK-1',amount:'500'},
  {id:'M-1',method:'Mobile Banking',accountId:'MOB-1',amount:'300'},
  {id:'C-1',method:'Cash',amount:'2000'}
 ]
});

test('one POS V2 cart previews Standard Bag/Box/Pcs plus Tile Carton/Pcs/Sqft as two logical lines and one exact tender',async()=>{
 const db=sqlite();
 try{
  seedTile(db);
  const initial=mixed(),trusted=snapshot(db),before=structuredClone(initial);
  const stockBefore=db.prepare("SELECT current_unit_revision FROM products WHERE product_id='T-A'").get();
  const result=await preview(initial,trusted);
  assert.equal(result.postingAllowed,false);
  assert.equal(result.stockAuthority,'not-loaded');
  assert.deepEqual(result.lines.map(x=>[x.productId,x.kind]),[
   ['P-MIX','Standard'],['T-A','Tile']
  ]);
  assert.deepEqual(result.lines.map(x=>x.quantityLabel),[
   '1 Bag + 2 Box + 5 Pcs',
   '2 Carton + 3 Pcs · 35.33 Sqft'
  ]);
  assert.deepEqual(result.lines.map(x=>[x.baseQty,x.stockUnit]),[
   [145,'Pcs'],[53,'Pcs']
  ]);
  assert.deepEqual(result.lines.map(x=>x.lineAmountMinor),['134000','134267']);
  assert.equal(result.lines[0].lineTotal,1340);
  assert.equal(result.lines[1].lineTotal,1342.67);
  assert.notEqual(result.lines[0].unitPrice*145,1340,
   'never multiply rounded effective per-base price into money');
  assert.deepEqual(result.lines[0].unitBreakdownSnapshot.map(x=>x.factor),[100,20,1]);
  assert.deepEqual(result.lines[0].unitPricingSnapshot.map(x=>x.unitPrice),[900,190,12]);
  assert.equal(result.lines[1].tileRevision,'1');
  assert.deepEqual(result.lines[1].actualSqft,{numerator:'106',denominator:'3'});
  assert.equal(result.lines[1].displaySqft,'35.33');
  assert.equal(result.lines[1].priceSnapshot.pricingUnit,'Sqft');
  assert.equal(result.subtotal,2682.67);
  assert.equal(result.discount,42.67);
  assert.equal(result.grandTotal,2640);
  assert.deepEqual(result.allocation.payments.map(x=>x.applied),[500,300,1840]);
  assert.equal(result.allocation.changeAmount,160);
  assert.equal(result.allocation.dueAmount,0);
  assert.equal(result.lines.every(x=>x.postingAllowed===false),true);
  assert.deepEqual(initial,before,'browser intent must not be mutated');
  assert.deepEqual(db.prepare("SELECT current_unit_revision FROM products WHERE product_id='T-A'").get(),stockBefore);
 }finally{db.close();}
});

test('legacy POS V2 single-unit item stays one sale line and all-Due remains source-compatible',async()=>{
 const input={lines:[{
  kind:'Standard',productId:'P-PIPE',claimedBaseQty:2,
  shortageMode:'Own',unitBreakdown:[]
 }],discount:'0',payments:[]};
 const result=await preview(input,snapshot(null));
 assert.deepEqual(result.lines.map(x=>x.quantityLabel),['2 Feet']);
 assert.deepEqual(result.lines.map(x=>x.lineAmountMinor),['6000']);
 assert.equal(result.grandTotal,60);
 assert.equal(result.allocation.paymentStatus,'Due');
 assert.equal(result.allocation.dueAmount,60);
 assert.equal(result.postingAllowed,false);
});

test('same Product ID cannot appear twice, including across Standard/Tile kinds',async()=>{
 const db=sqlite();try{
  seedTile(db);
  const x=mixed();x.lines.push({...standard()});
  await assert.rejects(()=>preview(x,snapshot(db)),/duplicate|product/i);
  const y=mixed();y.lines=[{...standard(),productId:'T-A'},tile()];
  await assert.rejects(()=>preview(y,snapshot(db)),/duplicate|product/i);
 }finally{db.close();}
});

test('browser cannot promote unit factor, price, revision, actor, Party or approval into quote authority',async()=>{
 const db=sqlite();try{
  seedTile(db);
  const variants=[
   x=>{x.lines[0].unitBreakdown[0].factor=1;},
   x=>{x.lines[0].unitBreakdown[0].unitPrice=0;},
   x=>{x.lines[1].revision='2';},
   x=>{x.lines[1].request.sellingPrice='0.01';},
   x=>{x.actorId='FORGED';},
   x=>{x.authorized=true;},
   x=>{x.customerId='UNREVIEWED';},
   x=>{x.lines[1].request={mode:'pack',boxes:'2',extraPieces:'3',claimedSqft:'999'};}
  ];
  for(const change of variants){
   const x=mixed();change(x);
   await assert.rejects(()=>preview(x,snapshot(db)),/untrusted|invalid|unsupported|field/i);
  }
  const quantity=mixed();quantity.lines[0].claimedBaseQty=144;
  await assert.rejects(()=>preview(quantity,snapshot(db)),/quantity|match/i);
 }finally{db.close();}
});

test('source Bank/Mobile account and exact money policy apply to the combined total once',async()=>{
 const db=sqlite();try{
  seedTile(db);
  const x=mixed();x.payments=[{
   id:'BANK',method:'Bank',accountId:'BANK-1',amount:'3000'
  }];
  await assert.rejects(()=>preview(x,snapshot(db)),/exceed|invoice total/i);
  x.payments=[{id:'C',method:'Cash',amount:'0'}];
  await assert.rejects(()=>preview(x,snapshot(db)),/positive|zero|cash/i);
  x.payments=[];x.discount='9999';
  const zero=await preview(x,snapshot(db));
  assert.equal(zero.grandTotal,0);
  assert.equal(zero.allocation.paymentStatus,'Paid');
  x.discount='0.001';
  await assert.rejects(()=>preview(x,snapshot(db)),/decimal|amount/i);
 }finally{db.close();}
});

test('malicious getters, sparse unit data and missing trusted Tile DB are rejected safely',async()=>{
 const db=sqlite();try{
  seedTile(db);
  const x=mixed();let called=0;
  Object.defineProperty(x.lines[1].request,'boxes',{
   enumerable:true,get(){called++;throw new Error('DO_NOT_EXECUTE');}
  });
  await assert.rejects(()=>preview(x,snapshot(db)),/invalid|accessor|trusted/i);
  assert.equal(called,0);
  const y=mixed();Object.defineProperty(y.lines[0].unitBreakdown[0],'qty',{
   enumerable:true,get(){called++;throw new Error('DO_NOT_EXECUTE');}
  });
  await assert.rejects(()=>preview(y,snapshot(db)),/invalid|accessor|trusted/i);
  assert.equal(called,0);
  const z=mixed();const trusted=snapshot(db);delete trusted.DB;
  await assert.rejects(()=>preview(z,trusted),/Tile|DB|trusted|binding/i);
  const hole=mixed();delete hole.lines[0].unitBreakdown[1];
  await assert.rejects(()=>preview(hole,snapshot(db)),/sparse|invalid|trusted/i);
 }finally{db.close();}
});

test('invalid/deleted Tile, stale standard pricing and duplicates cannot fabricate a sale preview',async()=>{
 const db=sqlite();try{
  seedTile(db);
  const trusted=snapshot(db);
  db.prepare("UPDATE products SET status='Inactive' WHERE product_id='T-A'").run();
  await assert.rejects(()=>preview(mixed(),trusted),/NEEDS_REVIEW|inactive|tile/i);
  db.prepare("UPDATE products SET status='Active' WHERE product_id='T-A'").run();
  trusted.conversionRows[0]['Is Deleted']='TRUE';
  await assert.rejects(()=>preview(mixed(),trusted),/unit conversion|available/i);
  const bad=mixed();bad.lines=[];
  await assert.rejects(()=>preview(bad,trusted),/cart|empty|line/i);
 }finally{db.close();}
});

test('private display output never exports FIFO lot IDs, purchase costs, source DB, session or Party identity',async()=>{
 const db=sqlite();try{
  seedTile(db);const result=await preview(mixed(),snapshot(db));
  const serialized=JSON.stringify(result);
  for(const value of ['L-OLD','L-NEW','L-PIPE','Purchase Price','purchasePrice',
   'purchase_price','actorId','sessionId','customerId','tenantId','bankAccountIds'])
   assert.equal(serialized.includes(value),false,value+' must not leak to POS');
  assert.equal(result.postingAllowed,false);
  assert.equal(result.lines.every(x=>x.postingAllowed===false),true);
 }finally{db.close();}
});
