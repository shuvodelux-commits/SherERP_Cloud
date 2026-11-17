import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {normalizeSalePayments_} from '../src/modules/sale-payments.js';
import {insertSql,row,values} from './fixtures/m02-tile-measurement-rows.mjs';

// RED: no implementation exists before these assertions are committed.
const plan=await import('../src/modules/m06-multi-tile-sale-checkout.js')
  .then(x=>x.previewMultiTileSaleCheckoutCandidateD1)
  .catch(e=>{if(e?.code==='ERR_MODULE_NOT_FOUND')return undefined;throw e;});
const checkout=async(...args)=>{
 assert.equal(typeof plan,'function','M06 multi-Tile checkout preview is missing');
 return plan(...args);
};
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
function seed(db,id,{boxUnit='Carton',perBox=25,length='12',width='8',sqftPrice='38.00'}={}){
 db.prepare("INSERT INTO products(product_id,source_profile,product_name,base_unit_name,selling_price_text,purchase_price_text) VALUES(?,'new',?,'Pcs','5.25','15.00')")
   .run(id,'Synthetic '+id);
 db.prepare("INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name,selling_anchor_unit_name) VALUES(?,1,'Pcs','Pcs')").run(id);
 db.prepare("INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES(?,1,'CTN',?,?)").run(id,boxUnit,String(perBox)+'.000');
 db.prepare(insertSql).run(...values(row(id,{
  length_text:length,width_text:width,pieces_per_box:perBox,
  selling_pricing_unit:'Sqft',selling_sqft_price_override_text:sqftPrice
 })));
 db.prepare('UPDATE products SET current_unit_revision=1 WHERE product_id=?').run(id);
}
function fixture(){
 const db=sqlite();
 seed(db,'T-A');
 seed(db,'T-B',{boxUnit:'Box',perBox:10,length:'12',width:'12',sqftPrice:'25.00'});
 return db;
}
const accounts=()=>[
 {'Bank Account ID':'B1','Account Name':'Bank One','Account Type':'Bank',Status:'Active','Is Deleted':'FALSE'},
 {'Bank Account ID':'M1','Account Name':'Wallet One','Account Type':'Mobile Banking',Status:'Active','Is Deleted':'FALSE'}
];
const pack=(boxes,extraPieces)=>({mode:'pack',boxes,extraPieces});
const area=(requestedSqft,fulfillment='loose')=>({mode:'area',requestedSqft,fulfillment});
const intent=()=>({
 lines:[
  {productId:'T-A',request:pack('2','3')},
  {productId:'T-B',request:pack('1','2')}
 ],
 discount:'42.67',
 payments:[
  {id:'BANK',method:'Bank',accountId:'B1',amount:'500'},
  {id:'MOB',method:'Mobile Banking',accountId:'M1',amount:'300'},
  {id:'CASH',method:'Cash',amount:'850'}
 ]
});
const run=(db,custom=intent(),snapshot={})=>
 checkout(custom,{DB:d1(db),bankAccounts:accounts(),...snapshot});

