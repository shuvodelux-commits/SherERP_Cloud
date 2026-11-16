import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareSourceOpeningBalanceEditAudit,importSourceOpeningBalanceEditAuditWithD1
} from '../src/db/opening-balance-edit-audit-import.js';

const source=()=>[
  {'Audit ID':'OBL-1','Changed At':'2026-11-16T12:00Z','Entity Type':'CUSTOMER',
    'Entity ID':'C-1','Entity Name':'করিম','Old Opening Balance':'-150.00',
    'New Opening Balance':-100.5,Delta:49.5,'Current Due Before':'-90.00',
    'Current Due After':-40.5,Reason:' সংশোধন ','Changed By':'শুভ',_rowIndex:2},
  {'Audit ID':'OBL-2','Changed At':'2026-11-16T12:05Z','Entity Type':'SUPPLIER',
    'Entity ID':'S-1','Entity Name':'রহিম','Old Opening Balance':0,
    'New Opening Balance':'-0.00',Delta:'-0.00','Current Due Before':'',
    'Current Due After':'-0.00',Reason:' সংশোধন ','Changed By':'শুভ',_rowIndex:3}
];

test('preserves original signed balance and due strings without recomputation',()=>{
  const rows=source(),clone=structuredClone(rows);
  const result=prepareSourceOpeningBalanceEditAudit(rows);
  assert.equal(result.length,2);
  assert.deepEqual(result.map(x=>x.audit_id),['OBL-1','OBL-2']);
  assert.deepEqual(result.map(x=>x.legacy_sheet_row),[2,3]);
  assert.equal(result[0].old_opening_balance_text,'-150.00');
  assert.equal(result[0].new_opening_balance_text,'-100.5');
  assert.equal(result[1].new_opening_balance_text,'-0.00');
  assert.equal(result[1].delta_text,'-0.00');
  assert.equal(result[1].current_due_before_text,'');
  assert.equal(result[1].reason,' সংশোধন ');
  assert.deepEqual(rows,clone);
});
test('rejects malformed source, duplicate IDs, row gaps, unsafe money values before D1',()=>{
  const s=source();const bad=[
    [],s.slice().reverse(),[s[0],{...s[1],_rowIndex:4}],
    [{...s[0],'Audit ID':' '},s[1]],
    [s[0],{...s[1],'Audit ID':'OBL-1'}],
    [{...s[0],'Old Opening Balance':Infinity},s[1]],
    [{...s[0],'New Opening Balance':NaN},s[1]],
    [{...s[0],'Delta':{}},s[1]],
    [{...s[0],'Current Due After':null},s[1]],
    [{...s[0],'Entity ID':''},s[1]],
    [{...s[0],Private:'token'},s[1]],
    [{...s[0],_rowIndex:0},s[1]]
  ];
  for(const rows of bad)assert.throws(()=>prepareSourceOpeningBalanceEditAudit(rows),/invalid|source|duplicate|row/i);
});
test('accessors, symbols and non-plain prototypes fail without touching private getters',()=>{
  const x=source();
  Object.defineProperty(x[0],'Reason',{enumerable:true,get(){throw Error('PRIVATE');}});
  assert.throws(()=>prepareSourceOpeningBalanceEditAudit(x),e=>e instanceof Error&&!e.message.includes('PRIVATE'));
  const y=source();y[0][Symbol('unknown')]='x';
  assert.throws(()=>prepareSourceOpeningBalanceEditAudit(y),/invalid|source/i);
  const z=source();Object.setPrototypeOf(z[0],new (class Unsafe{})());
  assert.throws(()=>prepareSourceOpeningBalanceEditAudit(z),/invalid|source/i);
});
test('native Date converts to ISO but original source timestamp strings remain exact',()=>{
  const a=source();a[0]['Changed At']=new Date('2026-11-16T12:00:00.000Z');
  const b=prepareSourceOpeningBalanceEditAudit(a);
  assert.equal(b[0].changed_at_text,'2026-11-16T12:00:00.000Z');
  assert.equal(b[1].changed_at_text,'2026-11-16T12:05Z');
});
test('postcommit readback mismatch signals NEEDS_REVIEW without false rollback claim',async()=>{
  let calls=0;
  const DB={
    prepare(sql){
      if(sql.startsWith('SELECT legacy_sheet_row,audit_id'))return {bind(){return {all:async()=>({success:true,results:[]})};}};
      return {bind(){return {};}};
    },
    async batch(statements){calls++;return statements.map(()=>({success:true}));}
  };
  await assert.rejects(()=>importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:source()}),/NEEDS_REVIEW/);
  assert.equal(calls,1);
});
