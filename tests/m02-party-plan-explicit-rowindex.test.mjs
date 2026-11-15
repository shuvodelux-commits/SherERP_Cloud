import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../src/party/party-import-plan.js';

const load=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url),'utf8'));
const source=()=>load('party-import.synthetic.json');
const reviews=()=>load('party-approved.synthetic.json');
const groups=['CUSTOMERS','SUPPLIERS','VENDORS','FINANCE_PERSONS','EXPENSE_PAYEES'];
const plan=(rows=source())=>planPartyImport(rows,reviews());
const rowError=/Invalid legacy row position/;

test('explicit null physical row provenance is invalid in every original master group',()=>{
  for(const group of groups){
    const rows=source();
    rows[group][0]._rowIndex=null;
    const original=structuredClone(rows);
    assert.throws(()=>plan(rows),rowError,group);
    assert.deepEqual(rows,original,'direct planner cannot remove or coerce source locator');
  }
});

test('own undefined row locator is not equivalent to omitted optional source locator',()=>{
  for(const group of groups){
    const rows=source();
    rows[group][0]._rowIndex=undefined;
    assert.equal(Object.hasOwn(rows[group][0],'_rowIndex'),true);
    const original=structuredClone(rows);
    assert.throws(()=>plan(rows),rowError,group);
    assert.deepEqual(rows,original);
  }
});

test('present low, malformed, fractional and unsafe row locators retain fail-closed errors',()=>{
  for(const value of [0,1,-2,1.1,'2',false,true,NaN,Infinity,2**53,Number.MAX_VALUE]){
    const rows=source();
    rows.CUSTOMERS[0]._rowIndex=value;
    assert.throws(()=>plan(rows),rowError,'invalid '+String(value));
  }
});

test('genuinely absent row index stays supported with an original text ID',()=>{
  const rows=source();
  for(const group of groups)delete rows[group][0]._rowIndex;
  const original=structuredClone(rows);
  const out=plan(rows);
  assert.equal(out.summary.sourceRows,5);
  assert.equal(out.summary.legacyLinks,5);
  assert.equal(out.summary.quarantinedRows,0);
  assert.deepEqual(out.links.map(link=>link.legacySheetRow),[null,null,null,null,null]);
  assert.deepEqual(rows,original,'no physical row numbers may be invented or assigned to source');
});

test('row 2 and upper safe bound preserve exact physical row anchors and identity links',()=>{
  const rows=source();
  rows.CUSTOMERS[0]._rowIndex=Number.MAX_SAFE_INTEGER;
  rows.VENDORS[0]._rowIndex=2;
  const original=structuredClone(rows);
  const out=plan(rows);
  const customer=out.links.find(link=>link.sourceGroup==='CUSTOMERS');
  assert.equal(customer.legacySheetRow,Number.MAX_SAFE_INTEGER);
  assert.equal(customer.sourceId,'CUS-001');
  assert.equal(out.links.find(link=>link.sourceGroup==='VENDORS').legacySheetRow,2);
  assert.equal(out.summary.legacyLinks,5);
  assert.deepEqual(rows,original);
});

test('source row order, optional locator removal and object insertion order do not alter Party IDs',()=>{
  const before=source(),after=source();
  const current=plan(before);
  after.FINANCE_PERSONS[0]=Object.fromEntries(
    Object.entries(after.FINANCE_PERSONS[0]).reverse()
  );
  delete after.FINANCE_PERSONS[0]._rowIndex;
  const revised=plan(after);
  assert.deepEqual(revised.parties.map(p=>p.partyId),current.parties.map(p=>p.partyId));
  assert.deepEqual(revised.roles,current.roles);
  assert.deepEqual(revised.links.map(l=>l.sourceId),current.links.map(l=>l.sourceId));
  assert.equal(revised.links.find(l=>l.sourceGroup==='FINANCE_PERSONS').legacySheetRow,null);
});

test('two actual repeated physical positions remain rejected and no auto-merge is introduced',()=>{
  const rows=source();
  rows.CUSTOMERS.push({
    'Customer ID':'CUS-002','Customer Name':'Different name',
    Phone:'01912345678',Status:'Active',_rowIndex:2
  });
  assert.throws(()=>plan(rows),/Duplicate source row position/);
  const two=source();
  two.CUSTOMERS.push({
    'Customer ID':'CUS-002','Customer Name':'Different name',
    Phone:'01912345678',Status:'Active',_rowIndex:3
  });
  const out=planPartyImport(two,[]);
  assert.ok(out.links.some(l=>l.sourceId==='CUS-002'));
  assert.equal(out.summary.reviewedGroups,0,'shared names or phones cannot auto-approve a Party merge');
  assert.equal(out.summary.sourceRows,6);
});
