import assert from 'node:assert/strict';
import {copyFile,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {createTestHarness} from 'wrangler';
import {issueOwnerSession} from '../../src/auth/platform-owner-sessions.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

const tuple=(n)=>({shopId:`00000000-0000-4000-8000-00000000010${n}`,databaseId:`00000000-0000-4000-8000-00000000020${n}`,marker:`00000000-0000-4000-8000-00000000030${n}`});
async function migrationQueue(dir,files){
  await mkdir(dir);
  await Promise.all(files.map(file=>copyFile(file,join(dir,basename(file)))));
  return dir;
}

async function seed(CONTROL_DB,DB,scope,subject,index){
  const {shopId,databaseId,marker}=scope;
  const now=Date.now();
  await DB.prepare('INSERT INTO shop_identity VALUES (1,?,?,?)').bind(shopId,databaseId,marker).run();
  await CONTROL_DB.batch([
    CONTROL_DB.prepare('INSERT INTO platform_shop_reservations VALUES (?,?,?,?,?)').bind(shopId,crypto.randomUUID(),`Empty shop ${index}`,'fixture-admin',now),
    CONTROL_DB.prepare('INSERT INTO platform_shop_bindings VALUES (?,?,?,?,?)').bind(shopId,databaseId,marker,'fixture-admin',now),
    CONTROL_DB.prepare('INSERT INTO platform_owner_invitations VALUES (?,?,?,?,?,?,?)').bind(String(index).repeat(64),shopId,'https://accounts.google.com',subject,'fixture-admin',now,now+600000),
    CONTROL_DB.prepare('INSERT INTO platform_first_shop_owners VALUES (?,?,?,?,?)').bind(shopId,String(index).repeat(64),'https://accounts.google.com',subject,now),
  ]);
  const env={CONTROL_DB,PLATFORM_PILOT_DB:DB,PLATFORM_PILOT_SHOP_ID:shopId,PLATFORM_PILOT_D1_ID:databaseId,PLATFORM_PILOT_MARKER:marker};
  const token=await issueOwnerSession(env,{issuer:'https://accounts.google.com',subject});
  assert.equal(typeof token,'string');
  await DB.prepare(`CREATE TABLE fixture_owner_write_grants (
    token_hash TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
  ) STRICT`).run();
  await DB.prepare('INSERT INTO fixture_owner_write_grants VALUES (?,1)').bind(await hashOpaqueSessionToken(token)).run();
  return {env,token};
}

export async function startCleanShopHarness(){
  const temp=await mkdtemp(join(tmpdir(),'shererp-clean-shop-'));
  let harness;
  const close=async()=>{try{await harness?.close();}finally{await rm(temp,{recursive:true,force:true});}};
  try{
    const [a,b]=[tuple(1),tuple(2)];
    const controlMigrations=await migrationQueue(join(temp,'control'),[
      '0001_shop_reservations','0002_shop_bindings','0003_owner_invitations',
      '0004_first_shop_owner','0005_owner_sessions','0006_owner_login_challenges',
    ].map(name=>`staging-migrations/platform-onboarding/${name}.sql`));
    const shopMigrations=await migrationQueue(join(temp,'shop'),[
      'staging-migrations/shop-identity/0001_shop_identity.sql','migrations/0001_core_catalog.sql',
      'migrations/0012_legacy_product_snapshots.sql','migrations/0013_product_catalog_revisions.sql',
    ]);
    const configPath=join(temp,'wrangler.json');
    await writeFile(configPath,JSON.stringify({
      name:'shererp-clean-shop-local-only',main:resolve('tests/fixtures/m03-clean-shop-product-worker.mjs'),
      compatibility_date:'2026-11-14',workers_dev:false,preview_urls:false,
      vars:{CLEAN_SHOP_FIXTURE:'true',SHOP_A:JSON.stringify(a),SHOP_B:JSON.stringify(b)},
      d1_databases:[['CONTROL_DB',crypto.randomUUID()],['SHOP_A_DB',a.databaseId],['SHOP_B_DB',b.databaseId]]
        .map(([binding,database_id])=>({binding,database_name:binding.toLowerCase(),database_id,remote:false,
          migrations_dir:binding==='CONTROL_DB'?controlMigrations:shopMigrations})),
    }));
    harness=createTestHarness({workers:[{configPath}]});
    await harness.listen();
    const worker=harness.getWorker('shererp-clean-shop-local-only');
    const {CONTROL_DB,SHOP_A_DB,SHOP_B_DB}=await worker.getEnv();
    for(const binding of ['CONTROL_DB','SHOP_A_DB','SHOP_B_DB']){
      await worker.applyD1Migrations(binding);
    }
    const ownerA=await seed(CONTROL_DB,SHOP_A_DB,a,'fixture-owner-a',1);
    const ownerB=await seed(CONTROL_DB,SHOP_B_DB,b,'fixture-owner-b',2);
    return {worker,ownerA,ownerB,SHOP_A_DB,SHOP_B_DB,close};
  }catch(error){
    await close();
    throw error;
  }
}