test('two tile Products keep independent Box/Pcs/Sqft, exact line amounts, original split tender and change',async()=>{
 const db=fixture();
 try{
  const input=intent(),before=structuredClone(input);
  const count=db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n;
  const result=await run(db,input);
  assert.equal(result.lines.length,2);
  assert.deepEqual(result.lines.map(x=>x.productId),['T-A','T-B']);
  assert.deepEqual(result.lines.map(x=>x.quantity.pieces),['53','12']);
  assert.deepEqual(result.lines.map(x=>x.quantity.actualSqft),
    [{numerator:'106',denominator:'3'},{numerator:'12',denominator:'1'}]);
  assert.deepEqual(result.lines.map(x=>x.salePreview.lineAmountMinor),['134267','30000']);
  assert.deepEqual(result.lines.map(x=>x.salePreview.pricingUnit),['Sqft','Sqft']);
  assert.deepEqual(result.lines.map(x=>x.salePreview.unitPriceText),['38.00','25.00']);
  assert.equal(result.subtotal,1642.67);
  assert.equal(result.discount,42.67);
  assert.equal(result.grandTotal,1600);
  assert.deepEqual(result.allocation,normalizeSalePayments_(1600,input.payments,accounts()));
  assert.equal(result.allocation.paidAmount,1600);
  assert.equal(result.allocation.dueAmount,0);
  assert.equal(result.allocation.changeAmount,50);
  assert.deepEqual(result.allocation.payments.map(x=>x.applied),[500,300,800]);
  assert.equal(result.stockAuthority,'not-loaded');
  assert.equal(result.postingAllowed,false);
  assert.ok(result.lines.every(x=>x.salePreview.postingAllowed===false));
  assert.equal(db.prepare('SELECT count(*) n FROM product_tile_measurement_revisions').get().n,count);
  assert.deepEqual(input,before,'Never mutate cart/bank evidence');
  assert.equal(Object.hasOwn(result,'customerId'),false);
  const json=JSON.stringify(result);
  assert.equal(json.includes('purchasePrice'),false);
  assert.equal(json.includes('purchase_price'),false);
  assert.equal(json.includes('session'),false);
 }finally{db.close();}
});

test('two-area tiles calculate fulfilled physical Pcs and exact monetary total, not rounded display sqft',async()=>{
 const db=fixture();
 try{
  const input=intent();
  input.lines[0].request=area('35.50');
  input.lines[1].request=area('12','box-only');
  input.discount='0';
  input.payments=[];
  const out=await run(db,input);
  assert.deepEqual(out.lines.map(x=>x.quantity.pieces),['54','20']);
  assert.deepEqual(out.lines.map(x=>x.quantity.displaySqft),['36.00','20.00']);
  assert.equal(out.subtotal,1868);
  assert.equal(out.grandTotal,1868);
  assert.equal(out.allocation.paymentStatus,'Due');
  assert.equal(out.allocation.dueAmount,1868);
 }finally{db.close();}
});

test('duplicate Product ID in one checkout must reject double listing instead of confusing original FIFO ownership',async()=>{
 const db=fixture();try{
  const x=intent();x.lines.push({productId:'T-A',request:pack('0','1')});
  await assert.rejects(()=>run(db,x),/duplicate|one logical|product/i);
 }finally{db.close();}
});

test('missing and inactive/deleted Tile or Bundle cannot be quoted as sale',async()=>{
 const db=fixture();try{
  for(const productId of ['MISSING','NOT-TILE']){
   const x=intent();x.lines=[{productId,request:pack('1','0')}];x.payments=[];
   await assert.rejects(()=>run(db,x),/NEEDS_REVIEW|tile|product/i);
  }
  for(const patch of ["status='Inactive'","is_deleted=1","product_type_text='Bundle'"]){
   db.prepare("UPDATE products SET status='Active',is_deleted=0,product_type_text='' WHERE product_id='T-B'").run();
   db.prepare("UPDATE products SET "+patch+" WHERE product_id='T-B'").run();
   await assert.rejects(()=>run(db),/NEEDS_REVIEW/i);
  }
 }finally{db.close();}
});

test('caller-supplied factor, revision, selling price, role and Customer cannot be promoted to source authority',async()=>{
 const db=fixture();try{
  for(const extra of [
   {unitPriceText:'0.01'},{pricingUnit:'Pcs'},{revision:1},
   {conversionFactor:'1'},{approved:true},{customerId:'C-FORGED'}
  ]){
   const x=intent();Object.assign(x.lines[0],extra);
   await assert.rejects(()=>run(db,x),/unsupported|untrusted|invalid/i);
  }
  for(const extra of [{actorId:'STAFF'},{authorized:true},{customerId:'FAKE'}]){
   const x=intent();Object.assign(x,extra);
   await assert.rejects(()=>run(db,x),/unsupported|untrusted|invalid/i);
  }
 }finally{db.close();}
});

