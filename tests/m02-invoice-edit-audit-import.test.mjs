import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceInvoiceEditAudit,importSourceInvoiceEditAuditWithD1} from '../src/db/invoice-edit-audit-import.js';

const sample=()=>[
  {'Log ID':'IEL-1','Invoice ID':'INV-1','Edit Date':'2026-11-16T11:00Z',
    Reason:'  রিটার্ন সম্পাদনা  ','Before Grand Total':'','After Grand Total':'',
    'Return ID':'SRT-1','Before Return Amount':12.50,'After Return Amount':'13.50',
    'Before Return Items JSON':' [{"unit":"Pcs","qty":1}] ',
    'After Return Items JSON':'[{"unit":"Pcs","qty":2}]','Edited By':'সুমন',_rowIndex:2},
  {'Log ID':'IEL-2','Invoice ID':'INV-1','Edit Date':'2026-11-16T11:10Z',
    Reason:'  রিটার্ন সম্পাদনা  ','Before Grand Total':'100.00','After Grand Total':99.5,
    'Return ID':'SRT-1','Before Return Amount':'13.50','After Return Amount':14,
    'Before Return Items JSON':' [{"unit":"Pcs","qty":2}] ',
    'After Return Items JSON':' [{"unit":"Pcs","qty":3}] ',
    'Edited By':'সুমন',_rowIndex:3}
];

test('whole source preserves duplicate descriptions, original IDs, JSON whitespace and numeric text',()=>{
  const input=sample(),original=structuredClone(input),rows=prepareSourceInvoiceEditAudit(input);
  assert.equal(rows.length,2);
  assert.equal(rows[0].legacy_sheet_row,2);
  assert.equal(rows[1].log_id,'IEL-2');
  assert.equal(rows[0].before_return_amount_text,'12.5');
  assert.equal(rows[0].after_return_amount_text,'13.50');
  assert.equal(rows[0].before_return_items_json,' [{"unit":"Pcs","qty":1}] ');
  assert.equal(rows[1].before_grand_total_text,'100.00');
  assert.equal(rows[1].after_grand_total_text,'99.5');
  assert.equal(rows[1].after_return_items_json,' [{"unit":"Pcs","qty":3}] ');
  assert.deepEqual(input,original);
});

test('rejects invalid ids, row gaps, inaccessible fields, malformed amounts and unsafe JSON values',()=>{
  const s=sample();const bad=[
    [],s.slice().reverse(),[s[0],{...s[1],_rowIndex:9}],
    [{...s[0],'Log ID':' '},s[1]],[s[0],{...s[1],'Log ID':'IEL-1'}],
    [{...s[0],'Before Return Amount':Infinity},s[1]],
    [{...s[0],'After Grand Total':NaN},s[1]],
    [{...s[0],'Before Grand Total':{}},s[1]],
    [{...s[0],'After Return Items JSON':[]},s[1]],
    [{...s[0],'Reason':null},s[1]],
    [{...s[0],'Return ID':undefined},s[1]],
    [{...s[0],'Invoice ID':false},s[1]],
    [{...s[0],_rowIndex:1},s[1]],
    [{...s[0],Private:'unsafe'},s[1]]
  ];
  for(const x of bad)assert.throws(()=>prepareSourceInvoiceEditAudit(x),/source|invalid|duplicate|row/i);
});

test('rejects accessors and symbol properties without triggering a private getter',()=>{
  const x=sample();
  Object.defineProperty(x[0],'Reason',{enumerable:true,get(){throw new Error('PRIVATE_NOTE');}});
  assert.throws(()=>prepareSourceInvoiceEditAudit(x),e=>e instanceof Error&&!e.message.includes('PRIVATE_NOTE'));
  const y=sample();y[0][Symbol('secret')]='token';
  assert.throws(()=>prepareSourceInvoiceEditAudit(y),/source|invalid/i);
});

test('native valid Date maps to ISO but source date strings and JSON are not normalized',()=>{
  const x=sample();x[0]['Edit Date']=new Date('2026-11-16T11:00:00Z');
  const rows=prepareSourceInvoiceEditAudit(x);
  assert.equal(rows[0].edit_date_text,'2026-11-16T11:00:00.000Z');
  assert.equal(rows[1].edit_date_text,'2026-11-16T11:10Z');
  assert.equal(rows[0].before_return_items_json,' [{"unit":"Pcs","qty":1}] ');
});

test('postcommit mismatched full readback fails as NEEDS_REVIEW instead of claiming rollback',async()=>{
  let batchCount=0;
  const DB={
    prepare(sql){
      if(sql.startsWith('SELECT legacy_sheet_row,log_id'))return {
        bind(){return {all:async()=>({success:true,results:[]})};}
      };
      return {bind(){return {};}}
    },
    async batch(stmts){batchCount++;return stmts.map(()=>({success:true}));}
  };
  await assert.rejects(()=>importSourceInvoiceEditAuditWithD1({DB,sourceRows:sample()}),/NEEDS_REVIEW/);
  assert.equal(batchCount,1);
});
