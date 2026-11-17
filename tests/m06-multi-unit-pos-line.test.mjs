import test from 'node:test';
import assert from 'node:assert/strict';

// Test-first: the M06-owned capability does not yet exist on this RED commit.
// Missing export/module is an explicit missing-feature assertion, not a fake
// pre-populated fixture or a claimed passing production integration.
const loaded=await import('../src/modules/m06-multi-unit-pos-line.js')
  .then(module=>module.planMultiUnitPosLine)
  .catch(error=>{
    if(error?.code==='ERR_MODULE_NOT_FOUND')return undefined;
    throw error;
  });

function plan(intent,source){
  assert.equal(typeof loaded,'function',
    'M06 trusted mixed-unit POS line calculation is not implemented yet');
  return loaded(intent,source);
}
const product=overrides=>({
  'Product ID':'P-MIX','Product Name':'Fastener','Product Type':'Standard',
  Unit:'Pcs','Selling Price':10,'Purchase Price':6,'Current Stock':145,
  Status:'Active','Is Deleted':'FALSE',...overrides
});
const conversion=(id,name,factor,sell)=>({
  'Conversion ID':id,'Product ID':'P-MIX','Unit Name':name,
  'Conversion Factor':factor,'Selling Price':sell,
  'Sort Order':name==='Bag'?1:2,Status:'Active','Is Deleted':'FALSE'
});
const lot=(id,day,qty,sell,cost)=>({
  'Lot ID':id,'Product ID':'P-MIX','Purchase Date':day,
  'Remaining Quantity':qty,'Sell Price':sell,'Purchase Price':cost,
  Status:'Active','Is Deleted':'FALSE'
});
const source=()=>({
  products:[product()],
  conversionRows:[
    conversion('C-BAG','Bag',100,900),
    conversion('C-BOX','Box',20,190)
  ],
  stockLots:[
    lot('LOT-OLD','2026-11-10',100,10,6),
    lot('LOT-NEW','2026-11-12',45,12,7)
  ]
});
const mixed=overrides=>({
  productId:'P-MIX',claimedBaseQty:145,shortageMode:'Own',
  unitBreakdown:[
    {conversionId:'C-BAG',qty:1},
    {conversionId:'C-BOX',qty:2},
    {conversionId:'BASE',qty:5}
  ],...overrides
});

test('1 Bag + 2 Box + 5 Pcs resolves one 145-Pcs sale with frozen unit prices and FIFO base draws',()=>{
  const snapshot=source(),intent=mixed();
  const before=structuredClone({snapshot,intent});
  const result=plan(intent,snapshot);
  assert.equal(result.productId,'P-MIX');
  assert.equal(result.stockUnit,'Pcs');
  assert.equal(result.baseQty,145);
  assert.equal(result.shortageMode,'Own');
  assert.equal(result.lineTotal,1340); // 900 + 2*190 + 5*12
  assert.equal(result.unitPrice,9.24); // display rate; not source lineTotal
  assert.deepEqual(result.unitBreakdownSnapshot,[
    {conversionId:'C-BAG',unitName:'Bag',factor:100,qty:1},
    {conversionId:'C-BOX',unitName:'Box',factor:20,qty:2},
    {conversionId:'BASE',unitName:'Pcs',factor:1,qty:5}
  ]);
  assert.deepEqual(result.unitPricingSnapshot.map(x=>x.unitPrice),[900,190,12]);
  assert.deepEqual(result.fifoDraws,[
    {lotId:'LOT-OLD',baseQty:100},{lotId:'LOT-NEW',baseQty:45}
  ]);
  assert.equal(result.shortfallBaseQty,0);
  assert.deepEqual({snapshot,intent},before,'Planning must not mutate source rows or POS intent');
  assert.equal(JSON.stringify(result).includes('unitCost'),false,
    'POS preview cannot expose private lot purchase cost');
  assert.equal(JSON.stringify(result).includes('Purchase Price'),false);
});

test('server-owned conversion factor and prices override forged browser values',()=>{
  const intent=mixed();
  intent.unitBreakdown[0]={conversionId:'C-BAG',qty:1,
    factor:999999,unitPrice:0,sellingPrice:0,unitName:'Fake'};
  const actual=plan(intent,source());
  assert.equal(actual.baseQty,145);
  assert.equal(actual.lineTotal,1340);
  assert.equal(actual.unitPricingSnapshot[0].unitPrice,900);
});

test('when no custom unit prices are configured, the frozen FIFO ladder supplies sale prices',()=>{
  const snapshot=source();
  snapshot.conversionRows.forEach(row=>{row['Selling Price']='';});
  const result=plan(mixed(),snapshot);
  assert.equal(result.baseQty,145);
  assert.equal(result.lineTotal,1540); // 100*10 + 45*12
  assert.deepEqual(result.unitPricingSnapshot.map(x=>x.unitPrice),[1000,240,12]);
});

