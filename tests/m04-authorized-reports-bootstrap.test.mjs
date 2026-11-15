import test from 'node:test';
import assert from 'node:assert/strict';
import {createM04AuthorizedReportsBootstrapReader} from '../src/modules/m04-authorized-reports-bootstrap.js';

const TOKEN='a'.repeat(64);
const NOW=1_800_000_000_000;
function mockEnv(rows,log){
  return {DB:{prepare(sql){
    log.push(sql);
    return {bind(...params){
      log.params=params;
      return {all:async()=>({success:true,results:rows})};
    }};
  }}};
}
const request=(changes={})=>({token:TOKEN,nowMs:NOW,today:'2026-11-15',...changes});
test('reports.view authorized read returns source-proven five fields, without an unguarded Settings query',async()=>{
  const log=[];
  const reader=createM04AuthorizedReportsBootstrapReader(mockEnv([
    {key:'Shop Name',value:'মেসার্স হার্ডওয়্যার'},
    {key:'Currency Symbol',value:'৳'}
  ],log));
  const result=await reader.getBootstrap(request());
  assert.deepEqual(Object.keys(result),['reportTypes','currencySymbol','shopName','defaultFrom','defaultTo']);
  assert.equal(result.shopName,'মেসার্স হার্ডওয়্যার');
  assert.equal(result.currencySymbol,'৳');
  assert.equal(result.defaultFrom,'2026-11-01');
  assert.equal(result.defaultTo,'2026-11-15');
  assert.deepEqual(result.reportTypes.map(x=>x.key),['sales','purchase','stock','cashbank','profit','balancesheet']);
  assert.equal(log.length,1,'one D1 authorized statement; no JS preflight then separate Settings read');
  assert.match(log[0],/FROM auth_sessions/i);
  assert.match(log[0],/reports\.view/i);
  assert.match(log[0],/revoked_at_ms IS NULL/i);
  assert.match(log[0],/Shop Name/);
  assert.match(log[0],/Currency Symbol/);
  assert.doesNotMatch(log[0],/allowed_modules/i);
  assert.equal(log.params[0].length,64,'session fingerprint, not bearer');
  assert.notEqual(log.params[0],TOKEN);
});
test('no authorized row fails closed and does not expose Settings defaults',async()=>{
  const log=[];
  await assert.rejects(()=>createM04AuthorizedReportsBootstrapReader(mockEnv([],log))
    .getBootstrap(request()),/denied|unauthoriz/i);
  assert.equal(log.length,1);
});
test('authorized session with no Settings rows receives safe frozen defaults',async()=>{
  const log=[];
  const result=await createM04AuthorizedReportsBootstrapReader(mockEnv([{key:null,value:null}],log))
    .getBootstrap(request({today:'2024-02-29'}));
  assert.equal(result.shopName,'Hardware Store ERP');
  assert.equal(result.currencySymbol,'');
  assert.equal(result.defaultFrom,'2024-02-01');
});
test('invalid request is rejected before querying and cannot forge roles or permission',async()=>{
  const log=[];const reader=createM04AuthorizedReportsBootstrapReader(mockEnv([],log));
  for(const req of [
    request({token:'not-a-token'}),request({token:'A'.repeat(64)}),
    request({nowMs:NaN}),request({nowMs:'1800000000000'}),
    request({today:'2026-02-30'}),request({today:'2026-11-15T00:00:00Z'}),
    request({actor:'Administrator'}),request({permission:'reports.view'}),
    Object.assign(Object.create(null),{token:TOKEN,nowMs:NOW}),
    Object.defineProperty({token:TOKEN,nowMs:NOW},'today',{get(){throw Error('getter invoked');},enumerable:true}),
  ])await assert.rejects(()=>reader.getBootstrap(req),/invalid|trusted|date|request/i);
  assert.equal(log.length,0);
});
test('malformed, duplicate or private-key D1 rows fail closed',async()=>{
  for(const rows of [
    [{key:'JWT_SECRET',value:'private'}],
    [{key:'Shop Name',value:'A'},{key:'Shop Name',value:'B'}],
    [{key:'Shop Name',value:17}],
    [{key:'Shop Name',value:'A'},{key:'Currency Symbol',value:'৳'},{key:'Phone 1',value:'secret'}]
  ])await assert.rejects(()=>createM04AuthorizedReportsBootstrapReader(mockEnv(rows,[]))
     .getBootstrap(request()),/invalid|unsafe|malformed|NEEDS_REVIEW/i);
});
test('D1 failures reject without producing a partial bootstrap',async()=>{
  const reader=createM04AuthorizedReportsBootstrapReader({
    DB:{prepare(){return {bind(){return {all:async()=>({success:false,results:[]})};}};}}
  });
  await assert.rejects(()=>reader.getBootstrap(request()),/invalid|unavailable|NEEDS_REVIEW/i);
});
