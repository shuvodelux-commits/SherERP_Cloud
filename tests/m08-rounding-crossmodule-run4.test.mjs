/**
 * M08 Run 4: independent, non-posting cross-module rounding acceptance cases.
 * Observed source differences are NOT permissions to change accounting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditSourceSaleEditVsM08,
  auditTileLineVsM08,
  auditSplitTenderForCandidate,
  auditSourcePurchaseDriftVsM08,
  auditReturnAndCashPolicyGap,
  auditCartLineLimitGap
} from './fixtures/m08-rounding-crossmodule-probes.mjs';

test('whole-paisa standard items agree between source sale edit and M08 invoice quote',()=>{
  const result=auditSourceSaleEditVsM08([
    {id:'P-A',quantity:'2',unitPrice:'12.50'},
    {id:'P-B',quantity:'3',unitPrice:'7.25'}
  ]);
  assert.equal(result.sourceSubtotalPaisa,'4675');
  assert.equal(result.candidateHeaderPaisa,'4675');
  assert.equal(result.deltaPaisa,'0');
  assert.equal(result.classification,'PARITY');
});

test('two 0.335-priced sale edits expose a one-paisa source-vs-new-header conflict',()=>{
  const result=auditSourceSaleEditVsM08([
    {id:'P-A',quantity:'1',unitPrice:'0.335'},
    {id:'P-B',quantity:'1',unitPrice:'0.335'}
  ]);
  assert.deepEqual(result.sourceLinesPaisa,['34','34']);
  assert.deepEqual(result.candidateLines.map(x=>[x.id,x.netPaisa]),[['P-A','34'],['P-B','33']]);
  assert.equal(result.sourceSubtotalPaisa,'68');
  assert.equal(result.candidateHeaderPaisa,'67');
  assert.equal(result.deltaPaisa,'1');
  assert.equal(result.classification,'REQUIRES_ROUNDING_SIGNOFF');
});

test('three 0.335 lines expose source +1 paisa without any sales or stock writes',()=>{
  const result=auditSourceSaleEditVsM08([
    {id:'P-C',quantity:'1',unitPrice:'0.335'},
    {id:'P-A',quantity:'1',unitPrice:'0.335'},
    {id:'P-B',quantity:'1',unitPrice:'0.335'}
  ]);
  assert.equal(result.sourceSubtotalPaisa,'102');
  assert.equal(result.candidateHeaderPaisa,'101');
  assert.equal(result.deltaPaisa,'1');
  const reversed=auditSourceSaleEditVsM08([
    {id:'P-B',quantity:'1',unitPrice:'0.335'},
    {id:'P-A',quantity:'1',unitPrice:'0.335'},
    {id:'P-C',quantity:'1',unitPrice:'0.335'}
  ]);
  assert.equal(reversed.deltaPaisa,'1');
  assert.deepEqual(
    Object.fromEntries(result.candidateLines.map(x=>[x.id,x.netPaisa])),
    Object.fromEntries(reversed.candidateLines.map(x=>[x.id,x.netPaisa]))
  );
});

test('source sale edit preserves historical saved line totals; never reinterpret import',()=>{
  const result=auditSourceSaleEditVsM08([
    {id:'P-A',quantity:'1',unitPrice:'0.335'}
  ],{historicalLineTotals:{'P-A':0.335}});
  assert.equal(result.sourceLineTotals[0],0.335);
  assert.equal(result.sourceSubtotalPaisa,'34');
  assert.equal(result.candidateHeaderPaisa,'34');
  assert.equal(result.classification,'PARITY');
  assert.equal(result.historicalSourceRowsPreserved,true);
});

test('direct exact Tiles Sqft nominal and manufacturer pricing agrees per item with M08',()=>{
  for(const coveragePolicy of ['nominal','manufacturer']){
    const audit=auditTileLineVsM08({
      coveragePolicy,pricingUnit:'Sqft',priceText:'38.005',
      boxes:'2',extraPieces:'3'
    });
    assert.equal(audit.classification,'PARITY');
    assert.equal(audit.m05LinePaisa,audit.m08LinePaisa);
    assert.equal(audit.exactBillingQuantity.denominator.length>0,true);
  }
});

test('Pcs and Box exact Tiles pricing agrees per item with M08; displayed sqft must not reprice',()=>{
  for(const unit of ['Pcs','Box']){
    const audit=auditTileLineVsM08({
      pricingUnit:unit,priceText:'4.375',boxes:'2',extraPieces:'3'
    });
    assert.equal(audit.classification,'PARITY');
    assert.equal(audit.m05LinePaisa,audit.m08LinePaisa);
  }
});

test('two one-piece Tiles at half a paisa each show per-item-vs-header conservation gap',()=>{
  const tileA=auditTileLineVsM08({
    pricingUnit:'Pcs',priceText:'0.005',boxes:'0',extraPieces:'1'
  });
  const tileB=auditTileLineVsM08({
    pricingUnit:'Pcs',priceText:'0.005',boxes:'0',extraPieces:'1'
  });
  assert.equal(tileA.m05LinePaisa,'1');
  assert.equal(tileB.m05LinePaisa,'1');
  // The candidate invoice-header total for two separate items is 1 paisa.
  const sourcePerItemTotal=BigInt(tileA.m05LinePaisa)+BigInt(tileB.m05LinePaisa);
  assert.equal(String(sourcePerItemTotal),'2');
  const basket=auditSourceSaleEditVsM08([
    {id:'T-A',quantity:'1',unitPrice:'0.005'},
    {id:'T-B',quantity:'1',unitPrice:'0.005'}
  ]);
  assert.equal(basket.candidateHeaderPaisa,'1');
  assert.equal(basket.deltaPaisa,'1');
});

test('M06 bank + cash split consumes exact candidate paisa and isolates cash change',()=>{
  const r=auditSplitTenderForCandidate({
    lines:[{id:'P-A',quantity:'1',unitPrice:'0.335'},
      {id:'P-B',quantity:'1',unitPrice:'0.335'}],
    payments:[{id:'BANK-1',method:'Bank',amount:'0.25',accountId:'BANK-A'},
      {id:'CASH-1',method:'Cash',amount:'0.50'}]
  });
  assert.equal(r.grandPaisa,'67');
  assert.equal(r.bankAppliedPaisa,'25');
  assert.equal(r.cashAppliedPaisa,'42');
  assert.equal(r.changePaisa,'8');
  assert.equal(r.duePaisa,'0');
  assert.equal(r.conserved,true);
});

test('M06 split tender refuses a source-incompatible sub-paisa cash payment',()=>{
  assert.throws(()=>auditSplitTenderForCandidate({
    lines:[{id:'P-A',quantity:'1',unitPrice:'1.005'}],
    payments:[{id:'CASH-1',method:'Cash',amount:'0.001'}]
  }),/decimal|places|Payment/i);
});

test('M05 historical purchase tolerance is separate from M08 new-shop zero-drift arithmetic',()=>{
  const r=auditSourcePurchaseDriftVsM08();
  assert.equal(r.sourceAuditReady,true);
  assert.equal(r.sourceAmountTolerance,0.004);
  assert.equal(r.candidateOriginalCost,'10.005');
  assert.equal(r.candidateOriginalExactAmount.numerator,'2001');
  assert.equal(r.candidateOriginalExactAmount.denominator,'400');
  assert.equal(r.candidateMoneyPaisa,'500');
  assert.equal(r.historicalRowsModified,false);
});

test('M07 source cash refund on unpaid invoice differs from approved new-shop policy',()=>{
  const r=auditReturnAndCashPolicyGap();
  assert.equal(r.sourceUnpaidCashRefundPaisa,'7500');
  assert.equal(r.sourceCustomerDuePaisa,'20000');
  assert.equal(r.candidateUnpaidCashRefundPaisa,'0');
  assert.equal(r.candidateNocashRemainderPaisa,'7500');
  assert.equal(r.classification,'NEW_SHOP_POLICY_DIFFERS_FROM_HISTORIC_SOURCE');
});

test('existing M06 POS V2 100-line cap is stricter than M08 candidate 200 lines',()=>{
  const r=auditCartLineLimitGap();
  assert.equal(r.m06MaxLines,100);
  assert.equal(r.m08CandidateMaxLines,200);
  assert.equal(r.classification,'REQUIRES_PRODUCT_LIMIT_SIGNOFF');
});

test('caller source arguments are immutable and prototype/accessor attacks are blocked',()=>{
  const inputs=Object.freeze([
    Object.freeze({id:'P-A',quantity:'1',unitPrice:'0.335'}),
    Object.freeze({id:'P-B',quantity:'1',unitPrice:'0.335'})
  ]);
  const r=auditSourceSaleEditVsM08(inputs);
  assert.equal(r.candidateHeaderPaisa,'67');
  const bad={id:'P-C',quantity:'1'};
  Object.defineProperty(bad,'unitPrice',{get(){throw new Error('accessor leaked');},enumerable:true});
  assert.throws(()=>auditSourceSaleEditVsM08([bad]),/record|accessor|Invalid|Unsupported/i);
});

test('two small 0.004 items produce source 0 paisa but candidate header 1 paisa',()=>{
  const r=auditSourceSaleEditVsM08([
    {id:'LOW-A',quantity:'1',unitPrice:'0.004'},
    {id:'LOW-B',quantity:'1',unitPrice:'0.004'}
  ]);
  assert.equal(r.sourceSubtotalPaisa,'0');
  assert.equal(r.candidateHeaderPaisa,'1');
  assert.equal(r.deltaPaisa,'-1');
  assert.equal(r.classification,'REQUIRES_ROUNDING_SIGNOFF');
});

test('25 small fractional-price source lines drift 12 paisa beyond a 1-paisa tolerance',()=>{
  const lines=Array.from({length:25},(_,i)=>({
    id:'P-'+String(i+1).padStart(2,'0'),quantity:'1',unitPrice:'0.335'
  }));
  const r=auditSourceSaleEditVsM08(lines);
  assert.equal(r.sourceSubtotalPaisa,'850');
  assert.equal(r.candidateHeaderPaisa,'838');
  assert.equal(r.deltaPaisa,'12');
  assert.equal(r.classification,'REQUIRES_ROUNDING_SIGNOFF');
  assert.equal(r.candidateLines.reduce((sum,row)=>sum+BigInt(row.netPaisa),0n),838n);
});

test('30 deterministic sampled multi-line sale previews classify both signs of drift',()=>{
  let seed=34991;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const hist={negative:false,positive:false,match:false};
  for(let j=0;j<30;j++){
    const length=2+random()%7;
    const lines=Array.from({length},(_,i)=>({
      id:'SKU-'+String(i).padStart(2,'0'),
      quantity:String(1+random()%4),
      unitPrice:'0.'+String(1+random()%999).padStart(3,'0')
    }));
    const r=auditSourceSaleEditVsM08(lines);
    const diff=BigInt(r.deltaPaisa);
    if(diff<0n)hist.negative=true;
    else if(diff>0n)hist.positive=true;
    else hist.match=true;
    assert.equal(r.candidateLines.reduce((sum,x)=>sum+BigInt(x.netPaisa),0n),
      BigInt(r.candidateHeaderPaisa));
    assert.equal(r.classification,diff===0n?'PARITY':'REQUIRES_ROUNDING_SIGNOFF');
  }
  assert.ok(hist.negative||hist.positive,'at least one real source-vs-new boundary mismatch must be retained');
});
