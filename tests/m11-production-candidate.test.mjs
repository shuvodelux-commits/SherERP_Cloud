import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';
import {M11_PHASE_CHECKS} from '../scripts/check-m11-release-evidence.mjs';
import {assessM11ProductionCandidate} from '../scripts/check-m11-production-candidate.mjs';

const load=name=>JSON.parse(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
const preview=load('wrangler.preview.jsonc');
const staging=load('wrangler.staging.jsonc');
const currentMainConfig=load('wrangler.jsonc');
const RELEASE='a'.repeat(40);
const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const verified=id=>({status:'verified',record:'audit/'+id,releaseSha:RELEASE});
const releaseEvidence=()=>({
  schemaVersion:1,releaseSha:RELEASE,sourceSha:SOURCE,
  checks:Object.fromEntries(M11_PHASE_CHECKS.prepare.map(id=>[id,verified(id)]))
});
function productionConfig(){
  return {
    name:'shererp-cloud-production',
    main:'src/index.js',
    compatibility_date:'2026-11-14',
    workers_dev:false,
    previews:{},
    assets:{...preview.assets,run_worker_first:[...preview.assets.run_worker_first]},
    d1_databases:[{
      binding:'DB',
      database_name:'shererp-production-db',
      database_id:'11111111-2222-4333-8444-555555555555',
      migrations_dir:'migrations'
    }]
  };
}
const health=()=>({
  status:'ready',service:'shererp-cloud',database:'connected',
  worker:'shererp-cloud-production',releaseSha:RELEASE
});
const inputs=()=>({preview,staging,production:productionConfig(),observedHealth:health(),releaseEvidence:releaseEvidence()});
const pins={expectedReleaseSha:RELEASE,expectedSourceSha:SOURCE};
const check=(input,options=pins)=>assessM11ProductionCandidate(input,options);

test('no candidate blocks release rather than treating main preview as production',()=>{
  const x=check(undefined);
  assert.equal(x.documentaryComplete,false);
  assert.equal(x.authorizesDeployment,false);
  assert.ok(x.blockers.length);
});

test('complete synthetic isolated candidate is documentary-only',()=>{
  const x=check(inputs());
  assert.equal(x.documentaryComplete,true);
  assert.equal(x.authorizesDeployment,false);
  assert.deepEqual(x.blockers,[]);
  assert.match(x.caution,/not.*authoriz|independently/i);
});

test('actual current main Worker returns foundation health and current wrangler has no production D1; NO-GO',async()=>{
  const res=await worker.fetch(new Request('https://example.test/api/health'),{});
  assert.equal(res.status,200);
  const actualHealth=await res.json();
  assert.equal(actualHealth.status,'foundation');
  assert.equal(actualHealth.database,'not-connected');
  const x=check({...inputs(),production:currentMainConfig,observedHealth:actualHealth});
  assert.equal(x.documentaryComplete,false);
  assert.equal(x.authorizesDeployment,false);
  assert.ok(x.blockers.includes('M11_PROD_CONFIG_INVALID'));
  assert.ok(x.blockers.includes('M11_PROD_HEALTH_NOT_READY'));
});

test('preview or staging Worker identity never becomes production',()=>{
  const p=inputs();
  p.production.name=preview.name;
  assert.ok(check(p).blockers.includes('M11_PROD_ISOLATION_VIOLATION'));
  p.production.name=staging.name;
  assert.ok(check(p).blockers.includes('M11_PROD_ISOLATION_VIOLATION'));
});

test('production must use separate D1 identity from staging',()=>{
  const p=inputs();
  p.production.d1_databases[0].database_id=staging.d1_databases[0].database_id;
  assert.ok(check(p).blockers.includes('M11_PROD_ISOLATION_VIOLATION'));
  p.production.d1_databases[0].database_id='11111111-2222-4333-8444-555555555555';
  p.production.d1_databases[0].database_name=staging.d1_databases[0].database_name;
  assert.ok(check(p).blockers.includes('M11_PROD_ISOLATION_VIOLATION'));
});

test('public workers.dev or preview resource binding on production candidate is prohibited',()=>{
  const p=inputs();
  p.production.workers_dev=true;
  assert.ok(check(p).blockers.includes('M11_PROD_CONFIG_INVALID'));
  p.production.workers_dev=false;
  p.production.previews={d1_databases:[{binding:'DB'}]};
  assert.ok(check(p).blockers.includes('M11_PROD_CONFIG_INVALID'));
});

test('production config must have exact D1 binding, migration directory and original assets routing',()=>{
  const p=inputs();
  p.production.d1_databases[0].binding='WRONG';
  assert.ok(check(p).blockers.includes('M11_PROD_CONFIG_INVALID'));
  p.production=productionConfig();
  p.production.assets.run_worker_first=['/*'];
  assert.ok(check(p).blockers.includes('M11_PROD_CONFIG_INVALID'));
  p.production=productionConfig();
  p.production.d1_databases=[];
  assert.ok(check(p).blockers.includes('M11_PROD_CONFIG_INVALID'));
});

test('foundation, disconnected, mismatched release or untrusted health is never ready',()=>{
  const p=inputs();
  p.observedHealth.status='foundation';
  p.observedHealth.database='not-connected';
  assert.ok(check(p).blockers.includes('M11_PROD_HEALTH_NOT_READY'));
  p.observedHealth=health();
  p.observedHealth.releaseSha='b'.repeat(40);
  assert.ok(check(p).blockers.includes('M11_PROD_HEALTH_NOT_READY'));
  p.observedHealth=health();
  p.observedHealth.worker=staging.name;
  assert.ok(check(p).blockers.includes('M11_PROD_HEALTH_NOT_READY'));
});

test('M10 owner-signoff evidence and pinned release/source commits are mandatory',()=>{
  const p=inputs();
  delete p.releaseEvidence.checks['m10-owner-signoff'];
  assert.ok(check(p).blockers.includes('M11_PROD_RELEASE_GATE_BLOCKED'));
  assert.ok(check(inputs(),{expectedReleaseSha:'wrong',expectedSourceSha:SOURCE}).blockers.includes('M11_PROD_PIN_MISMATCH'));
  const q=inputs(); q.releaseEvidence.sourceSha='b'.repeat(40);
  assert.ok(check(q).blockers.includes('M11_PROD_RELEASE_GATE_BLOCKED'));
});

test('unknown fields including URLs, routes and embedded credentials are forbidden',()=>{
  const p=inputs();
  p.production.route='business.example.com';
  assert.ok(check(p).blockers.includes('M11_PROD_CONFIG_INVALID'));
  const q=inputs();q.credentials='do-not-store';
  assert.ok(check(q).blockers.includes('M11_PROD_INPUT_INVALID'));
  const s=inputs();s.observedHealth.url='https://example.test/?token=secret';
  assert.ok(check(s).blockers.includes('M11_PROD_HEALTH_NOT_READY'));
});

test('existing preview/staging safety contract drift prevents promotion',()=>{
  const p=inputs();
  p.preview={...preview,d1_databases:[{binding:'DB'}]};
  assert.ok(check(p).blockers.includes('M11_PROD_BOUNDARY_INVALID'));
  const q=inputs();q.staging={...staging,workers_dev:true};
  assert.ok(check(q).blockers.includes('M11_PROD_BOUNDARY_INVALID'));
});
