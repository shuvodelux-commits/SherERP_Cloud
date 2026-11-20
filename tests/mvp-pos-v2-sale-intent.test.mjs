import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalizeMvpPosV2SaleIntent} from '../src/modules/mvp-pos-v2-sale-intent.js';

const context=()=>({tenantId:'SHOP-A',actorId:'USER-A',invoiceId:'INV-MVP-0001',operationId:'OP-MVP-0000000001'});
const item=()=>({productId:'PIPE-001',name:'1 inch pipe',qty:2,unitPrice:'100.00',
  priceMode:'manual',shortageResolution:'own',productType:'Standard',bundleRevision:0});
const payload=()=>({
  customerId:'',customerName:'Walk-in',customerPhone:'',customerFatherName:'',
  customerRelationType:'',customerAddress:'',items:[item()],discount:'0.00',
  paymentType:'Cash',paidAmount:200,paymentMethod:'Cash',bankAccountId:'',
});
const accountRows=()=>[
  {'Bank Account ID':'BANK-1','Account Name':'Business Bank','Account Type':'Bank',Status:'Active','Is Deleted':'FALSE'},
  {'Bank Account ID':'MOB-1','Account Name':'MFS','Account Type':'Mobile Banking',Status:'Active','Is Deleted':'FALSE'},
];
const normalize=(raw=payload(),trusted=context(),rows=accountRows())=>
  normalizeMvpPosV2SaleIntent({context:trusted,payload:raw,accountRows:rows});

test('normalizes source POS V2 one-SKU walk-in Cash without ever deriving tenant or actor from client',()=>{
  const out=normalize();
  assert.deepEqual(out,{
    tenantId:'SHOP-A',actorId:'USER-A',operationId:'OP-MVP-0000000001',
    invoiceId:'INV-MVP-0001',sku:'PIPE-001',units:2,unitPrice:'100.00',
    discount:'0.00',customerId:'',payments:[{id:'single-payment',method:'Cash',amount:'200.00',accountId:''}],
  });
  assert.equal(Object.isFrozen(out),true);
  assert.equal(Object.isFrozen(out.payments),true);
  assert.equal(Object.isFrozen(out.payments[0]),true);
});

test('full due requires an actual linked customer; no phantom cash or walk-in ledger',()=>{
  const raw={...payload(),customerId:'CUS-1',paymentType:'Due',paidAmount:0};
  assert.deepEqual(normalize(raw).payments,[]);
  assert.equal(normalize(raw).customerId,'CUS-1');
  assert.throws(()=>normalize({...raw,customerId:''}),/customer|due/i);
});

test('partial Bank and Mobile payments validate against current trusted account type',()=>{
  const bank={...payload(),customerId:'CUS-1',paymentType:'Partial',paidAmount:50,
    paymentMethod:'Bank',bankAccountId:'BANK-1'};
  assert.deepEqual(normalize(bank).payments,[{
    id:'single-payment',method:'Bank',amount:'50.00',accountId:'BANK-1',
  }]);
  const mobile={...bank,paymentMethod:'Mobile Banking',bankAccountId:'MOB-1'};
  assert.equal(normalize(mobile).payments[0].method,'Mobile Banking');
  assert.throws(()=>normalize({...bank,bankAccountId:'MOB-1'}),/account|type/i);
  assert.throws(()=>normalize(bank,context(),accountRows().map(x=>({...x,Status:'Inactive'}))),/account/i);
  assert.throws(()=>normalize({...bank,bankAccountId:''}),/account/i);
});

test('split Cash+Bank+Mobile computes only applied money; excess Cash remains change metadata in existing engine',()=>{
  const raw=payload();
  delete raw.paymentType;delete raw.paidAmount;delete raw.paymentMethod;delete raw.bankAccountId;
  raw.customerId='CUS-1';
  raw.operationId=context().operationId;
  raw.payments=[
    {id:'BANK-ROW',method:'Bank',amount:'30.00',accountId:'BANK-1'},
    {id:'MOB-ROW',method:'Mobile Banking',amount:'20.00',accountId:'MOB-1'},
    {id:'CASH-ROW',method:'Cash',amount:'200.00',accountId:''},
  ];
  const out=normalize(raw);
  assert.deepEqual(out.payments,raw.payments);
  assert.equal(out.payments.at(-1).amount,'200.00');
  assert.throws(()=>normalize({...raw,operationId:'OP-ATTACK-00000001'}),/operation|context/i);
});

