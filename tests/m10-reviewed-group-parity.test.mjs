import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessM10ReviewedGroupParity} from '../src/migration/m10-reviewed-group-parity.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const ID_GROUPS=['PRODUCT_CATEGORIES','PRODUCT_UNITS','EXPENSE_CATEGORIES','DELETE_LOG','SALES_DRAFT_AUDIT'];
const H=n=>n.toString(16).padStart(64,'0');
const summaries=()=>[
  ...ID_GROUPS.map((sheetKey,i)=>({
    sheetKey,rowCount:2,rowDigest:H(i+1),idDigest:H(i+11)
  })),
  {sheetKey:'LOGS',rowCount:2,rowDigest:H(6),positionDigest:H(16),
    identityKind:'SOURCE_ROW_POSITION_ONLY'}
];
const assess=(sourceSummaries=summaries(),d1Summaries=structuredClone(summaries()))=>
  assessM10ReviewedGroupParity({inventory,sourceSummaries,d1Summaries});
const failClosed=e=>e instanceof Error&&
  e.message==='M10 reviewed group parity evidence invalid';
const contains=(result,code)=>result.issues.find(x=>x.code===code)?.count??0;

test('five original-ID masters/audits and one positional-only LOGS match but NEVER authorize 49-group import',()=>{
  const source=summaries(),d1=structuredClone(source);
  const actual=assess(source,d1);
  assert.deepEqual(actual,{
    formatVersion:1,phase:'M10_REVIEWED_GROUP_PARITY',
    reviewedGroups:6,originalIdGroups:5,positionOnlyGroups:1,
    comparisonsComplete:true,groupsMatched:true,
    authorizesImport:false,productionReady:false,issues:[]
  });
  assert.deepEqual(source,summaries());
  assert.deepEqual(d1,summaries());
  const encoded=JSON.stringify(actual);
  assert.ok(!encoded.includes(H(11)));
  assert.ok(!encoded.includes(H(16)));
});

test('unordered exports remain parity-equivalent and duplicate source business identifiers are not inferred',()=>{
  const source=summaries();
  const d1=structuredClone(source).reverse().map(obj=>Object.fromEntries(Object.entries(obj).reverse()));
  assert.deepEqual(assess(source,d1).issues,[]);
  assert.equal(assess(source,d1).groupsMatched,true);
});

test('content-only row digest changes are detected without treating them as original-ID drift',()=>{
  const source=summaries(),d1=structuredClone(source);
  d1[0].rowDigest=H(29);
  const actual=assess(source,d1);
  assert.equal(actual.groupsMatched,false);
  assert.equal(actual.comparisonsComplete,true);
  assert.equal(contains(actual,'REVIEWED_ROW_DIGEST_MISMATCH'),1);
  assert.equal(contains(actual,'REVIEWED_ORIGINAL_ID_MISMATCH'),0);
});

test('original source IDs and physical row positions have different integrity error codes',()=>{
  const source=summaries(),d1=structuredClone(source);
  d1[1].idDigest=H(30);
  d1[5].positionDigest=H(31);
  const actual=assess(source,d1);
  assert.equal(contains(actual,'REVIEWED_ORIGINAL_ID_MISMATCH'),1);
  assert.equal(contains(actual,'REVIEWED_POSITION_PROVENANCE_MISMATCH'),1);
  assert.equal(contains(actual,'REVIEWED_ROW_DIGEST_MISMATCH'),0);
  assert.equal(actual.groupsMatched,false);
});

test('row-count drift is detected separately from valid digest shapes',()=>{
  const d1=summaries();d1[4].rowCount=3;
  const result=assess(summaries(),d1);
  assert.equal(contains(result,'REVIEWED_ROW_COUNT_MISMATCH'),1);
  assert.equal(result.groupsMatched,false);
});

test('missing source or D1 group blocks six-group comparisons with redacted counts',()=>{
  const s=summaries(),d=structuredClone(s);
  s.pop();d.shift();
  const r=assess(s,d);
  assert.equal(r.comparisonsComplete,false);
  assert.equal(r.groupsMatched,false);
  assert.equal(contains(r,'REVIEWED_MISSING_SOURCE'),1);
  assert.equal(contains(r,'REVIEWED_MISSING_D1'),1);
  assert.equal(r.authorizesImport,false);
  const missing=assessM10ReviewedGroupParity({inventory});
  assert.equal(missing.groupsMatched,false);
  assert.equal(missing.comparisonsComplete,false);
  assert.equal(contains(missing,'REVIEWED_SOURCE_EVIDENCE_MISSING'),1);
  assert.equal(contains(missing,'REVIEWED_D1_EVIDENCE_MISSING'),1);
});

