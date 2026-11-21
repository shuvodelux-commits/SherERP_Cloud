import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sourceSupplierParties,projectSupplierStatement} from '../../src/ui/hisabiq/party-workspace.mjs';

const sample=(changes={})=>({
  'Supplier ID':'SUP-000014','Supplier Name':'Rahim Traders',
  Phone:'01711000000',Address:'Rajshahi','Current Due':500.25,
  'Opening Balance':-250.50,
  'Opening Payable':0,'Supplier Advance':250.50,Status:'Active',
  ...changes
});
const ledger=(changes={})=>({
  success:true,data:{
    scope:'purchase-and-cash-payment',supplierId:'SUP-000014',
    supplierName:'Rahim Traders',phone:'01711000000',currentDuePaisa:50025,
    openingBalancePaisa:35025,openingPayablePaisa:35025,supplierAdvancePaisa:0,
    hasMore:false,entries:[],
    ...changes
  }
});

test('same Supplier role displays historical advance and current payable independently without netting',()=>{
  const [supplier]=sourceSupplierParties({suppliers:[sample()]});
  assert.equal(supplier.gross.Supplier.receivablePaisa,25050);
  assert.equal(supplier.gross.Supplier.payablePaisa,50025);
  assert.deepEqual(supplier.supplierOpening,{
    signedPaisa:-25050,payablePaisa:0,advancePaisa:25050
  });
  assert.equal(supplier.partyId,null,'source Supplier is not a reviewed Party identity');
});

test('negative current due and separate historical advance add only within Supplier receivable, never reduce payable',()=>{
  const [supplier]=sourceSupplierParties({suppliers:[
    sample({'Current Due':-20.25})
  ]});
  assert.equal(supplier.gross.Supplier.receivablePaisa,27075);
  assert.equal(supplier.gross.Supplier.payablePaisa,0);
});

test('positive opening payable is already in Current Due and must not be counted twice',()=>{
  const [supplier]=sourceSupplierParties({suppliers:[sample({
    'Current Due':350.25,'Opening Balance':350.25,
    'Opening Payable':350.25,'Supplier Advance':0
  })]});
  assert.equal(supplier.gross.Supplier.payablePaisa,35025);
  assert.equal(supplier.gross.Supplier.receivablePaisa,0);
});

test('pre-opening-schema Supplier read remains fully backwards compatible',()=>{
  const legacy=sample({'Current Due':-45.15});
  delete legacy['Opening Payable'];
  delete legacy['Supplier Advance'];
  const [supplier]=sourceSupplierParties({suppliers:[legacy]});
  assert.equal(supplier.gross.Supplier.receivablePaisa,4515);
  assert.equal(supplier.gross.Supplier.payablePaisa,0);
  assert.equal(supplier.supplierOpening,null);
});

test('inconsistent/partial Supplier opening evidence must fail closed before showing balances',()=>{
  const failures=[
    {'Opening Payable':undefined},
    {'Supplier Advance':undefined},
    {'Opening Balance':-200.00},
    {'Opening Payable':10},
    {'Supplier Advance':-1},
    {'Opening Payable':1,'Supplier Advance':1,'Opening Balance':1},
    {'Opening Balance':'0.001'},
    {'Supplier Advance':'1e3'}
  ];
  for(const patch of failures){
    const row=sample(patch);
    if(Object.hasOwn(patch,'Opening Payable')&&patch['Opening Payable']===undefined)delete row['Opening Payable'];
    if(Object.hasOwn(patch,'Supplier Advance')&&patch['Supplier Advance']===undefined)delete row['Supplier Advance'];
    assert.throws(()=>sourceSupplierParties({suppliers:[row]}),/source|opening|balance|invalid|unavailable/i);
  }
});

test('verified positive Historical Opening ledger entry uses source operation UUID and original gross due',()=>{
  const ref='c08e7889-d8c7-41e8-8a63-b8f7d2fc3849';
  const out=projectSupplierStatement(ledger({currentDuePaisa:35025,entries:[{
    kind:'Historical Opening',reference:ref,purchaseDate:'2026-11-21',
    debitPaisa:35025,creditPaisa:0,balancePaisa:35025
  }]}),'SUP-000014');
  assert.equal(out.entries.length,1);
  assert.equal(out.entries[0].kind,'Historical Opening');
  assert.equal(out.entries[0].reference,ref);
  assert.equal(out.currentDuePaisa,35025);
  assert.deepEqual(out.supplierOpening,{
    signedPaisa:35025,payablePaisa:35025,advancePaisa:0
  });
});

test('negative opening remains an independent asset with no fabricated ledger credit',()=>{
  const out=projectSupplierStatement(ledger({
    currentDuePaisa:0,openingBalancePaisa:-25050,
    openingPayablePaisa:0,supplierAdvancePaisa:25050,
    entries:[{
      kind:'Historical Opening',
      reference:'5cd483a9-7fd8-4ef6-9674-046344a12c0f',
      purchaseDate:'2026-11-21',debitPaisa:0,creditPaisa:0,balancePaisa:0
    }]
  }),'SUP-000014');
  assert.equal(out.supplierOpening.advancePaisa,25050);
  assert.equal(out.currentDuePaisa,0);
  assert.equal(out.entries[0].creditPaisa,0);
});

test('forged opening statement source and source-liability inconsistencies are rejected',()=>{
  for(const patch of [
    {openingBalancePaisa:20,openingPayablePaisa:0,supplierAdvancePaisa:0},
    {openingBalancePaisa:-50,openingPayablePaisa:50,supplierAdvancePaisa:0},
    {openingPayablePaisa:undefined},
    {supplierAdvancePaisa:-1},
    {entries:[{kind:'Historical Opening',reference:'PUR-000001',
      purchaseDate:'2026-11-21',debitPaisa:35025,creditPaisa:0,balancePaisa:50025}]},
    {entries:[{kind:'Historical Opening',reference:'00000000-0000-4000-8000-000000000000',
      purchaseDate:'2026-11-21',debitPaisa:35025,creditPaisa:1,balancePaisa:50025}]}
  ]){
    const data=ledger(patch);
    if(patch.openingPayablePaisa===undefined)delete data.data.openingPayablePaisa;
    assert.throws(()=>projectSupplierStatement(data,'SUP-000014'),/statement|opening|row|unavailable|invalid/i);
  }
});
