import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sampleInstance from '../fixtures/portable-instance.json' with {type:'json'};
import {buildShopUserCandidate,writeShopUserCandidate}
  from '../../scripts/port-p5-shop-user-login.mjs';

function instance(){
  const data=structuredClone(sampleInstance);
  data.workersSubdomain='hisab';
  data.workers={admin:'admin',owner:'shererp'};
  data.origins={
    admin:'https://admin.hisab.workers.dev',
    owner:'https://shererp.hisab.workers.dev'
  };
  return data;
}
const USER_ORIGIN='https://shererp.hisab.workers.dev';

test('shop login reuses Owner Worker and same-origin sessions on the existing user URL',()=>{
  const candidate=buildShopUserCandidate(instance(),USER_ORIGIN);
  assert.equal(candidate.name,'shererp');
  assert.equal(candidate.main,'../../src/m03-owner-redemption-worker.js');
  assert.equal(candidate.vars.OWNER_AUTH_ORIGIN,USER_ORIGIN);
  assert.equal(candidate.vars.PLATFORM_AUTH_ORIGIN,'https://admin.hisab.workers.dev');
  assert.equal(candidate.vars.OWNER_LOGIN_ENABLED,'true');
  assert.equal(candidate.vars.OWNER_GMAIL_SIGNUP_ENABLED,'true');
  assert.equal(candidate.vars.OWNER_DASHBOARD_BOOTSTRAP_ENABLED,'true');
  assert.equal(candidate.vars.OWNER_REDEMPTION_ENABLED,'false');
  assert.equal(candidate.workers_dev,true);
  assert.equal(candidate.preview_urls,false);
  assert.equal(candidate.assets.directory,'../../dist-owner');
  assert.equal(candidate.assets.run_worker_first,true);
});

test('candidate binds only approved control + one pilot shop, never admin/preview identity',()=>{
  const p=instance();
  const candidate=buildShopUserCandidate(p,USER_ORIGIN);
  assert.deepEqual(candidate.d1_databases.map(db=>db.binding),['CONTROL_DB','PLATFORM_PILOT_DB']);
  assert.deepEqual(candidate.d1_databases.map(db=>db.database_id),[p.d1.control.id,p.d1.pilot.id]);
  assert.equal(candidate.vars.PLATFORM_PILOT_SHOP_ID,p.d1.pilot.shopId);
  assert.equal(candidate.vars.PLATFORM_PILOT_MARKER,p.d1.pilot.marker);
  assert.equal(candidate.vars.PLATFORM_PILOT_D1_ID,p.d1.pilot.id);
  assert.equal(candidate.ratelimits[0].name,'OWNER_INGRESS');
  assert.equal(candidate.vars.PLATFORM_AUTH_SCOPE,undefined);
  assert.equal(candidate.vars.PLATFORM_CLIENT_ID,undefined);
  assert.equal(candidate.routes,undefined);
});

test('Owner sign-in candidate cannot activate money, product writers, support, or public RPC',()=>{
  const p=buildShopUserCandidate(instance(),USER_ORIGIN);
  for(const key of [
    'OWNER_CATALOG_ENABLED','OWNER_CLEAN_PRODUCTS_ENABLED','OWNER_WRITE_GRANTS_ENABLED',
    'OWNER_MVP_PURCHASE_ENABLED','OWNER_MVP_POS_CASH_ENABLED',
    'OWNER_MVP_CASH_RETURN_ENABLED','OWNER_SUPPORT_AUDIT_ENABLED'
  ])assert.equal(p.vars[key],'false',key);
  assert.equal(p.vars.OWNER_GMAIL_SIGNUP_ENABLED,'true');
  assert.equal(p.vars.OWNER_LOGIN_ENABLED,'true');
  assert.equal(p.main.includes('src/index.js'),false);
  assert.equal(JSON.stringify(p).includes('PLATFORM_TOTP_SECRET'),false);
  assert.equal(JSON.stringify(p).includes('PLATFORM_BOOTSTRAP_CODE'),false);
});

test('fail closed on different URL, wrong worker, bad manifest or public preview collision',()=>{
  const p=instance();
  for(const target of [
    'https://owner.hisab.workers.dev','http://shererp.hisab.workers.dev',
    'https://shererp.hisab.workers.dev/app',''
  ])assert.throws(()=>buildShopUserCandidate(p,target),/Shop-user candidate/);
  const wrong=instance();
  wrong.workers.owner='owner';
  wrong.origins.owner='https://owner.hisab.workers.dev';
  assert.throws(()=>buildShopUserCandidate(wrong,USER_ORIGIN),/Shop-user candidate/);
  const preview=instance();
  preview.workers.owner='hisabiq';
  preview.origins.owner='https://hisabiq.hisab.workers.dev';
  assert.throws(()=>buildShopUserCandidate(preview,preview.origins.owner),/Shop-user candidate/);
});

test('generated candidate is private, idempotent and never overwrites a changed profile',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shererp-owner-p5-'));
  try{
    const first=await writeShopUserCandidate(instance(),USER_ORIGIN,root);
    assert.match(first,/shop-user\.candidate\.jsonc$/);
    const saved=JSON.parse(await readFile(first,'utf8'));
    assert.equal(saved.name,'shererp');
    assert.equal((await stat(first)).mode&0o077,0);
    assert.equal(await writeShopUserCandidate(instance(),USER_ORIGIN,root),first);
    const changed=instance();
    changed.d1.pilot.marker='55555555-5555-4555-8555-555555555555';
    await assert.rejects(
      ()=>writeShopUserCandidate(changed,USER_ORIGIN,root),
      /Refusing to overwrite/
    );
    assert.deepEqual(JSON.parse(await readFile(first,'utf8')),saved);
  }finally{await rm(root,{force:true,recursive:true});}
});
