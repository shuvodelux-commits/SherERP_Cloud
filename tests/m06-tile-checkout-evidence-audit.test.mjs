import test from 'node:test';
import assert from 'node:assert/strict';
import {priceTileQuantity} from '../src/modules/tile-quantity-contract.js';
import {normalizeSalePayments_} from '../src/modules/sale-payments.js';

// RED: these source contract assertions are committed before the new audit.
const auditFn=await import('../src/modules/m06-tile-checkout-evidence-audit.js')
 .then(x=>x.auditMultiTileSaleCheckoutEvidence)
 .catch(e=>{if(e?.code==='ERR_MODULE_NOT_FOUND')return undefined;throw e;});
function audit(input){
 assert.equal(typeof auditFn,'function','Missing M06 Tile checkout evidence audit');
 return auditFn(input);
}
const config=(id,perBox,length,width,boxUnitName='Box')=>({
 productId:id,revision:'1',baseUnit:'Pcs',boxConversionId:'CTN',
 boxUnitName,length,width,dimensionUnit:'in',
 piecesPerBox:String(perBox),coveragePolicy:'nominal'
});
function line(c,request,unitPriceText){
 const priced=priceTileQuantity(c,request,'Sqft',unitPriceText);
 return {
  productId:c.productId,productName:'Tile '+c.productId,revision:c.revision,
  stockUnit:'Pcs',quantity:priced.quantity,
  salePreview:{
   mode:'read-only-sale-quote',pricingUnit:'Sqft',unitPriceText,
   billingQuantity:priced.billingQuantity,
   billingQuantityDisplay:priced.billingQuantityDisplay,
   exactAmount:priced.exactAmount,
   lineAmountMinor:priced.lineAmountMinor,
   roundingDeltaMinor:priced.displayQuantityAmountDeltaMinor,
   priceSnapshot:priced.priceSnapshot,postingAllowed:false
  },
  lineTotal:Number(priced.lineAmountMinor)/100,
  stockAuthority:'not-loaded',postingAllowed:false
 };
}
const accounts=()=>[
 {'Bank Account ID':'B1','Account Name':'Bank One','Account Type':'Bank',Status:'Active','Is Deleted':'FALSE'},
 {'Bank Account ID':'M1','Account Name':'Mobile One','Account Type':'Mobile Banking',Status:'Active','Is Deleted':'FALSE'}
];
const paymentIntent=()=>[
 {id:'BANK',method:'Bank',accountId:'B1',amount:'500'},
 {id:'MOB',method:'Mobile Banking',accountId:'M1',amount:'300'},
 {id:'CASH',method:'Cash',amount:'850'}
];
function preview(){
 const lines=[
  line(config('T-A',25,'12','8','Carton'),{mode:'pack',boxes:'2',extraPieces:'3'},'38.00'),
  line(config('T-B',10,'12','12'),{mode:'pack',boxes:'1',extraPieces:'2'},'25.00')
 ];
 const subtotal=lines.reduce((x,l)=>x+l.lineTotal,0);
 const discount=42.67,grandTotal=1600;
 assert.equal(subtotal,1642.67);
 return {
  lines,subtotal,discount,grandTotal,
  allocation:normalizeSalePayments_(grandTotal,paymentIntent(),accounts()),
  stockAuthority:'not-loaded',postingAllowed:false
 };
}
function has(out,code){assert.ok(out.issues.some(x=>x.code===code),JSON.stringify(out.issues));}

