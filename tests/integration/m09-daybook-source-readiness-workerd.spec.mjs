import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import publicWorker from '../../src/index.js';

const original=readFileSync(new URL('../../legacy/source/DayBook.gs',import.meta.url),'utf8');
const expected=[
  ['sales','SALES'],['salesReturns','SALES_RETURN'],
  ['purchases','PURCHASES'],['purchaseReturns','PURCHASE_RETURN'],
  ['customerLedgerRows','CUSTOMER_LEDGER'],['supplierLedgerRows','SUPPLIER_LEDGER'],
  ['expenses','EXPENSES'],['financeTransactions','FINANCE_TRANSACTIONS'],
  ['bankTransfers','BANK_TRANSFERS'],['bankEntries','BANK_BOOK'],
  ['stockMovements','STOCK_MOVEMENT'],['cashBookRows','CASH_BOOK']
];
assert.match(original,/getAllRows_\('CUSTOMER_LEDGER'\)/);
assert.match(original,/getAllRows_\('SUPPLIER_LEDGER'\)/);
assert.match(original,/activeRows_\('CASH_BOOK'\)/);
assert.equal(new Set(expected.map(v=>v[0])).size,12);
assert.equal(new Set(expected.map(v=>v[1])).size,12);

const mod=await import('../../src/modules/m09-daybook-source-readiness-d1.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function reader(env){
  assert.equal(typeof mod?.createM09DayBookSourceReadinessReader,'function',
    'M09 authenticated real D1 Day Book source readiness reader not implemented');
  return mod.createM09DayBookSourceReadinessReader(env);
}
const server=createTestHarness({workers:[{configPath:'./wrangler.m09-daybook-authorized-test.jsonc'}]});
const worker=server.getWorker('shererp-m09-daybook-authorized-local');
const NOW=1_800_000_000_000;
const ADMIN='a'.repeat(64),VIEWER='b'.repeat(64),BLOCKED='c'.repeat(64),
  REVOKED='d'.repeat(64),OLD_ROLE='e'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const request=(token=ADMIN)=>({token,nowMs:NOW});
let DB;

async function seedSession(token,id,roleVersion){
  await DB.prepare('INSERT INTO auth_sessions '+
    '(token_hash,user_id,user_auth_version,role_auth_version,credential_version,'+
    'created_at_ms,last_activity_at_ms,expires_at_ms) VALUES (?,?,1,?,1,?,?,?)')
    .bind(digest(token),id,roleVersion,NOW-300000,NOW-60000,NOW+1200000).run();
}

before(async()=>{
  await server.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  for(const [role,permission] of [
    ['Clerk','{"daybook":{"view":true}}'],
    ['Blocked','{"daybook":{"view":false}}'],
    ['Revoker','{"daybook":{"view":true}}']
  ])await DB.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) "+
    "VALUES(?,'Active',?,'daybook')").bind(role,permission).run();
  for(const [id,role,phone] of [
    ['ADMIN','Administrator','01710000911'],
    ['VIEWER','Clerk','01710000912'],
    ['BLOCKED','Blocked','01710000913'],
    ['REVOKED','Revoker','01710000914'],
    ['OLDROLE','Revoker','01710000915']
  ])await DB.prepare('INSERT INTO auth_users '+
    '(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) '+
    "VALUES (?,?,?,?,'Active',?,?,210000)")
    .bind(id,id,phone,role,'a'.repeat(64),'b'.repeat(48)).run();
  for(const [token,id,v] of [
    [ADMIN,'ADMIN',null],[VIEWER,'VIEWER',1],[BLOCKED,'BLOCKED',1],
    [REVOKED,'REVOKED',1],[OLD_ROLE,'OLDROLE',1]
  ])await seedSession(token,id,v);
  await DB.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
    .bind(NOW-1000,digest(REVOKED)).run();
  // The old role/version cannot authorize even though the Role still grants view.
  await DB.prepare("UPDATE auth_roles SET auth_version=2 WHERE role_name='Revoker'").run();
});

after(async()=>server.close());

test('actual local Workerd/D1: Administrator sees twelve missing source groups, NEVER an empty-but-ready Day Book',async()=>{
  const result=await reader({DB}).inspect(request());
  assert.deepEqual(result,{
    ready:false,status:'MISSING_SOURCE_GROUPS',presentLegacyGroups:[],
    missingLegacyGroups:expected.map(x=>x[0])
  });
  assert.deepEqual(Object.keys(result),[
    'ready','status','presentLegacyGroups','missingLegacyGroups'
  ]);
  assert.doesNotMatch(JSON.stringify(result),/ADMIN|token|bank_account|password|Bearer|sourceId/);
});

