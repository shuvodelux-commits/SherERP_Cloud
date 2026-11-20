import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {
  validatePortableInstance,buildPortableProfiles,writePortableInstanceConfigs
} from '../../scripts/port-p1-instance.mjs';

import instanceFixture from '../fixtures/portable-instance.json' with {type:'json'};
const sample=()=>structuredClone(instanceFixture);

test('rejects unknown keys, malformed or placeholder identity and unapproved origins',()=>{
  const good=sample();
  assert.deepEqual(validatePortableInstance(good),good);
  const bad=[
    {...good,extra:'client_secret'},
    {...good,accountId:'<ACCOUNT_ID>'},
    {...good,accountId:'a'.repeat(33)},
    {...good,origins:{...good.origins,admin:'http://admin-shererp.fresh-shop-account.workers.dev'}},
    {...good,origins:{...good.origins,admin:'https://wrong.fresh-shop-account.workers.dev'}},
    {...good,origins:{...good.origins,owner:'https://owner-shererp.fresh-shop-account.workers.dev/path'}},
    {...good,workers:{admin:'admin-shererp',owner:'admin-shererp'}},
    {...good,workersSubdomain:'agnishuvo.example.org'},
    {...good,d1:{...good.d1,pilot:{...good.d1.pilot,id:good.d1.control.id}}},
    {...good,d1:{...good.d1,pilot:{...good.d1.pilot,id:'00000000-0000-0000-0000-000000000000'}}},
    {...good,googleClientId:'not-a-google-client'},
    {...good,rateLimits:{adminNamespaceId:'654321',ownerNamespaceId:'654321'}},
    {...good,d1:{...good.d1,control:{...good.d1.control,secret:'MUST-NOT-APPEAR'}}}
  ];
  for(const value of bad)assert.throws(()=>validatePortableInstance(value),/Invalid portable instance/);
});

test('generates isolated, inactive two-Worker config without preview DB or secrets',()=>{
  const profiles=buildPortableProfiles(validatePortableInstance(sample()));
  assert.deepEqual(Object.keys(profiles).sort(),['admin','owner']);
  assert.equal(profiles.admin.name,'admin-shererp');
  assert.equal(profiles.admin.main,'../../src/m03-access-platform-auth-worker.js');
  assert.equal(profiles.admin.account_id,sample().accountId);
  assert.equal(profiles.admin.workers_dev,false);
  assert.equal(profiles.admin.preview_urls,false);
  assert.equal(profiles.admin.vars.PLATFORM_AUTH_ORIGIN,sample().origins.admin);
  assert.equal(profiles.admin.vars.PLATFORM_CLIENT_ID,sample().googleClientId);
  assert.equal(profiles.admin.d1_databases.length,1);
  assert.equal(profiles.admin.d1_databases[0].binding,'CONTROL_DB');
  assert.equal(profiles.owner.main,'../../src/m03-owner-redemption-worker.js');
  assert.equal(profiles.owner.vars.OWNER_AUTH_ORIGIN,sample().origins.owner);
  assert.equal(profiles.owner.d1_databases[1].binding,'PLATFORM_PILOT_DB');
  assert.equal(profiles.owner.d1_databases[1].database_id,sample().d1.pilot.id);
  assert.equal(profiles.owner.vars.PLATFORM_PILOT_SHOP_ID,sample().d1.pilot.shopId);
  assert.equal(profiles.owner.vars.PLATFORM_PILOT_MARKER,sample().d1.pilot.marker);
  for(const profile of Object.values(profiles)){
    assert.equal(profile.routes,undefined);
    assert.equal(profile.workers_dev,false);
    assert.equal(profile.preview_urls,false);
    assert.equal(JSON.stringify(profile).includes('SECRET'),false);
    assert.equal(JSON.stringify(profile).includes('TOKEN'),false);
    assert.equal(JSON.stringify(profile).includes('enabled":true'),false);
  }
});

test('writes only gitignored local drafts with safe idempotency and refuses a changed instance',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'shererp-port-p1-'));
  try{
    const root=join(dir,'repo');
    const result=await writePortableInstanceConfigs(sample(),root);
    assert.ok(result.adminPath.startsWith(join(root,'.wrangler','portable-instance')+'/'));
    const admin=JSON.parse(await readFile(result.adminPath,'utf8'));
    const owner=JSON.parse(await readFile(result.ownerPath,'utf8'));
    assert.equal(admin.workers_dev,false);
    assert.equal(owner.workers_dev,false);
    assert.equal(resolve(dirname(result.adminPath),admin.main),join(root,'src/m03-access-platform-auth-worker.js'));
    assert.equal(resolve(dirname(result.ownerPath),owner.main),join(root,'src/m03-owner-redemption-worker.js'));
    assert.equal(resolve(dirname(result.ownerPath),owner.assets.directory),join(root,'dist-owner'));
    assert.equal(resolve(dirname(result.adminPath),admin.d1_databases[0].migrations_dir),join(root,'staging-migrations/platform-auth'));
    assert.equal((await stat(result.adminPath)).mode&0o077,0);
    assert.deepEqual(await writePortableInstanceConfigs(sample(),root),result);
    const different={...sample(),workers:{...sample().workers,admin:'admin-other'},
      origins:{...sample().origins,admin:'https://admin-other.fresh-shop-account.workers.dev'}};
    await assert.rejects(()=>writePortableInstanceConfigs(different,root),/existing local instance config/);
    assert.equal(JSON.parse(await readFile(result.adminPath,'utf8')).name,'admin-shererp');
  }finally{await rm(dir,{force:true,recursive:true});}
});

test('never enables preview DB or remote migrations and validates two distinct Shop bindings',()=>{
  const profiles=buildPortableProfiles(sample());
  for(const profile of Object.values(profiles)){
    for(const d1 of profile.d1_databases){
      assert.equal(d1.remote,false);
      assert.equal(d1.database_id.length,36);
    }
  }
  assert.ok(profiles.owner.d1_databases.some(d=>d.binding==='CONTROL_DB'));
  assert.notEqual(profiles.owner.d1_databases[0].database_id,
    profiles.owner.d1_databases[1].database_id);
});

test('private profile generation rejects the public preview Worker in either role',()=>{
  for(const role of ['admin','owner']){
    const instance=sample();
    instance.workers[role]='hisabiq';
    instance.origins[role]='https://hisabiq.'+instance.workersSubdomain+'.workers.dev';
    assert.throws(()=>buildPortableProfiles(instance),/Invalid portable instance/);
  }
});

test('ingress namespaces use distinct positive integer identities',()=>{
  for(const [adminNamespaceId,ownerNamespaceId] of [['0','2'],['1','01']]){
    const instance=sample();
    instance.rateLimits={adminNamespaceId,ownerNamespaceId};
    assert.throws(()=>validatePortableInstance(instance),/Invalid portable instance/);
  }
});
