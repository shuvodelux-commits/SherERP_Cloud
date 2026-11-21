import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {auditOwnerCoreRefresh} from '../../scripts/m11-owner-core-refresh-parity.mjs';

const SHA='a'.repeat(40);
const UUID=(n)=>`${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const base=()=>({
 name:'shererp',main:'src/m03-owner-redemption-worker.js',workers_dev:true,
 preview_urls:false,keep_vars:false,
 assets:{binding:'ASSETS',directory:'dist-owner',run_worker_first:true},
 d1_databases:[
  {binding:'CONTROL_DB',database_id:UUID('1')},
  {binding:'PLATFORM_PILOT_DB',database_id:UUID('2')}
 ],
 ratelimits:[{name:'OWNER_INGRESS',namespace_id:'1234',simple:{limit:40,period:60}}],
 vars:{
  OWNER_AUTH_ORIGIN:'https://shererp.hisab.workers.dev',
  PLATFORM_AUTH_ORIGIN:'https://admin.hisab.workers.dev',
  PLATFORM_PILOT_D1_ID:UUID('2'),
  PLATFORM_PILOT_SHOP_ID:UUID('3'),
  PLATFORM_PILOT_MARKER:UUID('4'),
  PLATFORM_OWNER_CLIENT_ID:'CLIENT_CANARY.apps.googleusercontent.com',
  OWNER_LOGIN_ENABLED:'true',OWNER_GMAIL_SIGNUP_ENABLED:'true',
  OWNER_DASHBOARD_BOOTSTRAP_ENABLED:'true',OWNER_CATALOG_ENABLED:'true',
  OWNER_CLEAN_PRODUCTS_ENABLED:'true',OWNER_WRITE_GRANTS_ENABLED:'true',
  OWNER_MVP_PURCHASE_ENABLED:'true',OWNER_MVP_POS_CASH_ENABLED:'true',
  OWNER_MVP_CASH_RETURN_ENABLED:'false',OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED:'false',
  OWNER_REDEMPTION_ENABLED:'false',OWNER_SUPPORT_AUDIT_ENABLED:'false'
 }
});
const live=(c=base())=>({resources:{bindings:[
 {name:'ASSETS',type:'assets'},
 ...c.d1_databases.map(d=>({name:d.binding,type:'d1',id:d.database_id,database_id:d.database_id})),
 ...c.ratelimits.map(l=>({name:l.name,type:'ratelimit',namespace_id:l.namespace_id,simple:l.simple})),
 ...Object.entries(c.vars).map(([name,text])=>({name,text,type:'plain_text'}))
]}});
const assess=(version=live(),candidate=base(),sha=SHA,approved=SHA)=>
 auditOwnerCoreRefresh({liveVersion:version,candidate,mainSha:sha,releaseSha:approved});

test('M11: matching approved core refresh proves exact live roster without authorizing deployment',()=>{
 const result=assess();
 assert.equal(result.status,'MATCHES_LIVE');
 assert.deepEqual(result.blockers,[]);
 assert.equal(result.authorizesDeployment,false);
 assert.equal(result.productionReady,false);
 assert.equal(result.checksLiveBindings,true);
 assert.equal(JSON.stringify(result).includes('CLIENT_CANARY'),false);
});

test('M11: rejects active Shop D1/identity, rate, origin, and complete variable roster drift',()=>{
 for(const mutate of [
  c=>{c.d1_databases[1].database_id=UUID('5')},
  c=>{c.ratelimits[0].namespace_id='9999'},
  c=>{c.ratelimits[0].simple.limit=5},
  c=>{c.vars.PLATFORM_PILOT_MARKER=UUID('6')},
  c=>{c.vars.PLATFORM_OWNER_CLIENT_ID='OTHER.apps.googleusercontent.com'},
  c=>{c.vars.OWNER_MVP_PURCHASE_ENABLED='false'},
  c=>{c.vars.OWNER_MVP_POS_CASH_ENABLED='false'},
  c=>{c.vars.OWNER_MVP_CASH_RETURN_ENABLED='true'},
  c=>{c.vars.OWNER_MVP_SUPPLIER_CASH_PAY_ENABLED='true'},
  c=>{c.vars.UNREVIEWED_ENABLED='true'},
  c=>{delete c.vars.OWNER_CATALOG_ENABLED},
  c=>{c.assets.directory='dist'},
  c=>{c.main='src/index.js'},
  c=>{c.keep_vars=true},
  c=>{c.workers_dev=false}
 ]){
  const candidate=base();mutate(candidate);
  const report=assess(live(),candidate);
  assert.equal(report.status,'BLOCKED');
  assert.equal(report.authorizesDeployment,false);
  assert.ok(report.blockers.length);
  assert.equal(JSON.stringify(report).includes(UUID('3')),false);
 }
});

test('M11: refuses extra bindings, duplicate names, secret binding and ambiguous D1 ids',()=>{
 for(const next of [
  v=>v.resources.bindings.push({name:'UNAUTHORIZED',type:'plain_text',text:'hello'}),
  v=>v.resources.bindings.push({...v.resources.bindings[1]}),
  v=>v.resources.bindings.push({name:'INJECTED_SECRET',type:'secret_text'}),
  v=>v.resources.bindings.find(b=>b.name==='CONTROL_DB').database_id=UUID('9'),
  v=>v.resources.bindings.splice(0,1)
 ]){
  const version=live();next(version);
  assert.equal(assess(version).status,'BLOCKED');
 }
});

test('M11: never trusts branch/unpinned or different SHA, or uncontrolled evidence shape',()=>{
 assert.equal(assess(live(),base(),SHA,'b'.repeat(40)).status,'BLOCKED');
 assert.equal(assess(live(),base(),'invalid',SHA).status,'BLOCKED');
 assert.equal(assess({},base()).status,'BLOCKED');
 assert.equal(assess(live(),{...base(),vars:null}).status,'BLOCKED');
});

test('M11: 0600-only CLI does not reveal private candidate and refuses symlink or mismatched SHA',async()=>{
 const root=await mkdtemp(join(tmpdir(),'shererp-m11-refresh-red-'));
 try{
  await mkdir(join(root,'safe'),{mode:0o700});
  const version=join(root,'safe','version.json'),candidate=join(root,'safe','candidate.json');
  await writeFile(version,JSON.stringify(live()),{mode:0o600});
  await writeFile(candidate,JSON.stringify(base()),{mode:0o600});
  const cli=(args)=>spawnSync(process.execPath,['scripts/m11-owner-core-refresh-parity.mjs',...args],
   {encoding:'utf8',timeout:15000});
  const good=cli(['--live-version',version,'--candidate',candidate,'--main-sha',SHA,'--release-sha',SHA]);
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/MATCHES_LIVE/);
  assert.doesNotMatch(good.stdout+good.stderr,/CLIENT_CANARY|33333333|SECRET/);
  const wrong=cli(['--live-version',version,'--candidate',candidate,'--main-sha',SHA,'--release-sha','b'.repeat(40)]);
  assert.notEqual(wrong.status,0);
  const link=join(root,'safe','linked.json');await symlink(version,link);
  const bad=cli(['--live-version',link,'--candidate',candidate,'--main-sha',SHA,'--release-sha',SHA]);
  assert.notEqual(bad.status,0);
  assert.doesNotMatch(bad.stdout+bad.stderr,/CLIENT_CANARY/);
 }finally{await rm(root,{recursive:true,force:true});}
});
