import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeOpenPartyIdentityReviews} from '../src/party/d1-review-queue-summary.js';

const binding=(rows,queries=[])=>({
  prepare(sql){
    queries.push(sql);
    return {async all(){return {success:true,results:rows}}};
  }
});

test('OPEN review counts are sorted, reason-only and contain no original identities',async()=>{
  const queries=[];
  const result=await summarizeOpenPartyIdentityReviews({DB:binding([
    {reason:'SHARED_PHONE',count:2},
    {reason:'MISSING_ID',count:1},
    {reason:'SAME_NAME',count:3}
  ],queries)});
  assert.deepEqual(result,{totalOpen:6,byReason:[
    {reason:'MISSING_ID',count:1},{reason:'SAME_NAME',count:3},
    {reason:'SHARED_PHONE',count:2}
  ]});
  assert.equal(queries.length,1);
  assert.match(queries[0],/^SELECT\s+reason,\s+COUNT\(\*\) AS count\s+FROM party_identity_review/i);
  assert.match(queries[0],/WHERE status\s*=\s*'OPEN'/);
  assert.doesNotMatch(queries[0],/source_id|display_name|phone|reviewer_id|candidate_party_id/i);
  assert.doesNotMatch(JSON.stringify(result),/CUS-001|01700000000|Rahim/);
});

test('zero outstanding identity reviews is an explicit empty count not an error',async()=>{
  assert.deepEqual(await summarizeOpenPartyIdentityReviews({DB:binding([])}),
    {totalOpen:0,byReason:[]});
});

test('invalid/unexpected database reasons and counts fail closed',async()=>{
  for(const rows of [
    [{reason:'SENSITIVE_NAME',count:1}],
    [{reason:'MISSING_ID',count:-1}],
    [{reason:'MISSING_ID',count:1.5}],
    [{reason:'MISSING_ID',count:'1'}],
    [{reason:'MISSING_ID',count:Number.MAX_SAFE_INTEGER+1}],
    [{reason:'MISSING_ID',count:1},{reason:'MISSING_ID',count:1}]
  ]){
    await assert.rejects(()=>summarizeOpenPartyIdentityReviews({DB:binding(rows)}),
      /invalid|unavailable/i);
  }
});

test('malformed or failed D1 results cannot appear as successful zero reviews',async()=>{
  for(const results of [
    null,{results:null},{results:[{reason:'MISSING_ID'}]},
    {success:false,results:[]}
  ]){
    await assert.rejects(()=>summarizeOpenPartyIdentityReviews({DB:{
      prepare(){return {async all(){return results;}}}
    }}),/unavailable|invalid/i);
  }
});

test('database failures are sanitized and missing bindings are rejected',async()=>{
  await assert.rejects(()=>summarizeOpenPartyIdentityReviews({DB:null}),/binding/i);
  await assert.rejects(()=>summarizeOpenPartyIdentityReviews({DB:{
    prepare(){throw new Error('CUS-001 01700000000 raw SQL');}
  }}),err=>/unavailable/.test(err.message)&&!/CUS-001|01700000000|raw SQL/.test(err.message));
  await assert.rejects(()=>summarizeOpenPartyIdentityReviews({DB:{
    prepare(){return {async all(){throw new Error('Rahim 01700000000');}}}
  }}),err=>/unavailable/.test(err.message)&&!/Rahim|01700000000/.test(err.message));
});