test('current M04 view-permission Clerk gets the same read-only completeness diagnostic',async()=>{
  const result=await reader({DB}).inspect(request(VIEWER));
  assert.equal(result.ready,false);
  assert.equal(result.missingLegacyGroups.length,12);
  assert.equal(result.presentLegacyGroups.length,0);
});

test('denied permission, unknown/expired/revoked bearer or stale role version reveals no table inventory',async()=>{
  for(const token of [BLOCKED,REVOKED,OLD_ROLE,'f'.repeat(64)]){
    await assert.rejects(reader({DB}).inspect(request(token)),/denied|unavailable|invalid/i);
  }
  await assert.rejects(
    reader({DB}).inspect({token:VIEWER,nowMs:NOW+1200000}),
    /denied|unavailable|invalid/i
  );
  await DB.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='VIEWER'").run();
  await assert.rejects(reader({DB}).inspect(request(VIEWER)),/denied|unavailable/i);
  await DB.prepare("UPDATE auth_users SET status='Active' WHERE user_id='VIEWER'").run();
});

test('one or two same-name legacy tables in D1 do not supply the full Day Book snapshot',async()=>{
  for(const name of ['SALES','CASH_BOOK'])
    await DB.prepare('CREATE TABLE "'+name+'" (source_id TEXT PRIMARY KEY, qty INTEGER)').run();
  const result=await reader({DB}).inspect(request(ADMIN));
  assert.deepEqual(result.presentLegacyGroups,['sales','cashBookRows']);
  assert.deepEqual(result.missingLegacyGroups,expected
    .filter(x=>!['SALES','CASH_BOOK'].includes(x[1])).map(x=>x[0]));
  assert.equal(result.ready,false);
  assert.equal(result.status,'MISSING_SOURCE_GROUPS');
  const before=await DB.prepare('SELECT COUNT(*) AS n FROM SALES').first();
  assert.equal(before.n,0);
});

test('even twelve dummy physical table names never certify complete source rows or financial reconciliation',async()=>{
  for(const [,name] of expected.filter(([,name])=>!['SALES','CASH_BOOK'].includes(name)))
    await DB.prepare('CREATE TABLE "'+name+'" (source_id TEXT PRIMARY KEY)').run();
  const result=await reader({DB}).inspect(request(ADMIN));
  assert.deepEqual(result,{
    ready:false,status:'SOURCE_PROVENANCE_UNVERIFIED',
    presentLegacyGroups:expected.map(x=>x[0]),missingLegacyGroups:[]
  });
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM SALES').first()).n,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM CASH_BOOK').first()).n,0);
});

test('current role permission revocation denies without metadata even after successful read',async()=>{
  assert.equal((await reader({DB}).inspect(request(VIEWER))).ready,false);
  await DB.prepare("UPDATE auth_roles SET permissions_json='{\"daybook\":{\"view\":false}}' "+
    "WHERE role_name='Clerk'").run();
  await assert.rejects(reader({DB}).inspect(request(VIEWER)),/denied|unavailable/i);
});

test('malformed source inspection input, forged role, missing DB, unexpected getters and inherited request all fail',async()=>{
  const r=reader({DB});
  const hostile=[
    null,{},[],{token:ADMIN},{token:ADMIN,nowMs:NOW,role:'Administrator'},
    {token:'xyz',nowMs:NOW},{token:ADMIN,nowMs:Infinity},
    {token:ADMIN,nowMs:-1},{token:ADMIN,nowMs:'now'},
    Object.assign(Object.create({token:ADMIN}),{nowMs:NOW}),
    Object.defineProperty({token:ADMIN,nowMs:NOW},'token',{
      enumerable:true,get(){throw Error('hostile getter ran');}
    })
  ];
  for(const bad of hostile)
    await assert.rejects(r.inspect(bad),/invalid|denied|trusted|unavailable|accessor/i);
  assert.throws(()=>reader({}),/D1|binding|unavailable/i);
});

test('local test Worker and production Worker expose no readiness/transactions endpoint',async()=>{
  const preview=JSON.parse(readFileSync(
    new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(preview.d1_databases,undefined);
  const production=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(production.includes('m09-daybook-source-readiness-d1'),false);
  assert.match(production,/Object\.freeze\(Object\.create\(null\)\)/);
  for(const path of ['/daybook/source-readiness','/api/rpc','/__m09_test__/readiness']){
    const resp=await worker.fetch('http://daybook.local'+path,{method:'POST'});
    assert.equal(resp.status,404);
  }
  const result=await publicWorker.fetch(new Request('https://erp.invalid/api/rpc',{
    method:'POST',headers:{'Origin':'https://erp.invalid','Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getDayBookTransactions',args:[ADMIN]})
  }),{DB});
  assert.equal(result.status,501);
  assert.deepEqual(await result.json(),{
    success:false,message:'RPC method not migrated'
  });
});
