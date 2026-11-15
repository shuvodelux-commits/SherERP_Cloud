import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';

const fixture=JSON.parse(readFileSync(new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const snapshot=()=>structuredClone(fixture);

test('rejects two separate Party IDs that claim the same physical row in one source group',()=>{
  const rows=snapshot();
  rows.CUSTOMERS.push({'Customer ID':'CUS-002','Customer Name':'Other','Phone':'01811111111','_rowIndex':2});
  assert.throws(()=>planPartyImport(rows),/duplicate.*source row position/i);
});

test('rejects a quarantined missing-ID row reusing a valid source position',()=>{
  const rows=snapshot();
  rows.SUPPLIERS.push({'Supplier ID':'','Supplier Name':'No ID','Phone':'','_rowIndex':2});
  assert.throws(()=>planPartyImport(rows),/duplicate.*source row position/i);
});

test('rejects indistinguishable, unpositioned missing-ID records instead of duplicating review actions',()=>{
  const rows=snapshot();
  const noId={'Customer ID':'','Customer Name':'Unidentified','Phone':'00000000000'};
  rows.CUSTOMERS.push(structuredClone(noId),structuredClone(noId));
  assert.throws(()=>planPartyImport(rows),/duplicate.*review.*(id|provenance)/i);
});

test('allows the same row position across unrelated legacy source sheets',()=>{
  const plan=planPartyImport(snapshot());
  assert.equal(plan.summary.legacyLinks,5);
  assert.ok(plan.links.every(link=>link.legacySheetRow===2));
});

test('allows physical row gaps and produces the same plan after JSON export reordering',()=>{
  const rows=snapshot();
  rows.CUSTOMERS.push({'Customer ID':'CUS-002','Customer Name':'Second','Phone':'','_rowIndex':5});
  const before=structuredClone(rows);
  const a=planPartyImport(rows);
  const reordered=structuredClone(rows);
  reordered.CUSTOMERS.reverse();
  assert.deepEqual(planPartyImport(reordered),a);
  assert.deepEqual(rows,before,'planner must not mutate caller export');
  assert.deepEqual(a.links.filter(link=>link.sourceGroup==='CUSTOMERS').map(link=>link.legacySheetRow),[2,5]);
});
