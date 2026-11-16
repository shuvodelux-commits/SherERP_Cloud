import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceProductUnits} from '../src/db/product-unit-source-import.js';

const source=()=>[
  {'Unit ID':'UNT-SRC-001','Unit Name':'Pcs',Status:'Active',
    'Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Unit ID':'UNT-SRC-002','Unit Name':'গিরা',Status:'Inactive','Created At':'',_rowIndex:3}
];

test('source-shaped Product Units preflight preserves exact ID, Bangla label and physical row, without mutation',()=>{
  const original=source(),copy=structuredClone(original);
  const out=prepareSourceProductUnits(original);
  assert.deepEqual(out,[
    {legacy_sheet_row:2,unit_id:'UNT-SRC-001',unit_name:'Pcs',status:'Active',created_at:'2026-11-15T10:00:00.000Z'},
    {legacy_sheet_row:3,unit_id:'UNT-SRC-002',unit_name:'গিরা',status:'Inactive',created_at:''}
  ]);
  assert.deepEqual(original,copy);
});

test('invalid frozen source rejects omissions, extra fields, holes, duplicate IDs and invalid value type',()=>{
  const base=source();
  const bad=[
    [],
    base.slice().reverse(),
    [{...base[0],_rowIndex:4},base[1]],
    [{...base[0],'Unit ID':''},base[1]],
    [base[0],{...base[1],'Unit ID':'UNT-SRC-001'}],
    [base[0],{...base[1],Token:'secret'}],
    [{...base[0],Status:'Suspended'},base[1]],
    [base[0],{...base[1],'Unit Name':123}],
    [base[0],{...base[1],'Unit Name':' '}],
    [base[0],{...base[1],'Created At':{}}],
  ];
  for(const rows of bad)assert.throws(()=>prepareSourceProductUnits(rows),/source|import|field|row|invalid|duplicate|status/i);
});

test('preflight rejects accessor descriptors before executing a getter',()=>{
  const rows=source();
  Object.defineProperty(rows[0],'Unit Name',{enumerable:true,get(){throw new Error('SENSITIVE_GETTER_EXECUTED');}});
  assert.throws(()=>prepareSourceProductUnits(rows),error=>
    error instanceof Error&&!/SENSITIVE_GETTER_EXECUTED/.test(error.message));
});

test('preflight accepts a source Date only with valid instant and normalizes to source-serializable UTC',()=>{
  const rows=source();
  rows[0]['Created At']=new Date('2026-11-15T10:00:00Z');
  assert.equal(prepareSourceProductUnits(rows)[0].created_at,'2026-11-15T10:00:00.000Z');
  rows[0]['Created At']=new Date('invalid');
  assert.throws(()=>prepareSourceProductUnits(rows),/invalid|source|date/i);
});
