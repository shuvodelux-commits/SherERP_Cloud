import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeOpenPartyIdentityReviews} from '../src/party/d1-review-queue-summary.js';

// Only the external D1 .all() envelope is simulated; tests exercise the real
// internal review summary function and its observed output/error behavior.
function withResult(result){
  return {DB:{
    prepare(sql){
      assert.match(sql,/WHERE status='OPEN'/);
      return {async all(){return result;}};
    }
  }};
}

test('missing or nonboolean D1 success cannot be interpreted as zero pending reviews',async()=>{
  for(const [name,result] of [
    ['missing',{results:[]}],
    ['undefined',{success:undefined,results:[]}],
    ['null',{success:null,results:[]}],
    ['numeric zero',{success:0,results:[]}],
    ['numeric one',{success:1,results:[]}],
    ['string true',{success:'true',results:[]}]
  ]){
    await assert.rejects(
      ()=>summarizeOpenPartyIdentityReviews(withResult(result)),
      err=>err instanceof Error && err.message==='Party identity review summary unavailable',
      name
    );
  }
});

test('nonboolean D1 success cannot validate plausible nonempty review counts',async()=>{
  for(const status of [undefined,null,1,'true']){
    const output={results:[{reason:'MISSING_ID',count:1}]};
    if(status!==undefined)output.success=status;
    await assert.rejects(
      ()=>summarizeOpenPartyIdentityReviews(withResult(output)),
      err=>err instanceof Error && err.message==='Party identity review summary unavailable'
    );
  }
});

test('explicit D1 success true keeps valid empty and OPEN-only reason counts',async()=>{
  assert.deepEqual(await summarizeOpenPartyIdentityReviews(withResult({
    success:true,results:[]
  })),{totalOpen:0,byReason:[]});

  assert.deepEqual(await summarizeOpenPartyIdentityReviews(withResult({
    success:true,results:[
      {reason:'SHARED_PHONE',count:2},
      {reason:'MISSING_ID',count:1}
    ]
  })),{
    totalOpen:3,
    byReason:[
      {reason:'MISSING_ID',count:1},
      {reason:'SHARED_PHONE',count:2}
    ]
  });
});

test('explicit D1 failure remains sanitized, never a successful empty result',async()=>{
  await assert.rejects(
    ()=>summarizeOpenPartyIdentityReviews(withResult({success:false,results:[]})),
    err=>err instanceof Error && err.message==='Party identity review summary unavailable'
  );
});
