import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceProductCategories} from '../src/db/product-category-source-import.js';

const source=()=>[
  {'Category ID':'CAT-SRC-001','Category Name':'ইলেকট্রিক',Status:'Active',
    'Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'CAT-SRC-002','Category Name':'ইলেকট্রিক',Status:'Inactive',
    'Created At':'',_rowIndex:3}
];

test('preserves original Category IDs, duplicate display names, source status and physical positions',()=>{
  const input=source(),before=structuredClone(input);
  assert.deepEqual(prepareSourceProductCategories(input),[
    {legacy_sheet_row:2,category_id:'CAT-SRC-001',category_name:'ইলেকট্রিক',
      status:'Active',created_at:'2026-11-15T10:00:00.000Z'},
    {legacy_sheet_row:3,category_id:'CAT-SRC-002',category_name:'ইলেকট্রিক',
      status:'Inactive',created_at:''}
  ]);
  assert.deepEqual(input,before);
});

test('rejects missing, unexpected, duplicated, nonserializable and reordered source rows before D1',()=>{
  const a=source();
  const bad=[
    [],a.slice().reverse(),
    [{...a[0],_rowIndex:3},a[1]],
    [a[0],{...a[1],_rowIndex:4}],
    [{...a[0],'Category ID':''},a[1]],
    [a[0],{...a[1],'Category ID':a[0]['Category ID']}],
    [a[0],{...a[1],'Category Name':'  '}],
    [a[0],{...a[1],'Category Name':29}],
    [a[0],{...a[1],Status:'SUSPENDED'}],
    [a[0],{...a[1],Status:undefined}],
    [{...a[0],privateData:'do-not-read'},a[1]],
    [a[0],{...a[1],'Created At':{secret:1}}],
    [{...a[0],'Created At':new Date('bad')},a[1]],
  ];
  for(const rows of bad)
    assert.throws(()=>prepareSourceProductCategories(rows),/source|category|invalid|duplicate|row/i);
});

test('refuses accessor getters, proxies, nonplain source rows and symbol keys without evaluating sensitive values',()=>{
  const input=source();
  Object.defineProperty(input[0],'Category Name',{
    enumerable:true,get(){throw new Error('PRIVATE_NAME_READ');}
  });
  assert.throws(()=>prepareSourceProductCategories(input),error=>
    error instanceof Error && !/PRIVATE_NAME_READ/.test(error.message));
  const other=source();
  Object.setPrototypeOf(other[0],new (class Sneaky {})());
  assert.throws(()=>prepareSourceProductCategories(other),/invalid|source|category/i);
  const symbol=source();symbol[0][Symbol('extra')]='private';
  assert.throws(()=>prepareSourceProductCategories(symbol),/invalid|source|category/i);
});

test('serializes valid native date while keeping explicit blank status without inventing state',()=>{
  const input=source();
  input[0]['Created At']=new Date('2026-11-15T10:00:00.000Z');
  input[1].Status='';
  const output=prepareSourceProductCategories(input);
  assert.equal(output[0].created_at,'2026-11-15T10:00:00.000Z');
  assert.equal(output[1].status,'');
});
