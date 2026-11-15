import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';

const fixture=JSON.parse(readFileSync(
  new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const source=()=>structuredClone(fixture);
const copyWithId=(id,name='Distinct local shop')=>({
  ...source().CUSTOMERS[0],
  'Customer ID':id,'Customer Name':name,'Phone':'01598765432',_rowIndex:3
});
const dupReviews=plan=>plan.reviewItems.filter(x=>x.reason==='DUPLICATE_ID'&&x.sourceGroup==='CUSTOMERS');

test('trim-equivalent IDs quarantine both raw source identities rather than creating independent Customer Parties',()=>{
  const rows=source();
  rows.CUSTOMERS.push(copyWithId(' CUS-001 '));
  const original=structuredClone(rows);
  const plan=planPartyImport(rows,[]);
  assert.equal(plan.summary.sourceRows,6);
  assert.equal(plan.summary.quarantinedRows,2);
  assert.equal(plan.summary.legacyLinks,4);
  assert.equal(plan.links.filter(x=>x.sourceGroup==='CUSTOMERS').length,0);
  assert.equal(dupReviews(plan).length,1);
  assert.equal(dupReviews(plan)[0].status,'OPEN');
  assert.equal(dupReviews(plan)[0].sourceId!==null,true);
  const reversed=source();
  reversed.CUSTOMERS=[...rows.CUSTOMERS].reverse();
  assert.deepEqual(dupReviews(plan),dupReviews(planPartyImport(reversed,[])),
    'review provenance must not depend on input order');
  assert.deepEqual(rows,original,'collision validation cannot alter raw source data');
});

test('reviewed Party links cannot approve a quarantined trim-equivalent source ID',()=>{
  const rows=source();
  rows.CUSTOMERS.push(copyWithId('CUS-001 '));
  const approved=[{
    members:[{sourceGroup:'CUSTOMERS',sourceId:'CUS-001'},
      {sourceGroup:'SUPPLIERS',sourceId:'SUP-001'}],
    reviewedBy:'admin-01',reviewedAt:'2026-11-14T12:00:00Z',
    approvalRef:'REVIEW-001'
  }];
  assert.throws(()=>planPartyImport(rows,approved),/unknown|quarantin/i);
});

test('collision involving nameless source still yields one duplicate-ID review without OTHER record',()=>{
  const rows=source();
  rows.CUSTOMERS.push(copyWithId(' CUS-001 ',''));
  const plan=planPartyImport(rows,[]);
  assert.equal(plan.summary.quarantinedRows,2);
  assert.equal(dupReviews(plan).length,1);
  assert.equal(plan.reviewItems.some(x=>x.sourceGroup==='CUSTOMERS'&&x.reason==='OTHER'),false);
  assert.equal(plan.links.some(x=>x.sourceGroup==='CUSTOMERS'),false);
});

test('different legacy source groups and isolated whitespace ID retain distinct exact provenance',()=>{
  const rows=source();
  rows.SUPPLIERS[0]['Supplier ID']='CUS-001';
  const crossGroup=planPartyImport(rows,[]);
  assert.equal(crossGroup.summary.quarantinedRows,0);
  const customer=crossGroup.links.find(x=>x.sourceGroup==='CUSTOMERS');
  const supplier=crossGroup.links.find(x=>x.sourceGroup==='SUPPLIERS');
  assert.equal(customer.sourceId,'CUS-001');
  assert.equal(supplier.sourceId,'CUS-001');
  assert.notEqual(customer.partyId,supplier.partyId,'same raw ID in different groups is not a merge');

  const padded=source();
  padded.CUSTOMERS[0]['Customer ID']=' CUS-001 ';
  const single=planPartyImport(padded,[]);
  assert.equal(single.summary.quarantinedRows,0);
  assert.equal(single.links.find(x=>x.sourceGroup==='CUSTOMERS').sourceId,' CUS-001 ');
});
