import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceDeleteLog} from '../src/db/delete-log-import.js';

const source=()=>[
  {'Log ID':'DEL-01',Date:'2026-11-15',Time:'13:03',Module:'SALES',
    'Record ID':'INV-1','Invoice No':'INV-1',Reason:'  ভুল বিক্রয়  ',
    'Deleted By':'STAFF-1','Deleted By Mobile':'01700000009',_rowIndex:2},
  {'Log ID':'DEL-02',Date:'2026-11-15',Time:'13:03',Module:'SALES',
    'Record ID':'INV-1','Invoice No':'INV-1',Reason:'  ভুল বিক্রয়  ',
    'Deleted By':'STAFF-1','Deleted By Mobile':'01700000009',_rowIndex:3}
];

test('source snapshot preserves identical audit payloads with distinct original IDs and physical rows',()=>{
  const input=source(),copy=structuredClone(input);
  assert.deepEqual(prepareSourceDeleteLog(input),[
    {legacy_sheet_row:2,log_id:'DEL-01',date_text:'2026-11-15',time_text:'13:03',
      module:'SALES',record_id:'INV-1',invoice_no:'INV-1',reason:'  ভুল বিক্রয়  ',
      deleted_by:'STAFF-1',deleted_by_mobile:'01700000009'},
    {legacy_sheet_row:3,log_id:'DEL-02',date_text:'2026-11-15',time_text:'13:03',
      module:'SALES',record_id:'INV-1',invoice_no:'INV-1',reason:'  ভুল বিক্রয়  ',
      deleted_by:'STAFF-1',deleted_by_mobile:'01700000009'}
  ]);
  assert.deepEqual(input,copy);
});

test('rejects blank/duplicate IDs, absent columns, row holes, unsafe numbers and extra fields before SQL',()=>{
  const s=source();
  const bad=[
    [],s.slice().reverse(),[s[0],{...s[1],_rowIndex:4}],
    [{...s[0],_rowIndex:1},s[1]],
    [{...s[0],'Log ID':' '},s[1]],
    [s[0],{...s[1],'Log ID':'DEL-01'}],
    [{...s[0],'Deleted By Mobile':1700000009},s[1]],
    [{...s[0],Date:1700000009},s[1]],
    [{...s[0],Reason:null},s[1]],
    [{...s[0],Extra:'private'},s[1]],
    [{...s[0],'Invoice No':undefined},s[1]]
  ];
  for(const rows of bad)assert.throws(()=>prepareSourceDeleteLog(rows),/source|invalid|duplicate|row/i);
});
test('rejects getters, symbols, and non-plain objects without evaluating sensitive fields',()=>{
  const s=source();
  Object.defineProperty(s[0], 'Reason', {enumerable:true,get(){throw new Error('PRIVATE_REASON');}});
  assert.throws(()=>prepareSourceDeleteLog(s),e=>e instanceof Error&&!e.message.includes('PRIVATE_REASON'));
  const t=source();t[0][Symbol('secret')]='x';
  assert.throws(()=>prepareSourceDeleteLog(t),/source|invalid/i);
  const u=source();Object.setPrototypeOf(u[0],new (class Unsafe {})());
  assert.throws(()=>prepareSourceDeleteLog(u),/source|invalid/i);
});