test('exact two-Tile rational Sqft and original split tender are consistent without posting',()=>{
 const input=preview(),original=structuredClone(input);
 const out=audit(input);
 assert.equal(out.ready,true,JSON.stringify(out.issues));
 assert.equal(out.postingAllowed,false);
 assert.deepEqual(out.issues,[]);
 assert.deepEqual(out.summary,{
  lines:2,subtotalMinor:'164267',discountMinor:'4267',
  grandMinor:'160000',paidMinor:'160000',dueMinor:'0',changeMinor:'5000'
 });
 assert.deepEqual(input,original,'audit may not mutate caller-supplied evidence');
});
test('rounded Sqft display is not multiplied into the actual line amount',()=>{
 const x=preview();assert.equal(x.lines[0].quantity.displaySqft,'35.33');
 assert.equal(x.lines[0].salePreview.lineAmountMinor,'134267');
 assert.equal(audit(x).ready,true);
});
test('changed saved physical area, Box or pieces invalidate historical measurement proof',()=>{
 for(const change of [
  x=>{x.lines[0].quantity.actualSqft.numerator='107';},
  x=>{x.lines[0].quantity.pieces='52';},
  x=>{x.lines[0].quantity.boxes='1';},
  x=>{x.lines[0].quantity.displaySqft='35.32';}
 ]){const x=preview();change(x);has(audit(x),'TILE_QUANTITY_MISMATCH');}
});
test('product, original revision and pricing snapshot substitutions reject without current catalog reads',()=>{
 for(const [change,code] of [
  [x=>{x.lines[0].quantity.measurementSnapshot.productId='OTHER';},'PRODUCT_REVISION_MISMATCH'],
  [x=>{x.lines[0].revision='2';},'PRODUCT_REVISION_MISMATCH'],
  [x=>{x.lines[0].salePreview.priceSnapshot.unitPriceText='0.01';},'PRICE_SNAPSHOT_MISMATCH'],
  [x=>{x.lines[0].salePreview.pricingUnit='Box';},'TILE_QUOTE_MISMATCH'],
  [x=>{x.lines[0].salePreview.lineAmountMinor='134266';},'TILE_QUOTE_MISMATCH']
 ]){const x=preview();change(x);has(audit(x),code);}
});
test('duplicate logical Product IDs and quote cents vs display money reject',()=>{
 const x=preview();x.lines[1].productId='T-A';has(audit(x),'DUPLICATE_PRODUCT_ID');
 const y=preview();y.lines[0].lineTotal=1342.68;has(audit(y),'LINE_AMOUNT_MISMATCH');
});
test('original subtotal, discount clamp and Grand are integer-paisa conserved',()=>{
 for(const [field,value,code] of [
  ['subtotal',1642.68,'SUBTOTAL_MISMATCH'],
  ['discount',42.68,'GRAND_TOTAL_MISMATCH'],
  ['grandTotal',1599.99,'GRAND_TOTAL_MISMATCH']
 ]){const x=preview();x[field]=value;has(audit(x),code);}
 const x=preview();x.discount=1700;x.grandTotal=0;x.allocation=normalizeSalePayments_(0,[],accounts());
 assert.equal(audit(x).ready,true,'source discount greater than subtotal clamps Grand at zero');
});
test('invoice header paid/due and Cash returned change are independently conserved',()=>{
 const x=preview();x.allocation.paidAmount=1599.99;has(audit(x),'PAID_DUE_MISMATCH');
 const y=preview();y.allocation.changeAmount=49;has(audit(y),'CASH_CHANGE_MISMATCH');
 const z=preview();z.allocation.payments[2].tendered=849;has(audit(z),'CASH_TENDER_MISMATCH');
});
test('Bank and Mobile cannot create change or lose their original account ID',()=>{
 const x=preview();x.allocation.payments[0].change=1;has(audit(x),'NONCASH_TENDER_MISMATCH');
 const y=preview();y.allocation.payments[1].bankAccountId='';has(audit(y),'NONCASH_ACCOUNT_MISMATCH');
});
test('duplicate payment row identifiers/orders and source payment header drift reject',()=>{
 const x=preview();x.allocation.payments[1].rowId='BANK';has(audit(x),'DUPLICATE_PAYMENT_ROW_ID');
 const y=preview();y.allocation.payments[2].rowOrder=1;has(audit(y),'DUPLICATE_PAYMENT_ORDER');
 const z=preview();z.allocation.paymentMethod='Cash';has(audit(z),'PAYMENT_HEADER_MISMATCH');
});
test('no-stock preview and postingAllowed=false cannot be forged into posting authorization',()=>{
 const x=preview();x.postingAllowed=true;has(audit(x),'UNAUTHORIZED_POSTING_CLAIM');
 const y=preview();y.lines[0].stockAuthority='loaded';has(audit(y),'UNAUTHORIZED_POSTING_CLAIM');
 const z=preview();z.lines[0].salePreview.postingAllowed=true;has(audit(z),'UNAUTHORIZED_POSTING_CLAIM');
});
test('unknown, invalid or unsafe money and malformed invoices fail closed',()=>{
 const x=preview();x.lines=[];has(audit(x),'EMPTY_SALE');
 const y=preview();y.lines[0].salePreview.lineAmountMinor='9007199254740992';has(audit(y),'TILE_QUOTE_MISMATCH');
 const z=preview();z.discount=-1;has(audit(z),'INVALID_CHECKOUT_MONEY');
 const bad=preview();bad.allocation.payments=Array.from({length:21},(_,i)=>({...bad.allocation.payments[0],rowId:'B'+i,rowOrder:i+1}));has(audit(bad),'TOO_MANY_PAYMENT_ROWS');
});
test('accessor-backed and malformed data rejected without executing getters',()=>{
 const x=preview();Object.defineProperty(x.lines[0].quantity.measurementSnapshot,'length',{
  enumerable:true,get(){throw Error('GETTER_MUST_NOT_RUN');}
 });
 assert.throws(()=>audit(x),/accessor|record|Invalid/i);
 const y=preview();Object.defineProperty(y.allocation.payments[0],'applied',{
  enumerable:true,get(){throw Error('GETTER_MUST_NOT_RUN');}
 });
 assert.throws(()=>audit(y),/accessor|record|Invalid/i);
 const z=preview();delete z.lines[1].quantity.requestSnapshot;
 has(audit(z),'INVALID_TILE_SNAPSHOT');
});
