import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inventorySchema} from '../scripts/inventory-schema.mjs';
import {verifyExpenseCategoryMapping} from '../src/db/expense-category-mapping.js';
import {prepareSourceExpenseCategories} from '../src/db/expense-category-source-import.js';

const inventory=inventorySchema(readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8'));
const sample=()=>[
  {'Category ID':'EXCAT-1','Category Name':'দোকান ভাড়া','Description':'  মাসিক ভাড়া  ',
   Status:'Active','Created At':'2026-11-15T10:00:00.000Z',_rowIndex:2},
  {'Category ID':'EXCAT-2','Category Name':'দোকান ভাড়া','Description':'',
   Status:'Inactive','Created At':'',_rowIndex:3},
  {'Category ID':'EXCAT-3','Category Name':'বিদ্যুৎ বিল','Description':'ফি',
   Status:'','Created At':'2026-11-15T10:01:00.000Z',_rowIndex:4}
];

test('frozen Expense Categories headers and full source projection preserve identity, order and all field bytes',()=>{
  assert.equal(verifyExpenseCategoryMapping(inventory),true);
  const input=sample(),before=structuredClone(input);
  assert.deepEqual(prepareSourceExpenseCategories(input),[
    {legacy_sheet_row:2,category_id:'EXCAT-1',category_name:'দোকান ভাড়া',
     description:'  মাসিক ভাড়া  ',status:'Active',created_at:'2026-11-15T10:00:00.000Z'},
    {legacy_sheet_row:3,category_id:'EXCAT-2',category_name:'দোকান ভাড়া',
     description:'',status:'Inactive',created_at:''},
    {legacy_sheet_row:4,category_id:'EXCAT-3',category_name:'বিদ্যুৎ বিল',
     description:'ফি',status:'',created_at:'2026-11-15T10:01:00.000Z'}
  ]);
  assert.deepEqual(input,before);
});

test('whole snapshot rejects missing, changed, duplicate or unsafe source data before D1',()=>{
  const s=sample();
  const variants=[
    [],s.slice().reverse(),[s[0],{...s[1],_rowIndex:4},s[2]],
    [s[0],{...s[1],'Category ID':s[0]['Category ID']},s[2]],
    [{...s[0],'Category ID':' '},s[1],s[2]],
    [{...s[0],'Category Name':'  '},s[1],s[2]],
    [{...s[0],'Category Name':7},s[1],s[2]],
    [s[0],{...s[1],'Description':null},s[2]],
    [s[0],{...s[1],Status:'Archived'},s[2]],
    [s[0],{...s[1],Status:undefined},s[2]],
    [s[0],{...s[1],'Created At':null},s[2]],
    [s[0],{...s[1],'Created At':new Date('bad')},s[2]],
    [s[0],{...s[1],Internal:'never-import'},s[2]],
    [s[0],{...s[1],_rowIndex:1},s[2]]
  ];
  for(const rows of variants)
    assert.throws(()=>prepareSourceExpenseCategories(rows),/source|invalid|duplicate|row/i);
});

test('rejects getters and nonplain rows without disclosing private source values',()=>{
  const s=sample();
  Object.defineProperty(s[1],'Description',{enumerable:true,get(){throw new Error('SENSITIVE_VALUE');}});
  assert.throws(()=>prepareSourceExpenseCategories(s),
    error=>error instanceof Error && !error.message.includes('SENSITIVE_VALUE'));
  const p=sample();
  Object.setPrototypeOf(p[0],new (class Sneaky {})());
  assert.throws(()=>prepareSourceExpenseCategories(p),/invalid|source/i);
  const t=sample();
  t[1][Symbol('hidden')]='secret';
  assert.throws(()=>prepareSourceExpenseCategories(t),/invalid|source/i);
});

test('valid Date serializes once but explicit blank status is not normalized',()=>{
  const s=sample();
  s[0]['Created At']=new Date('2026-11-15T10:00:00.000Z');
  assert.equal(prepareSourceExpenseCategories(s)[0].created_at,'2026-11-15T10:00:00.000Z');
  assert.equal(prepareSourceExpenseCategories(s)[2].status,'');
});
