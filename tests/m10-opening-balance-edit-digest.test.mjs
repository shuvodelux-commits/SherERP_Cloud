import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {summarizeM10OpeningBalanceEditAudit} from '../src/migration/m10-opening-balance-edit-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const source=()=>[
  {'Audit ID':'OBL-1','Changed At':'2026-11-16T12:00Z',
    'Entity Type':'CUSTOMER','Entity ID':'PARTY-1','Entity Name':'করিম',
    'Old Opening Balance':'-150.00','New Opening Balance':-100.5,
    Delta:49.5,'Current Due Before':'-90.00','Current Due After':-40.5,
    Reason:' সংশোধন ','Changed By':'শুভ',_rowIndex:2},
  {'Audit ID':'OBL-2','Changed At':'2026-11-16T12:05Z',
    'Entity Type':'SUPPLIER','Entity ID':'PARTY-1','Entity Name':'করিম',
    'Old Opening Balance':0,'New Opening Balance':'-0.00',
    Delta:'-0.00','Current Due Before':'','Current Due After':'-0.00',
    Reason:' সাপ্লায়ার ','Changed By':'রহিম',_rowIndex:3}
];
const summarize=rows=>summarizeM10OpeningBalanceEditAudit({inventory,rows});
const invalid=e=>e instanceof Error&&e.message==='M10 OPENING_BALANCE_EDIT_LOG evidence invalid';

test('independent canonical original-Audit-ID and all 12 source columns SHA-256 preserve signed text',()=>{
  const rows=source(),original=structuredClone(rows);
  const expectedRows=[
    [2,'OBL-1','2026-11-16T12:00Z','CUSTOMER','PARTY-1','করিম',
      '-150.00','-100.5','49.5','-90.00','-40.5',' সংশোধন ','শুভ'],
    [3,'OBL-2','2026-11-16T12:05Z','SUPPLIER','PARTY-1','করিম',
      '0','-0.00','-0.00','','-0.00',' সাপ্লায়ার ','রহিম']
  ];
  assert.deepEqual(summarize(rows),{
    sheetKey:'OPENING_BALANCE_EDIT_LOG',rowCount:2,
    rowDigest:sha(['M10-ROW-v1','OPENING_BALANCE_EDIT_LOG',expectedRows]),
    idDigest:sha(['M10-ID-v1','OPENING_BALANCE_EDIT_LOG',[[2,'OBL-1'],[3,'OBL-2']]])
  });
  assert.deepEqual(rows,original,'audit evidence must not mutate source rows');
  assert.equal(JSON.stringify(summarize(rows)).includes('PARTY-1'),false);
  assert.equal(JSON.stringify(summarize(rows)).includes('করিম'),false);
});

test('Customer and Supplier rows sharing entity ID remain distinct original Audit IDs',()=>{
  const rows=source(),a=summarize(rows);
  assert.equal(rows[0]['Entity ID'],rows[1]['Entity ID']);
  assert.notEqual(rows[0]['Audit ID'],rows[1]['Audit ID']);
  assert.equal(a.rowCount,2);
  assert.notEqual(a.idDigest,a.rowDigest);
});

test('object property insertion order cannot change independently mapped row digest',()=>{
  const reversed=source().map(row=>Object.fromEntries(Object.entries(row).reverse()));
  assert.deepEqual(summarize(reversed),summarize(source()));
});

test('negative zero string, fixed decimal text and Unicode whitespace alter row digest, never source identity',()=>{
  const baseline=summarize(source());
  for(const [index,key,replacement] of [
    [0,'Old Opening Balance','-150'],
    [1,'Old Opening Balance','0.00'],
    [1,'New Opening Balance','0'],
    [1,'Delta','0.00'],
    [1,'Current Due After','0'],
    [0,'Current Due Before','-90'],
    [0,'Reason','সংশোধন'],
    [1,'Changed By','অন্য'],
    [1,'Entity Type','CUSTOMER'],
    [1,'Entity ID','PARTY-2']
  ]){
    const next=source();next[index][key]=replacement;
    const actual=summarize(next);
    assert.notEqual(actual.rowDigest,baseline.rowDigest,key);
    assert.equal(actual.idDigest,baseline.idDigest,key);
  }
});

test('changing authentic Audit ID changes both source ID and complete-row digests',()=>{
  const next=source();next[1]['Audit ID']='OBL-REPLACED';
  const before=summarize(source()),after=summarize(next);
  assert.notEqual(after.idDigest,before.idDigest);
  assert.notEqual(after.rowDigest,before.rowDigest);
});

test('native Changed At Date maps to ISO, while original source string stays byte-faithful',()=>{
  const native=source();native[0]['Changed At']=new Date('2026-11-16T12:00:00Z');
  const iso=source();iso[0]['Changed At']='2026-11-16T12:00:00.000Z';
  assert.deepEqual(summarize(native),summarize(iso));
  assert.notEqual(summarize(native).rowDigest,summarize(source()).rowDigest);
});

test('shorter yet valid original snapshot has different row count and both hashes',()=>{
  const full=summarize(source()),short=summarize(source().slice(0,1));
  assert.equal(short.rowCount,1);
  assert.notEqual(full.rowDigest,short.rowDigest);
  assert.notEqual(full.idDigest,short.idDigest);
});

test('duplicate source Audit ID, row gap, malformed amounts, identity and source fields all fail closed',()=>{
  const bad=[
    [],source().reverse(),[source()[0],{...source()[1],_rowIndex:4}],
    [source()[0],{...source()[1],'Audit ID':'OBL-1'}],
    [{...source()[0],'Audit ID':' '},source()[1]],
    [{...source()[0],'Entity Type':''},source()[1]],
    [{...source()[0],Delta:Infinity},source()[1]],
    [{...source()[0],'New Opening Balance':NaN},source()[1]],
    [{...source()[0],'Current Due After':null},source()[1]],
    [{...source()[0],'Current Due Before':{}},source()[1]],
    [{...source()[0],'Changed At':new Date('not-date')},source()[1]],
    [{...source()[0],Private:'SECRET_LEDGER'},source()[1]]
  ];
  for(const rows of bad)assert.throws(()=>summarize(rows),invalid);
  const getter=source();
  Object.defineProperty(getter[0],'Reason',{enumerable:true,get(){throw Error('PRIVATE_REASON')}});
  assert.throws(()=>summarize(getter),invalid);
  const symbol=source();symbol[1][Symbol('private')]='SECRET';
  assert.throws(()=>summarize(symbol),invalid);
  const custom=source();Object.setPrototypeOf(custom[0],new (class Unsafe{})());
  assert.throws(()=>summarize(custom),invalid);
});

test('frozen 49-group source inventory and exact OPENING_BALANCE_EDIT_LOG headers are required',()=>{
  const oneLess=structuredClone(inventory);oneLess.tables.pop();
  assert.throws(()=>summarizeM10OpeningBalanceEditAudit({inventory:oneLess,rows:source()}),invalid);
  const dup=structuredClone(inventory);dup.tables[1].sheetKey=dup.tables[0].sheetKey;
  assert.throws(()=>summarizeM10OpeningBalanceEditAudit({inventory:dup,rows:source()}),invalid);
  const changed=structuredClone(inventory);
  changed.tables.find(x=>x.sheetKey==='OPENING_BALANCE_EDIT_LOG').columns.push('Private Column');
  assert.throws(()=>summarizeM10OpeningBalanceEditAudit({inventory:changed,rows:source()}),invalid);
});
