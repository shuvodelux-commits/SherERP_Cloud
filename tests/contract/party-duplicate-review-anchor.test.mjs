import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPartyImport} from '../../src/party/party-import-plan.js';

const base=JSON.parse(readFileSync(
  new URL('../fixtures/party-import.synthetic.json',import.meta.url),'utf8'));
const source=()=>structuredClone(base);
const duplicates=()=>{
  const rows=source();
  const first=rows.CUSTOMERS[0];
  rows.CUSTOMERS.push(
    {...first,'Customer Name':'Second source business',_rowIndex:4},
    {...first,'Customer Name':'',_rowIndex:3}
  );
  return rows;
};
const dupReviews=plan=>plan.reviewItems.filter(x=>
  x.sourceGroup==='CUSTOMERS'&&x.reason==='DUPLICATE_ID');
const assertDuplicateQuarantined=plan=>{
  assert.equal(plan.summary.sourceRows,7);
  assert.equal(plan.summary.quarantinedRows,3);
  assert.equal(plan.summary.legacyLinks,4);
  assert.deepEqual(plan.links.filter(x=>x.sourceGroup==='CUSTOMERS'),[]);
  assert.equal(plan.reviewItems.filter(x=>
    x.sourceGroup==='CUSTOMERS'&&x.reason==='OTHER').length,0);
  assert.equal(dupReviews(plan).length,1);
  assert.equal(dupReviews(plan)[0].status,'OPEN');
};

test('exact duplicate Customer ID review anchors smallest physical row regardless snapshot array ordering',()=>{
  const rows=duplicates(),original=structuredClone(rows);
  const baseline=planPartyImport(rows,[]);
  assertDuplicateQuarantined(baseline);
  assert.equal(dupReviews(baseline)[0].legacySheetRow,2);
  assert.equal(dupReviews(baseline)[0].sourceId,'CUS-001');
  for(const order of [[2,0,1],[1,2,0],[2,1,0]]){
    const shuffled=structuredClone(rows);
    shuffled.CUSTOMERS=order.map(index=>rows.CUSTOMERS[index]);
    const plan=planPartyImport(shuffled,[]);
    assertDuplicateQuarantined(plan);
    assert.deepEqual(dupReviews(plan),dupReviews(baseline),
      'review ID, exact source identity and physical row must be stable');
  }
  assert.deepEqual(rows,original,'source snapshots cannot be changed in place');
});

test('missing physical-row metadata cannot displace an available exact source row',()=>{
  const rows=duplicates();
  delete rows.CUSTOMERS[0]._rowIndex;
  delete rows.CUSTOMERS[2]._rowIndex;
  const a=planPartyImport(rows,[]);
  const flipped=structuredClone(rows);
  flipped.CUSTOMERS.reverse();
  const b=planPartyImport(flipped,[]);
  assert.equal(dupReviews(a)[0].legacySheetRow,4);
  assert.deepEqual(dupReviews(a),dupReviews(b));

  delete rows.CUSTOMERS[1]._rowIndex;
  rows.CUSTOMERS.reverse();
  const unknown=planPartyImport(rows,[]);
  assert.equal(dupReviews(unknown)[0].legacySheetRow,null,
    'never invent missing physical row provenance');
  assertDuplicateQuarantined(unknown);
});

test('source group is part of duplicate key and padded original IDs are distinct',()=>{
  const rows=source();
  rows.SUPPLIERS[0]['Supplier ID']='CUS-001';
  rows.CUSTOMERS.push({
    ...rows.CUSTOMERS[0],'Customer ID':' CUS-001 ',_rowIndex:3
  });
  const plan=planPartyImport(rows,[]);
  assert.equal(plan.summary.quarantinedRows,0);
  assert.deepEqual(dupReviews(plan),[]);
  assert.deepEqual(plan.links.filter(x=>x.sourceGroup==='CUSTOMERS')
    .map(x=>x.sourceId).sort(),[' CUS-001 ','CUS-001']);
  assert.equal(plan.links.filter(x=>x.sourceGroup==='SUPPLIERS')[0].sourceId,'CUS-001');
});
