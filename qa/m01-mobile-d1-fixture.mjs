import {createTestHarness} from 'wrangler';
import {createOfflinePasswordCredential} from '../src/auth/d1-auth-core.js';
import {createD1LegacyAuthRpc} from '../src/auth/d1-legacy-rpc.js';
import {serveCompiledUi} from './serve-compiled-ui.mjs';

// Entirely synthetic M01 browser QA. Uses the existing M04 local-only Worker
// and a disposable real D1, never a public RPC or remote data store.
const MOBILE='01710000903';
const PASSWORD='Synthetic!M01-Phone#2026';
const USER_ID='USR-M01-PHONE-D1';
const ROLE_NAME='M01PhoneClerk';

export async function createM01PhoneD1AuthFixture({now}) {
  if(!Number.isSafeInteger(now) || now<=0)
    throw new Error('M01 local-D1 auth fixture requires a fixed test clock');

  const harness=createTestHarness({
    workers:[{configPath:'./wrangler.m04-auth-http-test.jsonc'}]
  });
  let site;
  try{
    await harness.listen();
    const worker=harness.getWorker('shererp-m04-auth-http-local-only');
    await worker.applyD1Migrations('DB');
    const {DB}=await worker.getEnv();
    const cred=await createOfflinePasswordCredential(PASSWORD);
    await DB.prepare(
      'INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) '+
      "VALUES(?,'Active',?,?)"
    ).bind(ROLE_NAME,
      JSON.stringify({dashboard:{view:true},reports:{view:true}}),
      'dashboard,reports').run();
    await DB.prepare(
      'INSERT INTO auth_users '+
      '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
      "VALUES(?,?,?,?,'Active',?,?,?)"
    ).bind(USER_ID,'Synthetic Mobile Clerk',MOBILE,ROLE_NAME,
      cred.passwordHash,cred.passwordSalt,cred.iterations).run();

    const adapter=createD1LegacyAuthRpc(DB,{
      now:()=>now,
      normalizeMobile:value=>typeof value==='string'?value.trim():''
    });
    site=await serveCompiledUi({internalAuthAdapter:adapter});
    return {
      site,
      db:DB,
      userId:USER_ID,
      mobile:MOBILE,
      password:PASSWORD,
      close:async()=>{
        try{await site.close();}
        finally{await harness.close();}
      }
    };
  }catch(error){
    try{await site?.close();}finally{await harness.close();}
    throw error;
  }
}
