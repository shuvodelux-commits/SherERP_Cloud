import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSaleDraftPayload} from '../src/modules/sale-draft-payload.js';

// RED: new lossless guard intentionally absent before implementation.
const preflight=await import('../src/modules/m06-legacy-draft-loss-guard.js')
  .then(x=>x.prepareLosslessLegacySaleDraft)
  .catch(e=>{if(e?.code==='ERR_MODULE_NOT_FOUND')return undefined;throw e;});
const guard=(payload,trusted)=>{
 assert.equal(typeof preflight,'function','M06 lossless legacy draft guard is missing');
 return preflight(payload,trusted);
};
const bankAccounts=[
 {'Bank Account ID':'B-1','Account Name':'Bank One','Account Type':'Bank',
  Status:'Active','Is Deleted':'FALSE'},
 {'Bank Account ID':'W-1','Account Name':'Wallet One','Account Type':'Mobile Banking',
  Status:'Active','Is Deleted':'FALSE'}
];
const trusted={settings:{'POS Multi Payment Enabled':'true'},bankAccounts};
const item=(patch={})=>({
 productId:'P-1',name:'Copper Pipe',unit:'Feet',qty:2,unitPrice:100,lineTotal:200,
 savedPriceMode:'manual',shortageResolution:'negative',vendorId:'',
 vendorName:'',vendorUnitCost:'',productType:'Standard',bundleRevision:0,
 serialSelections:[],warrantyData:null,...patch
});
const payload=(patch={})=>({
 customerId:'',customerName:'',customerPhone:'',customerFatherName:'',
 customerRelationType:'Father',customerAddress:'',
 items:[item()],subtotal:200,discount:0,grandTotal:200,notes:'',
 payment:{amountReceived:'200',paymentMethod:'Cash',bankAccountId:''},
 ...patch
});
const split=()=>({
 payments:[
  {id:'BANK',method:'Bank',amount:'150.00',accountId:'B-1'},
  {id:'CASH',method:'Cash',amount:'60.00',accountId:''}
 ]
});
const clone=x=>structuredClone(x);
const expected=(p,env=trusted)=>validateSaleDraftPayload(p,env);
const check=(p,env=trusted)=>{
 const before=clone({p,env}),result=guard(p,env);
 assert.deepEqual({p,env},before,'No mutation to source input or trusted settings/accounts');
 assert.equal(result.draftFormat,'legacy');
 assert.equal(result.postingAllowed,false);
 assert.deepEqual(result.candidate,expected(p,env),'Legacy output must be identical to frozen source port');
 return result;
};
const blocked=(p,pattern=/NEEDS_REVIEW|versioned|discarded/i)=>
 assert.throws(()=>guard(p,trusted),pattern);

test('ordinary Cash-only historical draft keeps exact source Items JSON and Payment JSON',()=>{
 const p=payload(),result=check(p);
 assert.equal(result.candidate.items.length,1);
 assert.equal(result.candidate.itemsJson,expected(p).itemsJson);
 assert.equal(result.candidate.paymentJson,expected(p).paymentJson);
 assert.equal(result.candidate.customerId,'');
});

test('ordinary Bank/Cash split tender stores untouched original input rows and change only on later invoice',()=>{
 const p=payload({payment:split()}),result=check(p);
 assert.equal(result.candidate.payment.payments.length,2);
 assert.deepEqual(result.candidate.payment.payments.map(x=>x.id),['BANK','CASH']);
 assert.equal(result.candidate.payment.payments[1].amount,'60.00');
});

test('legacy bundle, serial, warranty and vendor fields remain source-faithful',()=>{
 const p=payload({items:[item({
  productType:'Bundle',bundleRevision:2,
  serialSelections:[{serial:'SERIAL-001'}],
  warrantyData:{months:12},vendorId:'V-1',vendorUnitCost:25,
  savedPriceMode:'fixed'
 })]});
 const r=check(p);
 assert.equal(r.candidate.items[0].productType,'Bundle');
 assert.equal(r.candidate.items[0].bundleRevision,2);
 assert.equal(r.candidate.items[0].vendorId,'V-1');
});

