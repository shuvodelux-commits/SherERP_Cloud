import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildPrivateProvisionerProfile}
  from '../../scripts/m03-private-provisioner-deploy.mjs';

const base={
  accountId:'0123456789abcdef0123456789abcdef',
  controlDbName:'shererp-control',controlDbId:'11111111-1111-4111-8111-111111111111',
  maxDatabases:10
};
test('non-public Provisioner Worker profile defaults to closed with only Control D1',()=>{
  const p=buildPrivateProvisionerProfile(base);
  assert.equal(p.name,'shererp-provisioner');
  assert.equal(p.workers_dev,false);
  assert.equal(p.preview_urls,false);
  assert.equal(p.main,'../src/m03-private-shop-provisioner-worker.js',
    'Wrangler config resides under .wrangler, so paths must be relative');
  assert.deepEqual(p.vars,{
    PROVISIONER_RELEASE_ENABLED:'false',
    PROVISIONER_ALLOWED_ACCOUNT_ID:base.accountId,
    PROVISIONER_MAX_DATABASES:'10'
  });
  assert.equal(p.d1_databases.length,1);
  assert.equal(p.d1_databases[0].binding,'CONTROL_DB');
  assert.equal(p.d1_databases[0].database_id,base.controlDbId);
  const content=JSON.stringify(p);
  for(const secret of [
    'CLOUDFLARE_API_TOKEN','PROVISIONER_INTERNAL_KEY','PLATFORM_TOTP_SECRET',
    'GOOGLE_CLIENT_SECRET','OWNER_SESSION','SUPPORT_TOKEN'
  ])assert.equal(content.includes(secret),false,
    'no literal credentials or secret names as runtime plaintext variables');
  assert.equal(p.routes,undefined);
});

test('rejects invalid accounts, wrong Control DB and arbitrary service settings',()=>{
  for(const patch of [
    {accountId:'wrong'},{controlDbId:'wrong'},
    {controlDbName:'../db'},{maxDatabases:0},{maxDatabases:1001},
    {routes:['https://public.example.test/*']},
    {workers_dev:true},
    {PROVISIONER_RELEASE_ENABLED:'true'}
  ])assert.throws(()=>buildPrivateProvisionerProfile({...base,...patch}),
    /PRIVATE_PROVISIONER_CONFIG_DENIED/);
});
