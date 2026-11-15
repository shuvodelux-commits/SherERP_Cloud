import test from 'node:test';
import assert from 'node:assert/strict';
import {originalDraftPayload} from './fixtures/m06-draft-payload-oracle.mjs';
import {validateSaleDraftPayload} from '../src/modules/sale-draft-payload.js';

const bankAccounts=[
  {'Bank Account ID':'BA-1','Account Name':'Trust Bank','Account Type':'Bank','Status':'Active','Is Deleted':'FALSE'},
  {'Bank Account ID':'MB-1','Account Name':'Mobile Wallet','Account Type':'Mobile Banking','Status':'Active','Is Deleted':'FALSE'}
];
const trusted={settings:{'POS Multi Payment Enabled':'true'},bankAccounts};
const item=(extra={})=>({
  productId:'P-1',name:'Copper Pipe',unit:'ft',qty:2,unitPrice:100,lineTotal:200,
  savedPriceMode:'manual',shortageResolution:'negative',...extra
});
const payload=(extra={})=>({
  customerId:'CUS-123',customerName:' Alice ',customerPhone:'01700000000',
  customerFatherName:'Dad',customerRelationType:'Husband',customerAddress:'Station Road',
  items:[item()],subtotal:200,discount:20,grandTotal:180,notes:'deliver in morning',
  payment:{amountReceived:'180',paymentMethod:'Cash',bankAccountId:''},...extra
});
const split=[
  {id:'row-cash',method:'Cash',amount:'80.00',accountId:''},
  {id:'row-bank',method:'Bank',amount:'100.00',accountId:'BA-1'}
];
const serial=x=>JSON.parse(JSON.stringify(x));
function parity(input,env=trusted){
  const expected=originalDraftPayload(input,env);
  let actual;
  try{actual={success:true,data:validateSaleDraftPayload(input,env)}}
  catch(error){actual={success:false,message:error.message}}
  assert.deepEqual(serial(actual),expected);
  return actual;
}

