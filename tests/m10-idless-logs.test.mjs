import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeM10IdlessLogs} from '../src/migration/m10-idless-logs.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const logs=()=>[
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা 오류  ',_rowIndex:2},
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  বাংলা 오류  ',_rowIndex:3},
  {Timestamp:'',Context:'Report',Message:'missing timestamp',_rowIndex:4}
];
const digest=rows=>summarizeM10IdlessLogs({inventory,rows});
const fixed=e=>e.message==='M10 LOGS evidence invalid'&&!/PRIVATE|SECRET|বাংলা/.test(e.message);

test('M10 logs retain duplicate diagnostic rows and use source-row provenance, not invented Log IDs',()=>{
  const rows=logs(),before=structuredClone(rows);
  const result=digest(rows);
  assert.deepEqual(result,{
    sheetKey:'LOGS',rowCount:3,
    rowDigest:'a586ac3dbd0fee0ecc077bd83e984eeb96a450ddac2ae06bbb1397fef895341f',
    positionDigest:'b41cf5dd34b1e4b6cf99292eec61ab92dd94a7a2c08fa282c4d93d0cf009e5f4',
    identityKind:'SOURCE_ROW_POSITION_ONLY'
  });
  assert.deepEqual(rows,before);
  assert.equal(Object.hasOwn(result,'idDigest'),false);
  // Match serialized source *values*, not the prefix "POS" inside the
  // intended, public SOURCE_ROW_POSITION_ONLY provenance classification.
  const report=JSON.stringify(result);
  assert.doesNotMatch(report,/"POS"|"Report"|missing timestamp|বাংলা 오류|2026-11-15T09:00|row_id|"Message"|"Context"|"Timestamp"/);
});

test('source property insertion order and valid Date conversion preserve same digest',()=>{
  const plain=logs(),changed=logs();
  changed[0].Timestamp=new Date('2026-11-15T09:00:00Z');
  assert.deepEqual(digest(changed),digest(plain));
  const reverse=plain.map(r=>Object.fromEntries(Object.entries(r).reverse()));
  assert.deepEqual(digest(reverse),digest(plain));
});

test('content-only diagnostic edit changes row digest while preserving provenance digest',()=>{
  const source=digest(logs());
  for(const [index,field,value] of [
    [0,'Message','  বাংলা 오류 '],
    [1,'Context','PURCHASE'],
    [2,'Timestamp','2026-11-16T00:00:00.000Z']
  ]){
    const changed=logs();
    changed[index][field]=value;
    const summary=digest(changed);
    assert.equal(summary.rowCount,3);
    assert.notEqual(summary.rowDigest,source.rowDigest,field);
    assert.equal(summary.positionDigest,source.positionDigest,field);
  }
});

test('a shorter but valid source LOGS capture gets a changed count and provenance hash',()=>{
  const full=digest(logs()),short=digest(logs().slice(0,2));
  assert.equal(short.rowCount,2);
  assert.notEqual(short.rowDigest,full.rowDigest);
  assert.notEqual(short.positionDigest,full.positionDigest);
});

test('invalid, reordered and nonsequential physical source rows fail closed',()=>{
  const invalid=[
    [],
    logs().slice().reverse(),
    logs().map((r,i)=>i===1?{...r,_rowIndex:4}:r),
    logs().map((r,i)=>i===2?{...r,Timestamp:999}:r),
    logs().map((r,i)=>i===0?{...r,Message:null}:r),
    logs().map((r,i)=>i===0?{...r,Timestamp:new Date('wrong')}:r),
    logs().map((r,i)=>i===0?{...r,Secret:'PRIVATE_VALUE'}:r)
  ];
  for(const rows of invalid) assert.throws(()=>digest(rows),fixed);
});

test('getter-backed private messages and symbol fields are rejected without executing getters',()=>{
  const rows=logs();
  Object.defineProperty(rows[0],'Message',{
    enumerable:true,get(){throw new Error('PRIVATE_SECRET_MESSAGE');}
  });
  assert.throws(()=>digest(rows),fixed);
  const symbol=logs(); symbol[0][Symbol('PRIVATE')]='SECRET';
  assert.throws(()=>digest(symbol),fixed);
});

test('frozen Config.gs LOGS headers and exactly 49 source groups are required',()=>{
  const changed=structuredClone(inventory);
  changed.tables.find(t=>t.sheetKey==='LOGS').columns.push('Log ID');
  assert.throws(()=>summarizeM10IdlessLogs({inventory:changed,rows:logs()}),fixed);
  const incomplete=structuredClone(inventory);
  incomplete.tables.pop();
  assert.throws(()=>summarizeM10IdlessLogs({inventory:incomplete,rows:logs()}),fixed);
});
