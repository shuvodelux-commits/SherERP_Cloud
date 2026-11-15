import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';

const fixture=JSON.parse(readFileSync(
  new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const source=()=>structuredClone(fixture);
const customerLinks=plan=>plan.links.filter(link=>link.sourceGroup==='CUSTOMERS');
const customerReviews=plan=>plan.reviewItems.filter(review=>review.sourceGroup==='CUSTOMERS');

test('named and unnamed source rows with the same ID both remain quarantined',()=>{
  const snapshot=source();
  snapshot.CUSTOMERS.push({
    ...snapshot.CUSTOMERS[0],
    'Customer Name':'',
    _rowIndex:3
  });
  const input=structuredClone(snapshot);
  const result=planPartyImport(snapshot,[]);
  assert.equal(customerLinks(result).length,0,'duplicate Customer ID must not become an importable link');
  assert.deepEqual(customerReviews(result).map(item=>item.reason),['DUPLICATE_ID']);
  assert.equal(result.summary.quarantinedRows,2);
  assert.equal(result.summary.legacyLinks,4);
  assert.deepEqual(snapshot,input,'planning must not change source rows');
});

test('two unnamed rows sharing the same ID have exactly one duplicate review',()=>{
  const snapshot=source();
  snapshot.CUSTOMERS[0]['Customer Name']='  ';
  snapshot.CUSTOMERS.push({...snapshot.CUSTOMERS[0],_rowIndex:3});
  const result=planPartyImport(snapshot,[]);
  assert.equal(customerLinks(result).length,0);
  assert.deepEqual(customerReviews(result).map(item=>item.reason),['DUPLICATE_ID']);
  assert.equal(result.summary.quarantinedRows,2);
});

test('a single unnamed original ID still produces OTHER review without import link',()=>{
  const snapshot=source();
  snapshot.CUSTOMERS[0]['Customer Name']='';
  const result=planPartyImport(snapshot,[]);
  assert.equal(customerLinks(result).length,0);
  assert.deepEqual(customerReviews(result).map(item=>item.reason),['OTHER']);
  assert.equal(result.summary.quarantinedRows,1);
});

test('equal ID text in different source groups is never a duplicate source identity',()=>{
  const snapshot=source();
  snapshot.SUPPLIERS[0]['Supplier ID']='CUS-001';
  const result=planPartyImport(snapshot,[]);
  assert.equal(customerLinks(result).length,1);
  assert.equal(result.links.filter(link=>link.sourceGroup==='SUPPLIERS').length,1);
  assert.equal(result.reviewItems.some(item=>item.reason==='DUPLICATE_ID'),false);
  assert.notEqual(result.links.find(link=>link.sourceGroup==='CUSTOMERS').partyId,
    result.links.find(link=>link.sourceGroup==='SUPPLIERS').partyId);
});

test('human review proof cannot bypass source ID duplicates hidden by missing names',()=>{
  const snapshot=source();
  snapshot.CUSTOMERS.push({...snapshot.CUSTOMERS[0],'Customer Name':'',_rowIndex:3});
  assert.throws(()=>planPartyImport(snapshot,[{
    members:[
      {sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},
      {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'}
    ],
    reviewedBy:'admin-01',reviewedAt:'2026-11-14T12:00:00Z',
    approvalRef:'REVIEW-001'
  }]),/unknown|quarantin/i);
});