test('legacy single-unit product without breakdown retains original POS FIFO price',()=>{
  const result=plan(mixed({unitBreakdown:[],claimedBaseQty:2}),source());
  assert.equal(result.baseQty,2);
  assert.equal(result.lineTotal,20);
  assert.equal(result.unitPrice,10);
  assert.deepEqual(result.unitBreakdownSnapshot,[]);
  assert.deepEqual(result.unitPricingSnapshot,[]);
  assert.deepEqual(result.fifoDraws,[{lotId:'LOT-OLD',baseQty:2}]);
});

test('a false 144 base-unit claim and unknown, inactive or duplicate submitted units are rejected',()=>{
  assert.throws(()=>plan(mixed({claimedBaseQty:144}),source()),/does not match/);
  assert.throws(()=>plan(mixed({unitBreakdown:[{conversionId:'C-UNKNOWN',qty:1}]}),source()),
    /not available|conversion/i);
  const disabled=source();
  disabled.conversionRows[0].Status='Inactive';
  assert.throws(()=>plan(mixed(),disabled),/not available|inactive/i);
  const duplicated=mixed();
  duplicated.unitBreakdown.push({conversionId:'C-BAG',qty:1});
  assert.throws(()=>plan(duplicated,source()),/duplicate unit/i);
});

test('short stock requires an explicit source Own versus Negative versus Vendor choice',()=>{
  const snapshot=source();
  snapshot.products[0]['Current Stock']=130;
  snapshot.stockLots[1]['Remaining Quantity']=30;
  assert.throws(()=>plan(mixed({shortageMode:'Own'}),snapshot),
    /shortage|available|stock/i);
  const negative=plan(mixed({shortageMode:'Negative'}),snapshot);
  const vendor=plan(mixed({shortageMode:'Vendor'}),snapshot);
  for(const outcome of [negative,vendor]){
    assert.equal(outcome.baseQty,145);
    assert.equal(outcome.shortfallBaseQty,15);
    assert.deepEqual(outcome.fifoDraws,[
      {lotId:'LOT-OLD',baseQty:100},{lotId:'LOT-NEW',baseQty:30}
    ]);
  }
  assert.equal(negative.shortageMode,'Negative');
  assert.equal(vendor.shortageMode,'Vendor');
  assert.deepEqual(snapshot.products[0]['Current Stock'],130,
    'No stock reservation or D1 write is allowed in a preflight');
});

test('historical tombstones never become saleable FIFO lots or active conversion entries',()=>{
  const snapshot=source();
  snapshot.stockLots.unshift(lot('LOT-DELETED','2026-01-01',999,1,0.1));
  snapshot.stockLots[0]['Is Deleted']='TRUE';
  snapshot.conversionRows.push({...conversion('C-DELETED','Case',999,1),'Is Deleted':'TRUE'});
  const result=plan(mixed(),snapshot);
  assert.equal(result.lineTotal,1340);
  assert.deepEqual(result.fifoDraws.map(x=>x.lotId),['LOT-OLD','LOT-NEW']);
  assert.equal(result.unitBreakdownSnapshot.length,3);
});

test('ambiguous product, conversion, and lot identities must not silently double count',()=>{
  const a=source();
  a.products.push(product({'Product Name':'Ambiguous'}));
  assert.throws(()=>plan(mixed(),a),/duplicate|ambiguous|needs_review/i);
  const b=source();
  b.conversionRows.push({...b.conversionRows[0]});
  assert.throws(()=>plan(mixed(),b),/duplicate|ambiguous|needs_review/i);
  const c=source();
  c.stockLots.push({...c.stockLots[0]});
  assert.throws(()=>plan(mixed(),c),/duplicate|ambiguous|needs_review/i);
});

test('inactive/deleted products, Bundle stock and malformed source conversion factors fail closed',()=>{
  for(const change of [
    s=>{s.products[0].Status='Inactive';},
    s=>{s.products[0]['Is Deleted']='TRUE';},
    s=>{s.products[0]['Product Type']='Bundle';},
    s=>{s.conversionRows[0]['Conversion Factor']=0;},
    s=>{s.conversionRows[0]['Conversion Factor']=-100;}
  ]){
    const snapshot=source();change(snapshot);
    assert.throws(()=>plan(mixed(),snapshot),/inactive|deleted|bundle|factor|conversion/i);
  }
});

test('untrusted snapshots, unsupported shortage mode and empty units cannot create an intent',()=>{
  for(const bad of [
    {products:[],conversionRows:[],stockLots:[]},
    {products:null,conversionRows:[],stockLots:[]},
    {...source(),stockLots:undefined}
  ]){
    assert.throws(()=>plan(mixed(),bad),/trusted|product|snapshot/i);
  }
  assert.throws(()=>plan(mixed({shortageMode:'Auto'}),source()),/shortage|mode/i);
  assert.throws(()=>plan(mixed({unitBreakdown:[{conversionId:'BASE',qty:0}]}),source()),
    /greater than zero|quantity/i);
});
