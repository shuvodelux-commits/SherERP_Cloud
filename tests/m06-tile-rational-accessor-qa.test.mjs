import test from 'node:test';
import assert from 'node:assert/strict';
import {priceTileQuantity} from '../src/modules/tile-quantity-contract.js';
import {normalizeSalePayments_} from '../src/modules/sale-payments.js';
import {auditMultiTileSaleCheckoutEvidence} from '../src/modules/m06-tile-checkout-evidence-audit.js';

// M06 Super QA: the historic rational-area/price record must be plain data.
// No M03 D1, public RPC, current stock or posting permission participates.
function measurement(productId, piecesPerBox, length, width) {
  return {
    productId,revision:'1',baseUnit:'Pcs',
    boxConversionId:'BOX-01',boxUnitName:'Box',
    length,width,dimensionUnit:'in',
    piecesPerBox:String(piecesPerBox),coveragePolicy:'nominal'
  };
}
function tile(config,request,unitPriceText) {
  const priced=priceTileQuantity(config,request,'Sqft',unitPriceText);
  return {
    productId:config.productId,productName:'Tile '+config.productId,
    revision:config.revision,stockUnit:'Pcs',quantity:priced.quantity,
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
function validCheckout() {
  const lines=[
    tile(measurement('QA-TILE-PACK',25,'12','8'),
      {mode:'pack',boxes:'2',extraPieces:'3'},'38.00'),
    tile(measurement('QA-TILE-AREA',10,'12','12'),
      {mode:'area',requestedSqft:'12.00',fulfillment:'loose'},'25.00')
  ];
  const bankAccounts=[
    {'Bank Account ID':'QA-BANK','Account Name':'Bank','Account Type':'Bank',Status:'Active'},
    {'Bank Account ID':'QA-MOBILE','Account Name':'Mobile','Account Type':'Mobile Banking',Status:'Active'}
  ];
  const payments=[
    {id:'B',method:'Bank',accountId:'QA-BANK',amount:'500'},
    {id:'M',method:'Mobile Banking',accountId:'QA-MOBILE',amount:'300'},
    {id:'C',method:'Cash',amount:'850'}
  ];
  return {
    lines,subtotal:1642.67,discount:42.67,grandTotal:1600,
    allocation:normalizeSalePayments_(1600,payments,bankAccounts),
    stockAuthority:'not-loaded',postingAllowed:false
  };
}

test('unchanged pack+area rational Tile snapshots and split tenders are valid read-only audit evidence',()=>{
  const payload=validCheckout(),before=structuredClone(payload);
  assert.equal(payload.lines[0].salePreview.lineAmountMinor,'134267');
  assert.equal(payload.lines[1].salePreview.lineAmountMinor,'30000');
  assert.deepEqual(payload.lines[1].quantity.requestedSqft,
    {numerator:'12',denominator:'1'});
  const result=auditMultiTileSaleCheckoutEvidence(payload);
  assert.equal(result.ready,true,JSON.stringify(result.issues));
  assert.equal(result.postingAllowed,false);
  assert.deepEqual(result.summary,{
    lines:2,subtotalMinor:'164267',discountMinor:'4267',
    grandMinor:'160000',paidMinor:'160000',dueMinor:'0',changeMinor:'5000'
  });
  assert.deepEqual(payload,before);
});

for(const [label,lineIndex,owner,field] of [
  ['saved physical actualSqft',0,'quantity','actualSqft'],
  ['saved area request requestedSqft',1,'quantity','requestedSqft'],
  ['saved quote billingQuantity',0,'salePreview','billingQuantity'],
  ['saved exactAmount',1,'salePreview','exactAmount']
]) {
  test('reject '+label+' getter before any caller-provided code executes',()=>{
    const candidate=structuredClone(validCheckout());
    const fraction=candidate.lines[lineIndex][owner][field];
    let getterCalls=0;
    Object.defineProperty(fraction,'numerator',{
      enumerable:true,
      get(){getterCalls++;throw new Error('UNSAFE_RATIONAL_GETTER_EXECUTED');}
    });
    assert.throws(
      ()=>auditMultiTileSaleCheckoutEvidence(candidate),
      /Invalid trusted Tile rational fraction accessor/
    );
    assert.equal(getterCalls,0,'the rational getter must never execute');
  });
}

test('ordinary malformed rational numerator remains diagnostic, not posting authorization',()=>{
  const candidate=structuredClone(validCheckout());
  candidate.lines[0].quantity.actualSqft.numerator='107';
  const result=auditMultiTileSaleCheckoutEvidence(candidate);
  assert.equal(result.ready,false);
  assert.equal(result.postingAllowed,false);
  assert.ok(result.issues.some(x=>x.code==='TILE_QUANTITY_MISMATCH'));
});
