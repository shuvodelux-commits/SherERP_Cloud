/**
 * M08 Run 3 exact-decimal REFERENCE PROPOSAL — NOT an operational payment writer.
 * Owner approved the principles, not maximum numeric bounds or tie mode.
 * Every rounding call must explicitly select its proposed mode.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {priceTileQuantity} from '../src/modules/tile-quantity-contract.js';
import {
  exactDecimal,roundSignedAmountPaisa,quoteExactLine,
  allocateInvoicePaisa,quoteFinalSupplierReturnPaisa,quoteCashRefundPaisa
} from '../src/modules/m08-exact-decimal-proposal.js';

test('G08: fractional quantity and sub-paisa cost are preserved exactly before chosen posting rounding',()=>{
  const q=quoteExactLine({quantity:'0.5',unitPrice:'10.005',roundingMode:'HALF_UP'});
  assert.deepEqual(q.exactAmount,{numerator:'2001',denominator:'400'});
  assert.equal(q.amountPaisa,'500');
  assert.equal(q.priceSource,'10.005');
  assert.equal(q.quantitySource,'0.5');
  assert.equal(roundSignedAmountPaisa('5.0025','HALF_UP'),'500');
});

test('explicit tie strategies on positive and negative half paisa; no implicit mode',()=>{
  assert.equal(roundSignedAmountPaisa('0.005','HALF_UP'),'1');
  assert.equal(roundSignedAmountPaisa('-0.005','HALF_UP'),'-1');
  assert.equal(roundSignedAmountPaisa('0.005','HALF_EVEN'),'0');
  assert.equal(roundSignedAmountPaisa('-0.005','HALF_EVEN'),'0');
  assert.equal(roundSignedAmountPaisa('0.015','HALF_EVEN'),'2');
  assert.equal(roundSignedAmountPaisa('-0.015','HALF_EVEN'),'-2');
  assert.equal(roundSignedAmountPaisa('2.675','HALF_UP'),'268');
  assert.throws(()=>roundSignedAmountPaisa('0.005'),/rounding mode/i);
  assert.throws(()=>roundSignedAmountPaisa('0.005','TRUNCATE'),/rounding mode/i);
});

test('strict textual decimal parser rejects JS floating input and ambiguous money text',()=>{
  for(const bad of [null,undefined,0.5,NaN,Infinity,'',' ',' 1','1 ','+1','01','1.','1e3',
    '0x10','-0','-0.00','-01.20','1.0000000000000','9999999999999',
    '1,000','０.１',{},[],new String('1')]){
    assert.throws(()=>exactDecimal(bad),{name:'TypeError'});
  }
  assert.deepEqual(exactDecimal('0.000000000001'),{numerator:'1',denominator:'1000000000000'});
  assert.deepEqual(exactDecimal('1.2300'),{numerator:'123',denominator:'100'});
  assert.deepEqual(exactDecimal('-0.000000000001',{signed:true}),{numerator:'-1',denominator:'1000000000000'});
  assert.throws(()=>exactDecimal('-1'),{name:'TypeError'});
});

test('multi-unit snapshot ratios price by canonical physical quantity without Number() conversions',()=>{
  const a=quoteExactLine({
    quantity:'1.5',unitPrice:'1.005',
    unitRatio:{numerator:'20',denominator:'1'},roundingMode:'HALF_UP'
  });
  assert.equal(a.amountPaisa,'3015');
  assert.deepEqual(a.physicalQuantity,{numerator:'30',denominator:'1'});
  const b=quoteExactLine({quantity:'30',unitPrice:'1.005',roundingMode:'HALF_UP'});
  assert.equal(a.amountPaisa,b.amountPaisa);
  const c=quoteExactLine({
    quantity:'2',unitPrice:'10.005',
    unitRatio:{numerator:'3',denominator:'2'},roundingMode:'HALF_UP'
  }); // two 12x18 inch tiles, each 1.5 Sqft
  assert.deepEqual(c.physicalQuantity,{numerator:'3',denominator:'1'});
  assert.equal(c.amountPaisa,'3002');
  assert.throws(()=>quoteExactLine({quantity:'2',unitPrice:'10',unitRatio:undefined,roundingMode:'HALF_UP'}),TypeError);
  assert.throws(()=>quoteExactLine({quantity:'2',unitPrice:'10',unitRatio:{numerator:'0',denominator:'1'},roundingMode:'HALF_UP'}));
  assert.throws(()=>quoteExactLine({quantity:'2',unitPrice:'10',unitRatio:{numerator:'2',denominator:'0'},roundingMode:'HALF_UP'}));
});

test('invoice-wide paisa apportionment conserves exact grand total and is stable across line order',()=>{
  const lines=[
    {id:'P-C',quantity:'1',unitPrice:'0.335'},
    {id:'P-A',quantity:'1',unitPrice:'0.335'},
    {id:'P-B',quantity:'1',unitPrice:'0.335'}
  ];
  const up=allocateInvoicePaisa({lines,discount:'0',roundingMode:'HALF_UP'});
  const even=allocateInvoicePaisa({lines,discount:'0',roundingMode:'HALF_EVEN'});
  assert.deepEqual(up.grandExact,{numerator:'201',denominator:'200'});
  assert.equal(up.grandPaisa,'101');
  assert.equal(even.grandPaisa,'100');
  const map=r=>Object.fromEntries(r.lines.map(x=>[x.id,x.netPaisa]));
  assert.deepEqual(map(up),{'P-C':'33','P-A':'34','P-B':'34'});
  assert.deepEqual(map(even),{'P-C':'33','P-A':'34','P-B':'33'});
  const reverse=allocateInvoicePaisa({lines:lines.toReversed(),discount:'0',roundingMode:'HALF_UP'});
  assert.deepEqual(map(reverse),map(up));
  assert.equal(up.lines.reduce((a,x)=>a+BigInt(x.netPaisa),0n),BigInt(up.grandPaisa));
});

test('discount allocation preserves exact source line lexemes and enforces invoice conservation',()=>{
  const x=allocateInvoicePaisa({lines:[
    {id:'PVC',quantity:'3',unitPrice:'5.005'},
    {id:'BOX',quantity:'1',unitPrice:'0.335'}
  ],discount:'2.50',roundingMode:'HALF_UP'});
  assert.equal(x.subtotalExact.numerator,'307');
  assert.equal(x.subtotalExact.denominator,'20');
  assert.deepEqual(x.grandExact,{numerator:'257',denominator:'20'});
  assert.equal(x.grandPaisa,'1285');
  assert.equal(x.lines.reduce((sum,row)=>sum+BigInt(row.netPaisa),0n),1285n);
  assert.deepEqual(x.lines.map(r=>r.unitPriceSource),['5.005','0.335']);
});

test('original source excess discount is explicitly zero-floored, never creates negative payable',()=>{
  const q=allocateInvoicePaisa({lines:[{id:'X',quantity:'1',unitPrice:'60'}],
    discount:'70',roundingMode:'HALF_UP'});
  assert.equal(q.grandPaisa,'0');
  assert.equal(q.lines[0].netPaisa,'0');
  assert.equal(q.discountSource,'70');
  assert.equal(q.excessDiscount,true);
});

test('over-large amounts reject before exposing invalid JS/SQLite safe money',()=>{
  assert.throws(()=>quoteExactLine({quantity:'1000000000',unitPrice:'1000000000',roundingMode:'HALF_UP'}),RangeError);
  assert.throws(()=>quoteExactLine({quantity:'1000000001',unitPrice:'1',roundingMode:'HALF_UP'}),RangeError);
  assert.throws(()=>quoteExactLine({quantity:'1',unitPrice:'1000000001',roundingMode:'HALF_UP'}),RangeError);
  assert.throws(()=>allocateInvoicePaisa({lines:[],discount:'0',roundingMode:'HALF_UP'}),TypeError);
  assert.throws(()=>allocateInvoicePaisa({lines:[
    {id:'A',quantity:'1',unitPrice:'1'},
    {id:'A',quantity:'1',unitPrice:'2'}
  ],discount:'0',roundingMode:'HALF_UP'}),TypeError);
  assert.throws(()=>allocateInvoicePaisa({lines:[{id:'A',quantity:'1',unitPrice:'1'}],
    discount:'-1',roundingMode:'HALF_UP'}),TypeError);
});

test('supplier discounted partial return chooses residual only on final eligible quantity',()=>{
  const base={originalQuantity:'3',allocatedLinePaisa:'100',roundingMode:'HALF_UP'};
  const one=quoteFinalSupplierReturnPaisa({...base,alreadyReturnedQuantity:'0',
    returnedQuantity:'1',alreadyCreditedPaisa:'0'});
  const two=quoteFinalSupplierReturnPaisa({...base,alreadyReturnedQuantity:'1',
    returnedQuantity:'1',alreadyCreditedPaisa:'33'});
  const three=quoteFinalSupplierReturnPaisa({...base,alreadyReturnedQuantity:'2',
    returnedQuantity:'1',alreadyCreditedPaisa:'66'});
  assert.deepEqual([one.returnPaisa,two.returnPaisa,three.returnPaisa],['33','33','34']);
  assert.equal(three.remainingPaisa,'0');
  assert.equal(three.finalReturn,true);
  const whole=quoteFinalSupplierReturnPaisa({...base,alreadyReturnedQuantity:'0',
    returnedQuantity:'3',alreadyCreditedPaisa:'0'});
  assert.equal(whole.returnPaisa,'100');
});

test('return quantities, prior credits, repeated final and invalid intent fail closed',()=>{
  const p={originalQuantity:'3',allocatedLinePaisa:'100',
    alreadyReturnedQuantity:'2',returnedQuantity:'2',alreadyCreditedPaisa:'66',
    roundingMode:'HALF_UP'};
  assert.throws(()=>quoteFinalSupplierReturnPaisa(p),RangeError);
  assert.throws(()=>quoteFinalSupplierReturnPaisa({...p,returnedQuantity:'1',alreadyCreditedPaisa:'101'}),RangeError);
  assert.throws(()=>quoteFinalSupplierReturnPaisa({...p,returnedQuantity:'0'}),RangeError);
  assert.throws(()=>quoteFinalSupplierReturnPaisa({...p,returnedQuantity:'1',alreadyReturnedQuantity:'3'}),RangeError);
});

test('cash refund cannot exceed attributable net collected money or eligible return',()=>{
  const valid=quoteCashRefundPaisa({returnPaisa:'7500',netCashCollectedPaisa:'10000',
    priorCashRefundPaisa:'2500',requestedCashRefundPaisa:'5000'});
  assert.deepEqual(valid,{cashRefundPaisa:'5000',storeCreditPaisa:'2500',
    remainingCashBackingPaisa:'2500'});
  for(const changed of [
    {requestedCashRefundPaisa:'7501'},
    {requestedCashRefundPaisa:'7500',priorCashRefundPaisa:'5000'},
    {netCashCollectedPaisa:'5000',priorCashRefundPaisa:'5001'},
    {requestedCashRefundPaisa:'-1'},
    {requestedCashRefundPaisa:'0.001'}
  ])assert.throws(()=>quoteCashRefundPaisa({
    returnPaisa:'7500',netCashCollectedPaisa:'10000',
    priorCashRefundPaisa:'2500',requestedCashRefundPaisa:'5000',...changed
  }),/RangeError|TypeError|cash|refund|minor/i);
});

test('fully unpaid source invoice cannot pay cash; eligible value stays noncash for new-shop policy',()=>{
  assert.deepEqual(quoteCashRefundPaisa({
    returnPaisa:'7500',netCashCollectedPaisa:'0',
    priorCashRefundPaisa:'0',requestedCashRefundPaisa:'0'
  }),{cashRefundPaisa:'0',storeCreditPaisa:'7500',remainingCashBackingPaisa:'0'});
  assert.throws(()=>quoteCashRefundPaisa({
    returnPaisa:'7500',netCashCollectedPaisa:'0',
    priorCashRefundPaisa:'0',requestedCashRefundPaisa:'100'
  }),RangeError);
});

test('deterministic seeded randomized 500 invoice baskets conserve paisa without order bias',()=>{
  let seed=19680509;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<500;i++){
    const n=1+next()%8;
    const lines=Array.from({length:n},(_,j)=>({
      id:'LINE-'+String(j).padStart(2,'0'),
      quantity:String(1+next()%100)+'.'+String(next()%10000).padStart(4,'0'),
      unitPrice:String(next()%10000)+'.'+String(next()%10000).padStart(4,'0')
    }));
    const mode=i%2?'HALF_UP':'HALF_EVEN';
    const subtotal=allocateInvoicePaisa({lines,discount:'0',roundingMode:mode});
    const discount=String(next()%5000)+'.'+String(next()%10000).padStart(4,'0');
    const a=allocateInvoicePaisa({lines,discount,roundingMode:mode});
    const b=allocateInvoicePaisa({lines:lines.toReversed(),discount,roundingMode:mode});
    const keys=o=>Object.fromEntries(o.lines.map(x=>[x.id,x.netPaisa]));
    assert.deepEqual(keys(a),keys(b));
    assert.equal(a.lines.reduce((s,x)=>s+BigInt(x.netPaisa),0n),BigInt(a.grandPaisa));
    assert.ok(BigInt(a.grandPaisa)<=BigInt(subtotal.grandPaisa));
    assert.ok(a.lines.every(x=>BigInt(x.netPaisa)>=0n));
  }
});

test('source Tiles Pcs/Box/Sqft contract agrees with exact M08 proposed HALF_UP on verified rationals',()=>{
  const base={productId:'T-8X12',revision:'1',baseUnit:'Pcs',
    boxConversionId:'BOX-25',length:'12',width:'8',
    dimensionUnit:'in',piecesPerBox:'25',coveragePolicy:'nominal'};
  const variants=[
    base,
    {...base,length:'304.8',width:'203.2',dimensionUnit:'mm'},
    {...base,coveragePolicy:'manufacturer',
      manufacturerSqftPerBox:'16.668',manufacturerEvidence:'synthetic-verified-label'}
  ];
  for(const config of variants){
    for(const pricingUnit of ['Pcs','Box','Sqft']){
      const m05=priceTileQuantity(config,{mode:'pack',boxes:'2',extraPieces:'3'},
        pricingUnit,'38.005');
      const m08=quoteExactLine({quantity:'1',unitPrice:'38.005',
        unitRatio:m05.billingQuantity,roundingMode:'HALF_UP'});
      assert.equal(m08.amountPaisa,m05.lineAmountMinor,
        'M05 Tile source ratio must agree for '+pricingUnit+'/'+config.coveragePolicy+'/'+config.dimensionUnit);
      assert.deepEqual(m08.physicalQuantity,m05.billingQuantity);
    }
  }
});

test('final refund review gate prevents huge accumulated residual from micro-returns',()=>{
  // 1000 original units worth ৳1.00, each earlier one-unit return
  // rounds to 0 paisa; silently paying 100 paisa for the last unit is unsafe.
  assert.throws(()=>quoteFinalSupplierReturnPaisa({
    originalQuantity:'1000',allocatedLinePaisa:'100',
    alreadyReturnedQuantity:'999',returnedQuantity:'1',
    alreadyCreditedPaisa:'0',roundingMode:'HALF_UP'
  }),/review required/i);
});

test('input data must not be mutated; accessor-backed invoice lines fail closed',()=>{
  const line=Object.freeze({id:'A',quantity:'1.25',unitPrice:'4.005'});
  const input=Object.freeze({lines:Object.freeze([line]),discount:'0.25',
    roundingMode:'HALF_UP'});
  const result=allocateInvoicePaisa(input);
  assert.equal(result.lines[0].quantitySource,'1.25');
  assert.equal(line.unitPrice,'4.005');
  assert.equal(Object.hasOwn(line,'netPaisa'),false);
  const hidden={id:'B',quantity:'1'};
  Object.defineProperty(hidden,'unitPrice',{get:()=> '2.00',enumerable:true});
  assert.throws(()=>allocateInvoicePaisa({lines:[hidden],discount:'0',
    roundingMode:'HALF_UP'}),TypeError);
});

test('customer refund cash and store credit conserve return entitlement over 300 deterministic splits',()=>{
  for(let i=0;i<300;i++){
    const cashCollected=BigInt(i*17+100),previousRefund=BigInt(i%19);
    const returnAmount=BigInt(i*11+30);
    const available=cashCollected-previousRefund;
    const selected=available<returnAmount?available:returnAmount;
    const got=quoteCashRefundPaisa({
      returnPaisa:String(returnAmount),
      netCashCollectedPaisa:String(cashCollected),
      priorCashRefundPaisa:String(previousRefund),
      requestedCashRefundPaisa:String(selected)
    });
    assert.equal(BigInt(got.cashRefundPaisa)+BigInt(got.storeCreditPaisa),returnAmount);
    assert.equal(BigInt(got.remainingCashBackingPaisa)+previousRefund+
      BigInt(got.cashRefundPaisa),cashCollected);
  }
});