test('duplicate source or D1 groups and unexpected unreviewed groups block parity',()=>{
  const original=summaries();
  const duplicate=[...original,{...original[0]}];
  const r1=assess(duplicate,original);
  assert.equal(contains(r1,'REVIEWED_DUPLICATE_SOURCE'),1);
  assert.equal(r1.groupsMatched,false);
  const r2=assess(original,duplicate);
  assert.equal(contains(r2,'REVIEWED_DUPLICATE_D1'),1);
  assert.equal(r2.groupsMatched,false);
  const extra={sheetKey:'SALES',rowCount:0,rowDigest:H(21),idDigest:H(22)};
  const r3=assess([...original,extra],original);
  assert.equal(contains(r3,'REVIEWED_UNEXPECTED_SOURCE'),1);
  assert.equal(r3.groupsMatched,false);
});

test('id-less LOGS can never masquerade as authentic-id evidence or gain an invented idDigest',()=>{
  const source=summaries(),d1=structuredClone(source);
  const spoof={sheetKey:'LOGS',rowCount:2,rowDigest:H(6),idDigest:H(16)};
  assert.throws(()=>assess([...source.slice(0,5),spoof],d1),failClosed);
  const both={...source[5],idDigest:H(16)};
  assert.throws(()=>assess([...source.slice(0,5),both],d1),failClosed);
  const wrongKind={...source[5],identityKind:'ORIGINAL_ID'};
  assert.throws(()=>assess([...source.slice(0,5),wrongKind],d1),failClosed);
  const missingPosition={...source[5]};delete missingPosition.positionDigest;
  assert.throws(()=>assess([...source.slice(0,5),missingPosition],d1),failClosed);
  assert.equal(assess(source,d1).originalIdGroups,5);
});

test('original-ID groups can never be silently recategorized as row-position-only',()=>{
  const source=summaries(),d1=structuredClone(source);
  const spoof={sheetKey:'DELETE_LOG',rowCount:2,rowDigest:H(4),
    positionDigest:H(14),identityKind:'SOURCE_ROW_POSITION_ONLY'};
  assert.throws(()=>assess(source.map(x=>x.sheetKey==='DELETE_LOG'?spoof:x),d1),failClosed);
});

test('invalid hashes, counts, getters, symbols and non-plain records fail with fixed error only',()=>{
  const source=summaries(),d1=structuredClone(source);
  for(const bad of [
    {...source[0],idDigest:'not-a-digest'},
    {...source[0],rowCount:-1},
    {...source[0],rowDigest:H(1).toUpperCase().replace(/A/g,'A')+'x'},
    {...source[0],Secret:'PRIVATE_ID'},
    {...source[0],rowCount:1.5},
    Object.assign(Object.create(null),source[0])
  ]){
    assert.throws(()=>assess([bad,...source.slice(1)],d1),failClosed);
  }
  const getter={...source[0]};
  Object.defineProperty(getter,'rowDigest',{enumerable:true,get(){throw new Error('PRIVATE_BUSINESS_VALUE')}});
  assert.throws(()=>assess([getter,...source.slice(1)],d1),failClosed);
  const symbol={...source[0]};symbol[Symbol('PRIVATE')]='secret';
  assert.throws(()=>assess([symbol,...source.slice(1)],d1),failClosed);
});

test('frozen 49-group inventory and six reviewed original column mappings must stay exact',()=>{
  const missing=structuredClone(inventory);missing.tables.pop();
  assert.throws(()=>assessM10ReviewedGroupParity({inventory:missing,sourceSummaries:summaries(),d1Summaries:summaries()}),failClosed);
  const dup=structuredClone(inventory);dup.tables[1].sheetKey=dup.tables[0].sheetKey;
  assert.throws(()=>assessM10ReviewedGroupParity({inventory:dup,sourceSummaries:summaries(),d1Summaries:summaries()}),failClosed);
  for(const key of [...ID_GROUPS,'LOGS']){
    const changed=structuredClone(inventory);
    changed.tables.find(x=>x.sheetKey===key).columns.push('Private Added Field');
    assert.throws(()=>assessM10ReviewedGroupParity({inventory:changed,sourceSummaries:summaries(),d1Summaries:summaries()}),failClosed,key);
  }
});