test('rejects inflated bank sum, malformed split rows and duplicate Cash to avoid silent money loss',()=>{
  const raw=payload();delete raw.paymentType;delete raw.paidAmount;delete raw.paymentMethod;delete raw.bankAccountId;
  raw.payments=[{id:'B',method:'Bank',amount:'201',accountId:'BANK-1'}];
  assert.throws(()=>normalize(raw),/exceed/i);
  raw.payments=[{id:'C1',method:'Cash',amount:'2',accountId:''},
    {id:'C2',method:'Cash',amount:'3',accountId:''}];
  assert.throws(()=>normalize(raw),/one Cash/i);
  raw.payments=[{id:'B',method:'Bank',amount:'10',accountId:'MOB-1'}];
  assert.throws(()=>normalize(raw),/account|type/i);
  raw.payments=[{id:'X',method:'Cash',amount:'2.555',accountId:''}];
  assert.throws(()=>normalize(raw),/decimal|places|amount/i);
});

test('rejects unsupported multi-SKU, bundles, vendor sourcing, draft/update, auto price and fractional/negative quantity',()=>{
  const variants=[
    {...payload(),items:[item(),{...item(),productId:'PIPE-002'}]},
    {...payload(),items:[{...item(),productType:'Bundle'}]},
    {...payload(),items:[{...item(),shortageResolution:'vendor',vendorId:'VEN-1',vendorUnitCost:50}]},
    {...payload(),items:[{...item(),priceMode:'auto'}]},
    {...payload(),items:[{...item(),qty:0}]},
    {...payload(),items:[{...item(),qty:1.5}]},
    {...payload(),sourceDraftId:'D-1',sourceDraftVersion:1},
    {...payload(),reason:'Edit existing posted invoice'},
  ];
  for(const raw of variants)assert.throws(()=>normalize(raw),/unsupported|single|quantity|draft|invalid|price/i);
});

test('rejects float money, invalid discount, payment mismatch and unbacked customer due',()=>{
  const variants=[
    {...payload(),items:[{...item(),unitPrice:0.335}]},
    {...payload(),discount:'0.001'},
    {...payload(),paymentType:'Partial',paidAmount:200,customerId:'CUS-1'},
    {...payload(),paymentType:'Due',paidAmount:10,customerId:'CUS-1'},
    {...payload(),paymentType:'Cash',paidAmount:0},
    {...payload(),paymentType:'Partial',paidAmount:10,customerId:''},
    {...payload(),discount:'200.01',paidAmount:200},
  ];
  for(const raw of variants)assert.throws(()=>normalize(raw),/money|amount|paid|due|discount|customer|canonical|decimal/i);
});

test('does not allow browser-controlled tenant actor invoice, untrusted extra data or unsafe context keys',()=>{
  const raw=payload();
  for(const key of ['tenantId','actorId','invoiceId','cashSessionId']){
    assert.throws(()=>normalize({...raw,[key]:'ATTACK'}),/unexpected|context|trusted|field/i);
  }
  assert.throws(()=>normalize(raw,{...context(),actorId:''}),/context|trusted/i);
  assert.throws(()=>normalize(raw,{...context(),operationId:'bad'}),/context|trusted/i);
  assert.throws(()=>normalize(raw,{...context(),isAdmin:true}),/context|trusted/i);
  assert.throws(()=>normalize(Object.create({customerId:'CUS-1'})),/record|object|plain/i);
  assert.throws(()=>normalize(raw,context(),[{...accountRows()[0],'Bank Account ID':'BANK-1'},accountRows()[0]]),
    /duplicate|account|trusted/i);
});

test('normalizes deterministic replay intent without inventing receipt or doing any writes',()=>{
  const a=normalize(payload()),b=normalize({...payload(),items:[{...item()}]});
  assert.deepEqual(a,b);
  assert.equal(Object.keys(a).some(k=>/status|success|receipt/i.test(k)),false);
});
