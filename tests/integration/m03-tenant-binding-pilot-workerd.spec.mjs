import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createTestHarness} from 'wrangler';
import './m03-owner-onboarding-workerd.spec.mjs';

const workerPath=fileURLToPath(new URL('../fixtures/m03-tenant-pilot/worker.js',import.meta.url));
const fingerprint=token=>createHash('sha256').update(token).digest('hex');

test('separate local D1 bindings enforce shop membership and verify the bound shop identity',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'shererp-tenant-binding-proof-'));
  let harness;
  try{
    const configPath=join(directory,'wrangler.jsonc');
    const config={
      name:'shererp-tenant-binding-pilot-local-only',main:workerPath,
      compatibility_date:'2026-11-14',workers_dev:false,preview_urls:false,
      d1_databases:['CONTROL','SHOP_A','SHOP_B'].map(binding=>({
        binding,database_name:'fixture-'+binding.toLowerCase(),database_id:randomUUID(),remote:false,
      })),
    };
    await writeFile(configPath,JSON.stringify(config),{mode:0o600});
    harness=createTestHarness({workers:[{configPath}]});
    await harness.listen();
    const worker=harness.getWorker(config.name);
    const {CONTROL,SHOP_A,SHOP_B}=await worker.getEnv();
    const ownerA=randomBytes(32).toString('hex');
    const ownerB=randomBytes(32).toString('hex');
    const both=randomBytes(32).toString('hex');
    const platformAdmin=randomBytes(32).toString('hex');
    await CONTROL.batch([
      CONTROL.prepare(`CREATE TABLE sessions(
        token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL
      ) STRICT`),
      CONTROL.prepare('CREATE TABLE tenants(id TEXT PRIMARY KEY,active INTEGER NOT NULL) STRICT'),
      CONTROL.prepare('CREATE TABLE memberships(tenant_id TEXT,user_id TEXT,PRIMARY KEY(tenant_id,user_id)) STRICT'),
      CONTROL.prepare("INSERT INTO tenants VALUES ('a',1),('b',1)"),
      CONTROL.prepare("INSERT INTO memberships VALUES ('a','owner-a'),('b','owner-b'),('a','owner-ab'),('b','owner-ab')"),
      ...[[ownerA,'owner-a'],[ownerB,'owner-b'],[both,'owner-ab'],[platformAdmin,'platform-admin']]
        .map(([token,user])=>CONTROL.prepare('INSERT INTO sessions VALUES (?,?,?,0)')
          .bind(fingerprint(token),user,Date.now()+60_000)),
    ]);
    async function seedShop(db,id,value){
      await db.batch([
        db.prepare('CREATE TABLE shop_marker(id TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT'),
        db.prepare('INSERT INTO shop_marker VALUES (?,?)').bind(id,value),
      ]);
    }
    await Promise.all([seedShop(SHOP_A,'a','fixture-a'),seedShop(SHOP_B,'b','fixture-b')]);
    const request=(shop,token)=>worker.fetch('https://pilot.example.test/'+shop,{
      headers:{Authorization:'Bearer '+token},
    });
    const cases=[
      ['a',ownerA,200,'fixture-a'],['b',ownerA,403],['b',ownerB,200,'fixture-b'],['a',ownerB,403],
      ['a',both,200,'fixture-a'],['b',both,200,'fixture-b'],['a',platformAdmin,403],
      ['constructor',ownerA,404],['a','unverified',403],
      ['a',randomBytes(32).toString('hex'),403],
    ];
    for(const [shop,token,status,value] of cases){
      const response=await request(shop,token);
      assert.equal(response.status,status);
      if(value)assert.deepEqual(await response.json(),{value});
    }

    await SHOP_B.prepare("UPDATE shop_marker SET id='a' WHERE id='b'").run();
    assert.equal((await request('b',ownerB)).status,503,'wrong shop DB identity fails closed');
    await CONTROL.prepare("UPDATE tenants SET active=0 WHERE id='a'").run();
    assert.equal((await request('a',ownerA)).status,403,'suspended shop fails closed');
    await CONTROL.prepare("UPDATE tenants SET active=1 WHERE id='a'").run();
    await CONTROL.prepare("UPDATE sessions SET expires_at=0 WHERE user_id='owner-b'").run();
    await SHOP_B.prepare("UPDATE shop_marker SET id='b' WHERE id='a'").run();
    assert.equal((await request('b',ownerB)).status,403,'expired session fails closed');
    await CONTROL.prepare("UPDATE sessions SET revoked=1 WHERE user_id='owner-a'").run();
    assert.equal((await request('a',ownerA)).status,403,'revoked session fails closed');
  }finally{
    await harness?.close();
    await rm(directory,{recursive:true,force:true});
  }
});
