import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceLegacyErrorLogs} from '../src/db/legacy-error-log-import.js';

const source=()=>[
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  ошибка বাংলা  ',_rowIndex:2},
  {Timestamp:'2026-11-15T09:00:00.000Z',Context:'POS',Message:'  ошибка বাংলা  ',_rowIndex:3}
];

test('preserves duplicate original diagnostics without pretending timestamps are identities',()=>{
  const input=source(),copy=structuredClone(input);
  assert.deepEqual(prepareSourceLegacyErrorLogs(input),[
    {legacy_sheet_row:2,timestamp_text:'2026-11-15T09:00:00.000Z',context:'POS',message:'  ошибка বাংলা  '},
    {legacy_sheet_row:3,timestamp_text:'2026-11-15T09:00:00.000Z',context:'POS',message:'  ошибка বাংলা  '}
  ]);
  assert.deepEqual(input,copy);
});

test('rejects malformed and reordered error-log snapshots before any D1 operation',()=>{
  const s=source();
  for(const bad of [
    [],s.slice().reverse(),[s[0],{...s[1],_rowIndex:2}],
    [{...s[0],_rowIndex:1},s[1]],
    [{...s[0],Context:45},s[1]],
    [{...s[0],Message:null},s[1]],
    [{...s[0],Timestamp:42},s[1]],
    [{...s[0],Timestamp:new Date('bad')},s[1]],
    [{...s[0],Unknown:'data'},s[1]],
  ])assert.throws(()=>prepareSourceLegacyErrorLogs(bad),/source|invalid|row/i);
});

test('rejects accessor and symbol properties without calling private getters',()=>{
  const s=source();
  Object.defineProperty(s[0],'Message',{enumerable:true,get(){throw new Error('LEAK_PRIVATE');}});
  assert.throws(()=>prepareSourceLegacyErrorLogs(s),error=>
    error instanceof Error && !error.message.includes('LEAK_PRIVATE'));
  const t=source();t[0][Symbol('secret')]='secret';
  assert.throws(()=>prepareSourceLegacyErrorLogs(t),/source|invalid/i);
});

test('valid source Date uses ISO without rewriting existing raw string messages',()=>{
  const s=source();s[0].Timestamp=new Date('2026-11-15T09:00:00Z');
  assert.equal(prepareSourceLegacyErrorLogs(s)[0].timestamp_text,'2026-11-15T09:00:00.000Z');
  assert.equal(prepareSourceLegacyErrorLogs(s)[0].message,'  ошибка বাংলা  ');
});
