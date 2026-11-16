import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceSalesDraftAudit,importSourceSalesDraftAuditWithD1} from '../src/db/sales-draft-audit-import.js';

const source=()=>[
  {'Audit ID':'AUD-1',Timestamp:'2026-11-16T10:00Z',Action:'CREATED',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:1,'Actor ID':'U-1',
    'Actor Name':'শুভ','Source Owner ID':'U-1','Invoice ID':'',Note:'',_rowIndex:2},
  {'Audit ID':'AUD-2',Timestamp:'2026-11-16T10:01Z',Action:'POST_CLEANUP_RETRY',
    'Draft ID':'DR-1','Draft No':'D-0001',Version:'02','Actor ID':'U-1',
    'Actor Name':'শুভ','Source Owner ID':'U-1','Invoice ID':'INV-1',Note:'  retry  ',_rowIndex:3}
];

test('source projection keeps exact ids, physical rows, original version string and all notes',()=>{
  const input=source(),copy=structuredClone(input);
  assert.deepEqual(prepareSourceSalesDraftAudit(input),[
    {legacy_sheet_row:2,audit_id:'AUD-1',timestamp_text:'2026-11-16T10:00Z',
      action:'CREATED',draft_id:'DR-1',draft_no:'D-0001',version_text:'1',
      actor_id:'U-1',actor_name:'শুভ',source_owner_id:'U-1',invoice_id:'',note:''},
    {legacy_sheet_row:3,audit_id:'AUD-2',timestamp_text:'2026-11-16T10:01Z',
      action:'POST_CLEANUP_RETRY',draft_id:'DR-1',draft_no:'D-0001',version_text:'02',
      actor_id:'U-1',actor_name:'শুভ',source_owner_id:'U-1',invoice_id:'INV-1',note:'  retry  '}
  ]);
  assert.deepEqual(input,copy);
});

test('preflight rejects duplicates, gaps, missing fields, invalid actions/version and hidden data',()=>{
  const s=source();const bad=[
    [],s.slice().reverse(),[s[0],{...s[1],_rowIndex:4}],
    [{...s[0],'Audit ID':''},s[1]],
    [s[0],{...s[1],'Audit ID':'AUD-1'}],
    [{...s[0],Action:'CANCELED'},s[1]],
    [{...s[0],Version:0},s[1]],
    [{...s[0],Version:1.5},s[1]],
    [{...s[0],Version:9007199254740992},s[1]],
    [{...s[0],Version:'not a number'},s[1]],
    [{...s[0],Version:''},s[1]],
    [{...s[0],'Draft No':' '},s[1]],
    [{...s[0],'Actor Name':null},s[1]],
    [{...s[0],Private:'invisible'},s[1]]
  ];
  for(const rows of bad)assert.throws(()=>prepareSourceSalesDraftAudit(rows),/source|invalid|duplicate|version|row/i);
});

test('refuses symbol/accessor source rows without reading secret getter values',()=>{
  const x=source();
  Object.defineProperty(x[0],'Note',{enumerable:true,get(){throw new Error('PRIVATE_NOTE');}});
  assert.throws(()=>prepareSourceSalesDraftAudit(x),e=>e instanceof Error&&!e.message.includes('PRIVATE_NOTE'));
  const y=source();y[0][Symbol('secret')]='hidden';
  assert.throws(()=>prepareSourceSalesDraftAudit(y),/source|invalid/i);
  const z=source();Object.setPrototypeOf(z[0],new (class Impostor {})());
  assert.throws(()=>prepareSourceSalesDraftAudit(z),/source|invalid/i);
});

test('explicit valid Date maps to ISO but a source string stays untouched',()=>{
  const x=source();x[0].Timestamp=new Date('2026-11-16T10:00:00.000Z');
  assert.equal(prepareSourceSalesDraftAudit(x)[0].timestamp_text,'2026-11-16T10:00:00.000Z');
  assert.equal(prepareSourceSalesDraftAudit(x)[1].timestamp_text,'2026-11-16T10:01Z');
});

test('a D1 readback mismatch after committed batch reports NEEDS_REVIEW (not rollback)',async()=>{
  const DB={
    prepare(sql){
      if(sql.startsWith('SELECT legacy_sheet_row,audit_id'))return {
        bind(){return {all:async()=>({success:true,results:[]})};}
      };
      return {bind(){return {};}};
    },
    async batch(stmts){return stmts.map(()=>({success:true}));}
  };
  await assert.rejects(()=>importSourceSalesDraftAuditWithD1({DB,sourceRows:source()}),/NEEDS_REVIEW/);
});
