import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';

const baseline=JSON.parse(readFileSync(
  new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const source=(supplierPhone)=> {
  const snapshot=structuredClone(baseline);
  snapshot.CUSTOMERS[0]['Customer Name']='Unrelated Customer Name';
  snapshot.SUPPLIERS[0]['Supplier Name']='Different Supplier Name';
  snapshot.CUSTOMERS[0].Phone='01700000000';
  snapshot.SUPPLIERS[0].Phone=supplierPhone;
  return snapshot;
};
const shared=plan=>plan.reviewItems.filter(x=>x.reason==='SHARED_PHONE');
const id= (plan,group)=>plan.links.find(x=>x.sourceGroup===group).partyId;

test('equivalent Bangladesh local and +880 mobile forms trigger human-review suggestion only',()=>{
  const input=source('+8801700000000'),original=structuredClone(input);
  const result=planPartyImport(input,[]);
  assert.equal(result.summary.proposedParties,5);
  assert.equal(result.summary.legacyLinks,5);
  assert.notEqual(id(result,'CUSTOMERS'),id(result,'SUPPLIERS'),
    'phone equality never establishes Party legal identity');
  assert.equal(shared(result).length,1,
    'a +880 mobile is the same review candidate as its local 0-prefixed form');
  assert.equal(result.reviewItems.some(x=>x.reason==='SAME_NAME'),false);
  assert.ok(result.links.every(x=>x.linkBasis==='ORIGINAL_RECORD'));
  assert.equal(result.accounts,undefined);
  assert.equal(result.settlements,undefined);
  assert.deepEqual(input,original,'original source phone and IDs remain untouched');
});

test('a bare 8801 mobile and its 01 local form generate same review candidate',()=>{
  const plan=planPartyImport(source('8801700000000'));
  assert.equal(shared(plan).length,1);
  assert.equal(plan.summary.reviewedGroups,0);
  assert.notEqual(id(plan,'CUSTOMERS'),id(plan,'SUPPLIERS'));
});

test('common phone punctuation and whitespace do not hide +880 review candidates',()=>{
  const plan=planPartyImport(source(' +880 170-000-0000 '));
  assert.equal(shared(plan).length,1);
  assert.equal(plan.links.find(x=>x.sourceGroup==='SUPPLIERS').sourceId,'SUP-001');
});

test('different country codes and different mobile numbers never falsely match local review key',()=>{
  for(const phone of ['+9711700000000','+8801800000000','+880170000000','01712345678']){
    const plan=planPartyImport(source(phone));
    assert.equal(shared(plan).length,0,phone);
    assert.notEqual(id(plan,'CUSTOMERS'),id(plan,'SUPPLIERS'));
  }
});

test('only explicit reviewed evidence can join the phone-related Customer and Supplier',()=>{
  const input=source('+8801700000000');
  const approval={
    members:[
      {sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},
      {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'}
    ],reviewedBy:'synthetic-reviewer',
    reviewedAt:'2026-11-15T12:00:00Z',
    approvalRef:'SYNTHETIC-BD-MOBILE-APPROVAL'
  };
  const before=structuredClone({input,approval});
  const result=planPartyImport(input,[approval]);
  assert.equal(result.summary.proposedParties,4);
  assert.equal(result.summary.reviewedGroups,1);
  assert.equal(id(result,'CUSTOMERS'),id(result,'SUPPLIERS'));
  assert.ok(result.links.some(x=>x.linkBasis==='HUMAN_VERIFIED'&&
    x.approvalRef===approval.approvalRef));
  assert.equal(shared(result).length,0);
  assert.deepEqual({input,approval},before);
});