test('legacy single-payment draft preserves format and exact selected Customer ID',()=>{
  const r=parity(payload());
  assert.equal(r.success,true);
  assert.equal(r.data.customerId,'CUS-123');
  assert.equal(r.data.payment.amountReceived,'180');
  assert.equal(r.data.paymentMethod,undefined);
  assert.equal(JSON.parse(r.data.paymentJson).paymentMethod,'Cash');
});
test('split-payment draft preserves row order, IDs, raw strings rather than booked tender',()=>{
  const r=parity(payload({payment:{payments:split}}));
  assert.equal(r.success,true);
  assert.deepEqual(r.data.payment.payments.map(x=>x.id),['row-cash','row-bank']);
  assert.equal(r.data.payment.payments[0].amount,'80.00');
  assert.equal(r.data.payment.payments[1].accountId,'BA-1');
});
test('split payment must be enabled by business settings, not a user flag',()=>{
  const r=parity(payload({payment:{payments:split}}),{settings:{},bankAccounts});
  assert.equal(r.success,false);
  assert.match(r.message,/multiple payments are not enabled/);
});
test('split shape with empty payment array is rejected; no silent legacy fallback',()=>{
  const r=parity(payload({payment:{payments:[]}}));
  assert.equal(r.success,false);
  assert.match(r.message,/at least one payment row/);
});
test('source payment helper rejects duplicate row IDs before draft save',()=>{
  const rows=[split[0],{...split[1],id:split[0].id}];
  const r=parity(payload({payment:{payments:rows}}));
  assert.match(r.message,/duplicate payment row ID/);
});
test('source payment helper rejects inactive or mismatched bank account types',()=>{
  const inactive=parity(payload({payment:{payments:split}}),{
    settings:trusted.settings,bankAccounts:bankAccounts.map(x=>({...x,Status:'Inactive'}))
  });
  assert.match(inactive.message,/active payment account/);
  const wrongType=parity(payload({payment:{payments:[split[0],{...split[1],accountId:'MB-1'}]}}));
  assert.match(wrongType.message,/type does not match/);
});
test('source payment helper refuses amount with more than two decimal places',()=>{
  const r=parity(payload({payment:{payments:[{...split[0],amount:'80.001'},split[1]]}}));
  assert.match(r.message,/at most two decimal places/);
});
test('split allows Cash change, but stores original tender string before real posting',()=>{
  const r=parity(payload({payment:{payments:[
    {...split[0],amount:'220.00'}
  ]}}));
  assert.equal(r.success,true);
  assert.equal(r.data.payment.payments[0].amount,'220.00');
});
test('no product lines is rejected for saved draft',()=>{
  const r=parity(payload({items:[]}));
  assert.match(r.message,/at least one product/);
});
test('missing product ID or name and invalid quantities reject',()=>{
  for(const change of [{productId:''},{name:''},{qty:0},{qty:-1},{qty:'abc'}]){
    const r=parity(payload({items:[item(change)]}));
    assert.equal(r.success,false);
  }
});
test('invalid unit price or line total rejects before saving',()=>{
  for(const change of [{unitPrice:-1},{unitPrice:'abc'},{lineTotal:-2},{lineTotal:Infinity}]){
    const r=parity(payload({items:[item(change)]}));
    assert.equal(r.success,false);
  }
});
test('invalid subtotal/discount/grandTotal rejects, no invented math reconciliation',()=>{
  for(const change of [{subtotal:-1},{discount:'oops'},{grandTotal:-1}]){
    const r=parity(payload(change));
    assert.match(r.message,/Draft totals must be valid non-negative numbers/);
  }
  const unusual=parity(payload({subtotal:200,discount:90,grandTotal:180}));
  assert.equal(unusual.success,true,'source is a preflight, not a new total reconciliation engine');
});
test('bundle revision, vendor shortage, serial choices and warranty snapshot are preserved',()=>{
  const r=parity(payload({items:[item({
    productType:'Bundle',bundleRevision:4,shortageResolution:'vendor',vendorId:'V-4',
    vendorName:'Supplier V',vendorUnitCost:'17.5',savedPriceMode:'fixed',
    serialSelections:[{serial:'SN-1'}],warrantyData:{months:18}
  })]}));
  assert.equal(r.success,true);
  assert.equal(r.data.items[0].productType,'Bundle');
  assert.equal(r.data.items[0].bundleRevision,4);
  assert.equal(r.data.items[0].vendorId,'V-4');
  assert.equal(r.data.items[0].vendorUnitCost,17.5);
  assert.equal(r.data.items[0].serialSelections[0].serial,'SN-1');
});
test('unknown modes, relation type and unsafe revision use original defaults',()=>{
  const r=parity(payload({customerRelationType:'Other',items:[item({
    savedPriceMode:'invented',shortageResolution:'other',bundleRevision:'bad',
    productType:'Wrong'
  })]}));
  assert.equal(r.success,true);
  assert.equal(r.data.customerRelationType,'Father');
  assert.equal(r.data.items[0].savedPriceMode,'manual');
  assert.equal(r.data.items[0].shortageResolution,'negative');
  assert.equal(r.data.items[0].bundleRevision,0);
});
test('45,000 character size limit applies to serialized item/payment JSON',()=>{
  const r=parity(payload({items:[item({name:'X'.repeat(45050)})]}));
  assert.match(r.message,/draft is too large/);
});
test('long Notes are not incorrectly subjected to item/payment JSON limit',()=>{
  const r=parity(payload({notes:'N'.repeat(45050)}));
  assert.equal(r.success,true);
});
test('money and text fields round/trim with original Apps Script behavior',()=>{
  const r=parity(payload({
    customerId:'  CUS-123 ',customerName:' Alice ',
    items:[item({unitPrice:'12.345',lineTotal:'24.345'})],
    subtotal:99.995,discount:2.345,grandTotal:97.655
  }));
  assert.equal(r.success,true);
  assert.equal(r.data.customerName,'Alice');
  assert.equal(r.data.items[0].unitPrice,12.35);
  assert.equal(r.data.customerId,'CUS-123');
});
test('pure preflight never mutates incoming cart, payment rows, settings or bank snapshot',()=>{
  const input=payload({payment:{payments:split}}),env=structuredClone(trusted);
  const before=serial({input,env});
  parity(input,env);
  assert.deepEqual(serial({input,env}),before);
});
test('trusted server settings and bank account snapshots are mandatory',()=>{
  assert.throws(()=>validateSaleDraftPayload(payload(),{}),/trusted/i);
  assert.throws(()=>validateSaleDraftPayload(payload(),{settings:trusted.settings}),/trusted/i);
  assert.throws(()=>validateSaleDraftPayload(payload(),{settings:[],bankAccounts:[]}),/trusted/i);
});
