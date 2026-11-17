import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertExactD1Resource,
  assertSafePreflight,
  assertRecoveryBookmark,
  assertRemoteSchema
} from '../scripts/guard-remote-staging.mjs';

const goodResource = {name:'shererp-staging-db',uuid:'aa04618e-1639-4cb9-bdf5-7b967d8b968b'};
const archiveResource = {name:'shererp-legacy-history-staging-20261118',uuid:'3328e5c8-7695-4d6c-8bcf-9725437ebdd5'};
const before = [{success:true,results:[{existing_user_tables:0}]}];
const after = [{success:true,results:[{app_tables:7,applied_migrations:2,history_triggers:4}]}];

test('remote identity must match an exact unique named database and UUID',()=>{
  assert.equal(assertExactD1Resource([goodResource,archiveResource]),true);
  assert.equal(assertExactD1Resource({result:[goodResource,archiveResource]}),true);
  assert.throws(()=>assertExactD1Resource([{...goodResource,uuid:'wrong'},archiveResource]),/identity|UUID|matching/i);
  assert.throws(()=>assertExactD1Resource([goodResource,goodResource,archiveResource]),/exactly one|duplicate/i);
  assert.throws(()=>assertExactD1Resource([{name:'shererp-staging-db',uuid:'different'},archiveResource]),/identity|UUID|matching/i);
});

test('remote schema must be empty before applying migrations',()=>{
  assert.equal(assertSafePreflight(before,true),0);
  assert.equal(assertSafePreflight([{success:true,results:[{existing_user_tables:8}]}],false),8);
  assert.throws(()=>assertSafePreflight([{success:true,results:[{existing_user_tables:1}]}],true),/not empty|refusing/i);
  assert.throws(()=>assertSafePreflight([{success:false,results:[{existing_user_tables:0}]}],true),/query|invalid/i);
  assert.throws(()=>assertSafePreflight([{success:true,results:[]}],true),/query|invalid/i);
});

test('refuse migration without a recoverable pre-write time-travel bookmark',()=>{
  assert.equal(assertRecoveryBookmark({bookmark:'00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683'}),true);
  assert.equal(assertRecoveryBookmark({result:{bookmark:'00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683'}}),true);
  assert.throws(()=>assertRecoveryBookmark({}),/bookmark/i);
  assert.throws(()=>assertRecoveryBookmark({bookmark:'bad'}),/bookmark/i);
});

test('post-apply remote schema must match exact reviewed local schema',()=>{
  assert.equal(assertRemoteSchema(after),true);
  assert.throws(()=>assertRemoteSchema([{success:true,results:[{app_tables:6,applied_migrations:2,history_triggers:4}]}]),/mismatch|schema/i);
});