test('mixed-unit original conversion, factor, price and FIFO snapshots cannot be silently discarded',()=>{
 for(const field of [
  'unitBreakdown','unitBreakdownSnapshot','unitPricingSnapshot','unitRevision',
  'conversionRevision','baseQty','stockUnit','fifoDraws','shortfallBaseQty',
  'unitConversions','unitSnapshot','priceSnapshot'
 ]){
  const p=payload({items:[item({[field]:field==='baseQty'?2:[]})]});
  blocked(p);
 }
});

test('Tiles Box/Pcs/Sqft measurement and exact money evidence cannot be silently dropped',()=>{
 for(const field of [
  'measurementSnapshot','tileMeasurementSnapshot','salePreview','quantity',
  'lineAmountMinor','requestedSqft','actualSqft','billingQuantity',
  'boxConversionId','piecesPerBox','pricingUnit','tileRevision'
 ]){
  const p=payload({items:[item({[field]:{source:'D1'}})]});
  blocked(p);
 }
});

test('unknown item and top-level fields reject loss rather than being erased by legacy serializer',()=>{
 blocked(payload({items:[item({inventoryAdjustment:true})]}),/discarded|review/i);
 blocked(payload({unitSnapshot:{productId:'P-1'}}),/discarded|versioned|review/i);
 blocked(payload({unknownBusinessFlag:true}),/discarded|review/i);
});

test('legacy base-unit Sqft may be valid for ordinary non-Tile goods; do not infer missing conversion',()=>{
 const p=payload({items:[item({unit:'Sqft',qty:2,unitPrice:100,lineTotal:200})]});
 check(p);
});

test('unknown payment header/child fields cannot disappear from stored original Payment JSON',()=>{
 const p=payload({payment:split()});
 p.payment.payments[0].bankAccountName='untrusted name';
 blocked(p,/discarded|review/i);
 const single=payload();
 single.payment.cashChange=15;
 blocked(single,/discarded|review/i);
});

test('split payment off business setting still fails from original source rather than being bypassed',()=>{
 const p=payload({payment:split()});
 assert.throws(()=>guard(p,{settings:{},bankAccounts}),/multiple payments are not enabled/i);
});

test('legacy invalid negative quantity and invalid split bank account still delegate unchanged source errors',()=>{
 const badQty=payload({items:[item({qty:-1})]});
 assert.throws(()=>guard(badQty,trusted),/quantity must be greater than zero/);
 const badBank=payload({payment:{payments:[{id:'B',method:'Bank',accountId:'OTHER',amount:'200'}]}});
 assert.throws(()=>guard(badBank,trusted),/active payment account/);
});

test('payload and draft item accessor cannot execute caller-supplied getters',()=>{
 const p=payload();
 Object.defineProperty(p,'notes',{enumerable:true,get(){throw Error('NEVER_CALL_PAYLOAD_GETTER')}});
 blocked(p,/accessor|untrusted|invalid/i);
 const x=payload();
 Object.defineProperty(x.items[0],'unitBreakdownSnapshot',{
  enumerable:true,get(){throw Error('NEVER_CALL_ITEM_GETTER')}
 });
 blocked(x,/accessor|untrusted|invalid/i);
});

test('payment item and trusted bank account accessors are never used as readback authority',()=>{
 const p=payload({payment:split()});
 Object.defineProperty(p.payment.payments[0],'amount',{
  enumerable:true,get(){throw Error('NEVER_CALL_AMOUNT_GETTER')}
 });
 blocked(p,/accessor|untrusted|invalid/i);
 const env=clone(trusted);
 Object.defineProperty(env.bankAccounts[0],'Bank Account ID',{
  enumerable:true,get(){throw Error('NEVER_CALL_BANK_GETTER')}
 });
 assert.throws(()=>guard(payload({payment:split()}),env),/accessor|untrusted|invalid/i);
});

test('empty cart, malformed saved draft and non-object rows fail closed',()=>{
 assert.throws(()=>guard(payload({items:[]}),trusted),/at least one product/i);
 assert.throws(()=>guard(payload({items:[null]}),trusted),/invalid|untrusted/i);
 assert.throws(()=>guard(null,trusted),/invalid|untrusted/i);
});