test('conflicting trusted payment account IDs fail before source split allocation',async()=>{
 const db=fixture();try{
  const dup=accounts();dup.push({...dup[0]});
  await assert.rejects(()=>run(db,intent(),{bankAccounts:dup}),/duplicate|ambiguous/i);
 }finally{db.close();}
});

test('invalid exact discount, too many tender rows, forged bank method and missing source account reject',async()=>{
 const db=fixture();try{
  for(const discount of ['1.001','-1','1e2','NaN']){
   const x=intent();x.discount=discount;
   await assert.rejects(()=>run(db,x),/decimal|amount|discount/i);
  }
  const wrong=intent();wrong.payments[0].accountId='M1';
  await assert.rejects(()=>run(db,wrong),/account type/i);
  const missing=intent();missing.payments[0].accountId='NO-SUCH';
  await assert.rejects(()=>run(db,missing),/active payment account/i);
  const tooMany=intent();tooMany.payments=Array.from({length:21},(_,i)=>({
   id:'C-'+i,method:'Bank',accountId:'B1',amount:1
  }));
  await assert.rejects(()=>run(db,tooMany),/Too many payment rows/i);
 }finally{db.close();}
});

test('same source discounts exceeding subtotal clamp Grand to zero with no payment, Cash tender forbidden',async()=>{
 const db=fixture();try{
  const x=intent();x.discount='2000';x.payments=[];
  const v=await run(db,x);
  assert.equal(v.grandTotal,0);
  assert.equal(v.allocation.paymentStatus,'Paid');
  assert.equal(v.allocation.paymentMethod,'');
  x.payments=[{id:'C',method:'Cash',amount:5}];
  await assert.rejects(()=>run(db,x),/zero-value invoice/i);
 }finally{db.close();}
});

test('invalid and accessor-backed physical requests, payment rows and bank account rows are refused',async()=>{
 const db=fixture();try{
  const x=intent();
  Object.defineProperty(x.lines[0].request,'boxes',{get(){throw Error('NEVER_CALL_GETTER')}});
  await assert.rejects(()=>run(db,x),/untrusted|accessor|invalid|unsupported/i);
  const y=intent();Object.defineProperty(y.payments[0],'amount',{get(){throw Error('NEVER_CALL_GETTER')}});
  await assert.rejects(()=>run(db,y),/untrusted|accessor|invalid|unsupported/i);
  const bank=accounts();Object.defineProperty(bank[0],'Bank Account ID',{get(){throw Error('NEVER_CALL_GETTER')}});
  await assert.rejects(()=>run(db,intent(),{bankAccounts:bank}),/untrusted|accessor|invalid|unsupported/i);
 }finally{db.close();}
});

test('empty cart, unsafe huge cart money and zero/negative physical requests fail closed',async()=>{
 const db=fixture();try{
  const empty=intent();empty.lines=[];
  await assert.rejects(()=>run(db,empty),/empty|cart|line/i);
  const bad=intent();bad.lines[0].request=pack('0','0');
  await assert.rejects(()=>run(db,bad));
  const large=intent();large.lines[0].request=pack('9007199254740993','0');
  await assert.rejects(()=>run(db,large),/safe|range|quantity|review/i);
 }finally{db.close();}
});

test('historical current-revision quote and original account names are preserved, no global state writes',async()=>{
 const db=fixture();try{
  const first=await run(db);
  const money=JSON.stringify(first.lines[0]);
  assert.equal(money.includes('purchasePriceText'),false);
  assert.equal(first.lines[0].quantity.measurementSnapshot.revision,'1');
  assert.equal(first.allocation.payments[0].bankAccountName,'Bank One');
  db.prepare("UPDATE product_tile_measurement_revisions SET selling_sqft_price_override_text='50.00' WHERE product_id='T-A' AND revision=1").run();
  const now=await run(db);
  assert.equal(first.lines[0].salePreview.lineAmountMinor,'134267');
  assert.equal(now.lines[0].salePreview.lineAmountMinor,'176667');
 }finally{db.close();}
});
