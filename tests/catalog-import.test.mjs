import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCatalogImport } from '../src/db/catalog-import.js';

const inventory={tables:[
  {sheetKey:'SETTINGS',columns:['Key','Value']},
  {sheetKey:'PRODUCT_CATEGORIES',columns:['Category ID','Category Name','Status','Created At']},
  {sheetKey:'PRODUCT_UNITS',columns:['Unit ID','Unit Name','Status','Created At']},
]};
const base=()=>({
  SETTINGS:[{'Key':'Phone 1','Value':'01700000000','_rowIndex':2}],
  PRODUCT_CATEGORIES:[{'Category ID':'CAT-000001','Category Name':'LED','Status':'Active','Created At':'2026-11-14','_rowIndex':2}],
  PRODUCT_UNITS:[{'Unit ID':'UNT-000001','Unit Name':'Pcs','Status':'Active','Created At':'','_rowIndex':2}]
});

test('produces deterministic, non-mutating, PII-free dry-run summary',()=>{
  const input=base();
  const original=JSON.stringify(input);
  const plan=prepareCatalogImport(inventory,input);
  assert.equal(JSON.stringify(input),original);
  assert.deepEqual(plan.summary,{
    totalRows:3,
    groups:[{sheetKey:'SETTINGS',table:'settings',rows:1},{sheetKey:'PRODUCT_CATEGORIES',table:'product_categories',rows:1},{sheetKey:'PRODUCT_UNITS',table:'product_units',rows:1}]
  });
  assert.equal(JSON.stringify(plan.summary).includes('01700000000'),false);
  assert.equal(plan.tables.SETTINGS[0].value,'01700000000');
});

test('rejects duplicate record ID, settings keys and legacy sheet positions',()=>{
  const d1=base();d1.PRODUCT_UNITS.push({...d1.PRODUCT_UNITS[0],_rowIndex:3});
  assert.throws(()=>prepareCatalogImport(inventory,d1),/duplicate.*unit_id/i);
  const d2=base();d2.SETTINGS.push({...d2.SETTINGS[0],_rowIndex:3});
  assert.throws(()=>prepareCatalogImport(inventory,d2),/duplicate.*key/i);
  const d3=base();d3.PRODUCT_UNITS.push({...d3.PRODUCT_UNITS[0],'Unit ID':'UNT-000002'});
  assert.throws(()=>prepareCatalogImport(inventory,d3),/duplicate.*legacy_sheet_row/i);
});

test('allows duplicate labels with different IDs and still rejects unreviewed fields',()=>{
  const data=base();data.PRODUCT_CATEGORIES.push({...data.PRODUCT_CATEGORIES[0],'Category ID':'CAT-000002',_rowIndex:3});
  assert.equal(prepareCatalogImport(inventory,data).summary.totalRows,4);
  const extra=base();extra.SETTINGS[0].Token='secret';
  assert.throws(()=>prepareCatalogImport(inventory,extra),/unexpected/i);
});

test('refuses missing master tables, unknown source groups and missing identifiers',()=>{
  const missing=base();delete missing.PRODUCT_CATEGORIES;
  assert.throws(()=>prepareCatalogImport(inventory,missing),/missing/i);
  const extra=base();extra.CASH_BOOK=[];
  assert.throws(()=>prepareCatalogImport(inventory,extra),/unknown/i);
  const empty=base();empty.SETTINGS[0].Key='';
  assert.throws(()=>prepareCatalogImport(inventory,empty),/required|empty/i);
});

function catalogWithSecondRow(sheetKey, secondIndex) {
  const rows=base();
  const second={...rows[sheetKey][0],_rowIndex:secondIndex};
  second[sheetKey==='PRODUCT_CATEGORIES'?'Category ID':'Unit ID']='NEW-000002';
  rows[sheetKey].push(second);
  return rows;
}

for (const sheetKey of ['PRODUCT_CATEGORIES','PRODUCT_UNITS']) {
  test(sheetKey+' rejects missing physical source row positions',()=>{
    const source=base();
    delete source[sheetKey][0]._rowIndex;
    assert.throws(()=>prepareCatalogImport(inventory,source),/source row|physical row|row index/i);
  });

  test(sheetKey+' rejects a first row other than physical row 2',()=>{
    const source=base();
    source[sheetKey][0]._rowIndex=3;
    assert.throws(()=>prepareCatalogImport(inventory,source),/source row|physical row|row index/i);
  });

  test(sheetKey+' rejects a gap in original physical row sequence',()=>{
    const source=catalogWithSecondRow(sheetKey,4);
    assert.throws(()=>prepareCatalogImport(inventory,source),/source row|physical row|row index/i);
  });

  test(sheetKey+' rejects reordered physical source rows',()=>{
    const source=catalogWithSecondRow(sheetKey,3);
    source[sheetKey].reverse();
    assert.throws(()=>prepareCatalogImport(inventory,source),/source row|physical row|row index/i);
  });

  test(sheetKey+' rejects more than 1000 catalog rows before D1 import',()=>{
    const source=base();
    source[sheetKey]=Array.from({length:1001},(_,i)=>({
      ...source[sheetKey][0],
      [sheetKey==='PRODUCT_CATEGORIES'?'Category ID':'Unit ID']:'SYN-'+String(i).padStart(6,'0'),
      _rowIndex:i+2
    }));
    assert.throws(()=>prepareCatalogImport(inventory,source),/1000|limit|bounded/i);
  });

  test(sheetKey+' accepts exactly ordered and contiguous source positions',()=>{
    const source=catalogWithSecondRow(sheetKey,3);
    const result=prepareCatalogImport(inventory,source);
    assert.deepEqual(result.tables[sheetKey].map(row=>row.legacy_sheet_row),[2,3]);
  });

  test(sheetKey+' allows zero rows without fabricated physical provenance',()=>{
    const source=base();
    source[sheetKey]=[];
    assert.equal(prepareCatalogImport(inventory,source).tables[sheetKey].length,0);
  });
}

test('Settings retention does not enforce M03 catalog-only physical row contract',()=>{
  const source=base();
  delete source.SETTINGS[0]._rowIndex;
  assert.equal(prepareCatalogImport(inventory,source).tables.SETTINGS[0].key,'Phone 1');
});
