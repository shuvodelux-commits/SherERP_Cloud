/**
 * M02 Run 8: synthetic, read-only new-shop Supplier receipt contract.
 * Not a D1 issuer, live Party writer, or authentic authorization proof.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {originalSourceIdPrefix} from '../src/db/m03-source-id-families.js';
import {reviewCleanShopSupplierReceiptShape} from '../src/party/m02-clean-shop-supplier-identity.js';

const HASH='a'.repeat(64);
const record=(sourceId,sequence,operationId='OP-SUP-00001',intentHash=HASH)=>({
  sourceGroup:'SUPPLIERS',sourceId,sequence,operationId,intentHash
});
const link=(sourceId,partyId)=>({
  sourceGroup:'SUPPLIERS',sourceId,partyId,
  role:'Supplier',status:'ACTIVE',linkBasis:'NEW_RECORD'
});
const shop=(shopId,sourceId='SUP-000001',partyId='PT-SUP-A',op='OP-SUP-00001')=>({
  shopId,receipts:[record(sourceId,Number(sourceId.split('-')[1]),op)],
  links:[link(sourceId,partyId)]
});
const sample=()=>({shops:[shop('SHOP-A'),shop('SHOP-B','SUP-000001','PT-SUP-B')]});
const audit=reviewCleanShopSupplierReceiptShape;
const codes=x=>x.blockers.map(x=>x.code);
const blocked=(x,code)=>{
  const r=audit(x);assert.equal(r.syntheticReceiptShapeValid,false);
  assert.ok(codes(r).includes(code),JSON.stringify(r));return r;
};

test('original Config-pinned Supplier ID family remains SUP, not an invented ID namespace',()=>{
  assert.equal(originalSourceIdPrefix('SUPPLIERS'),'SUP');
  assert.equal(originalSourceIdPrefix('CUSTOMERS'),'CUS');
});
test('two distinct shops can use same original-style Supplier ID with separate Party links',()=>{
  const a=sample(),prior=structuredClone(a),r=audit(a);
  assert.deepEqual(r,{
    syntheticReceiptShapeValid:true,
    counts:{shops:2,receipts:2,supplierLinks:2},
    blockers:[],
    sqlIssuanceAuthorized:false,
    historicalReconciled:false,
    financialPostingReady:false
  });
  assert.deepEqual(a,prior);
});
test('within one shop, two suppliers with independent stable Source IDs remain distinct',()=>{
  const x={shops:[shop('SHOP-A')]};
  x.shops[0].receipts.push(record('SUP-000007',7,'OP-SUP-00007'));
  x.shops[0].links.push(link('SUP-000007','PT-SUP-B'));
  assert.equal(audit(x).syntheticReceiptShapeValid,true);
});
test('two different operations cannot claim the same literal Supplier ID inside one shop',()=>{
  const x={shops:[shop('SHOP-A')]};
  x.shops[0].receipts.push(record('SUP-000001',1,'OP-SUP-00002','b'.repeat(64)));
  blocked(x,'DUPLICATE_SHOP_SUPPLIER_ID');
});
test('the same operation ID cannot claim another Supplier ID or changed intent',()=>{
  const x={shops:[shop('SHOP-A')]};
  x.shops[0].receipts.push(record('SUP-000002',2,'OP-SUP-00001','b'.repeat(64)));
  x.shops[0].links.push(link('SUP-000002','PT-SUP-OTHER'));
  blocked(x,'DUPLICATE_SHOP_OPERATION_ID');
});
test('forged prefix, bad padding, zero, mismatched sequence and unsafe integer fail closed',()=>{
  const scenarios=[
    ['CUSTOMERS','SUP-000001',1],
    ['SUPPLIERS','CUS-000001',1],
    ['SUPPLIERS','SUP-00001',1],
    ['SUPPLIERS','SUP-000000',0],
    ['SUPPLIERS','SUP-000002',1],
    ['SUPPLIERS','SUP-9007199254740992',9007199254740992]
  ];
  for(const [family,id,n]of scenarios){
    const x={shops:[shop('SHOP-A')]};
    x.shops[0].receipts[0]={...record(id,n),sourceGroup:family};
    assert.equal(audit(x).syntheticReceiptShapeValid,false,JSON.stringify([family,id,n]));
  }
});
test('invalid intent hashes and operation IDs cannot be treated as committed IDs',()=>{
  for(const patch of [
    {intentHash:'a'.repeat(63)},
    {intentHash:'A'.repeat(64)},
    {operationId:'  '},
    {operationId:'OP WITH SPACE'},
    {operationId:'x'.repeat(130)}
  ]){
    const x={shops:[shop('SHOP-A')]};
    Object.assign(x.shops[0].receipts[0],patch);
    blocked(x,'INVALID_SUPPLIER_RECEIPT');
  }
});
test('each supplier receipt requires exactly one ACTIVE, correctly scoped Party role link',()=>{
  const x={shops:[shop('SHOP-A')]};
  x.shops[0].links=[];
  blocked(x,'SUPPLIER_PARTY_LINK_MISSING');
  const y={shops:[shop('SHOP-A')]};
  y.shops[0].links.push({...y.shops[0].links[0]});
  blocked(y,'DUPLICATE_SHOP_SUPPLIER_LINK');
  const z={shops:[shop('SHOP-A')]};
  z.shops[0].links[0].role='Customer';
  blocked(z,'SUPPLIER_PARTY_LINK_INVALID');
});
test('cross-shop copy of a Supplier link cannot become a local Party authorization',()=>{
  const x=sample();x.shops[1].links=[link('SUP-000002','PT-SUP-A')];
  blocked(x,'SUPPLIER_PARTY_LINK_MISSING');
  blocked(x,'ORPHAN_SHOP_SUPPLIER_LINK');
});
test('two shop records claiming the same shop identity fail closed even if their names differ',()=>{
  const x=sample();x.shops[1].shopId='SHOP-A';
  blocked(x,'DUPLICATE_SHOP_SCOPE');
});
test('metadata validator never infers a sequence from receipt count or demands no gaps',()=>{
  const x={shops:[shop('SHOP-A','SUP-000020','PT-SUP-A','OP-SUP-00020')]};
  assert.equal(audit(x).syntheticReceiptShapeValid,true);
  const y={shops:[shop('SHOP-A','SUP-1000000','PT-SUP-A','OP-SUP-MILLION')]};
  assert.equal(audit(y).syntheticReceiptShapeValid,true);
});
test('malformed inputs and sensitive text are not disclosed in errors or reports',()=>{
  for(const x of [null,{},[],{shops:null},
    {shops:[{shopId:'',receipts:[],links:[]}]},
    {shops:[{shopId:'SHOP-A',receipts:[null],links:[]}]}]){
    assert.throws(()=>audit(x),err=>err.message==='Supplier receipt shape unavailable');
  }
  const x=sample();x.shops[0].receipts[0].operationId='SECRET PHONE 01799999999';
  const r=audit(x);
  assert.equal(r.syntheticReceiptShapeValid,false);
  assert.doesNotMatch(JSON.stringify(r),/SECRET_PHONE|01799999999|SHOP-A|PT-SUP|SUP-000001/);
});
