import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';

const frozen=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const start=frozen.indexOf('function getDashboardStats(token)');
const end=frozen.indexOf('\n}',start);
assert.ok(start>0&&end>start,'frozen Dashboard source must be present');
const source=frozen.slice(start,end+2);
function oracle(settings){
  return runInNewContext(source+'\ngetDashboardStats("SOURCE")',{
    requirePermission_:(t,m,a)=>{
      assert.equal(t,'SOURCE');assert.equal(m,'dashboard');assert.equal(a,'view');
    },
    formatDate_:()=> '2026-11-15',
    activeRows_:()=>[],
    assertUniqueSalesInvoiceIds_:()=>{},
    dashboardTodayNetSales_:()=>0,
    dashboardTodayCollection_:()=>0,
    dashboardTodayExpense_:()=>0,
    dashboardTodayPurchase_:()=>0,
    financeBalanceSummary_:()=>({borrowerReceivable:0,outstandingLoan:0}),
    getSettingsMap_:()=>settings,
    getCashBalance_:()=>0,
    roundMoney_:value=>Number(value)||0,
    ok_:value=>value,
    fail_:message=>{throw new Error(String(message));},
    logError_:()=>{}
  }).currencySymbol;
}

const m02=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const m04=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');
const impl=await import('../src/modules/m09-authorized-dashboard-currency-read.js')
  .catch(error=>error.code==='ERR_MODULE_NOT_FOUND'?null:Promise.reject(error));
const A='a'.repeat(64), B='b'.repeat(64), C='c'.repeat(64);
const NOW=1_800_000_000_000;
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const request=(patch={})=>({token:A,nowMs:NOW,...patch});

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(m02);
  sqlite.exec(m04);
  for(const [key,value,index] of [
    ['Shop Name','নবাবী হার্ডওয়্যার',2],
    ['Currency Symbol','৳',3],
    ['Delete Confirmation Key','CONFIDENTIAL',4]
  ])sqlite.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
    .run(key,value,index);
  for(const [role,permissions] of [
    ['DashboardOnly','{"dashboard":{"view":true},"settings":{"view":false}}'],
    ['SettingsOnly','{"dashboard":{"view":false},"settings":{"view":true},"reports":{"view":true}}']
  ])sqlite.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES(?,'Active',?,'')")
    .run(role,permissions);
  for(const [id,phone,role] of [
    ['ADMIN','01710000001','Administrator'],
    ['DASH','01710000002','DashboardOnly'],
    ['SETTING','01710000003','SettingsOnly']
  ])sqlite.prepare(
    "INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,'Active',?,?,210000)"
  ).run(id,id,phone,role,'d'.repeat(64),'e'.repeat(48));
  for(const [token,user,epoch] of [[A,'ADMIN',null],[B,'DASH',1],[C,'SETTING',1]])
    sqlite.prepare(
      'INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) VALUES(?,?,1,?,1,?,?,?,NULL)'
    ).run(digest(token),user,epoch,NOW-300_000,NOW-60_000,NOW+1_200_000);
  const sql=[];
  const DB={prepare(query){
    sql.push(query);
    const stmt=sqlite.prepare(query);
    return {bind(...args){return {async all(){return {success:true,results:stmt.all(...args)};}};}};
  }};
  return {sqlite,sql,DB,reader(){
    assert.equal(typeof impl?.createM09AuthorizedDashboardCurrencyReader,'function',
      'M09 authorized Dashboard currency reader not implemented');
    return impl.createM09AuthorizedDashboardCurrencyReader({DB});
  },close(){sqlite.close();}};
}

test('native original Dashboard currency uses source empty and Unicode defaults',()=>{
  assert.equal(oracle({'Currency Symbol':'৳'}),'৳');
  assert.equal(oracle({'Currency Symbol':''}),'');
  assert.equal(oracle({}),'');
});

test('Administrator and dashboard.view-only role match frozen Dashboard source with one guarded SQL',async()=>{
  const x=fixture();try{
    const reader=x.reader();
    for(const token of [A,B]){
      assert.equal(await reader.getCurrencySymbol(request({token})),
        oracle({'Currency Symbol':'৳'}));
    }
    assert.equal(x.sql.length,2,'one statement per authorized read');
    for(const sql of x.sql){
      assert.match(sql,/FROM auth_sessions/i);
      assert.match(sql,/dashboard\.view/i);
      assert.match(sql,/Currency Symbol/i);
      assert.doesNotMatch(sql,/allowed_modules/i);
      assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE)\b/i);
    }
  }finally{x.close();}
});

test('settings.view and reports.view do not grant Dashboard access',async()=>{
  const x=fixture();try{
    await assert.rejects(()=>x.reader().getCurrencySymbol(request({token:C})),/Denied/i);
    assert.equal(x.sql.length,1);
  }finally{x.close();}
});

test('missing/empty currency follows original default and private Settings is not read',async()=>{
  const x=fixture();try{
    x.sqlite.exec("DELETE FROM settings WHERE key='Currency Symbol'");
    assert.equal(await x.reader().getCurrencySymbol(request({token:B})),oracle({}));
    x.sqlite.exec("INSERT INTO settings(key,value) VALUES('Currency Symbol','')");
    assert.equal(await x.reader().getCurrencySymbol(request()),'');
    assert.match(x.sql[0],/key\s*=\s*'Currency Symbol'/i);
    assert.doesNotMatch(x.sql[0],/Delete Confirmation Key|Shop Name/i);
    assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get().n,3);
  }finally{x.close();}
});

test('token, clock, forbidden actor, getters and extra fields fail before SQL',async()=>{
  const x=fixture();try{
    const reader=x.reader();
    for(const r of [
      null,undefined,{},[],
      request({token:'INVALID'}),request({token:'A'.repeat(64)}),
      request({nowMs:-1}),request({nowMs:NaN}),
      request({role:'Administrator'}),request({permission:'dashboard.view'}),
      Object.defineProperty({token:A},'nowMs',{get(){throw Error('NO GETTER');},enumerable:true})
    ])await assert.rejects(()=>reader.getCurrencySymbol(r),/invalid|trusted|request/i);
    assert.equal(x.sql.length,0);
  }finally{x.close();}
});

test('revoked, idle, expired, modified permission and stale epoch all deny',async()=>{
  const x=fixture();try{
    const read=x.reader();
    for(const r of [
      request({token:'f'.repeat(64)}),
      request({token:B,nowMs:NOW+31*60_000}),
      request({token:B,nowMs:NOW+1_200_000})
    ])await assert.rejects(()=>read.getCurrencySymbol(r),/Denied/i);
    x.sqlite.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
      .run('{"dashboard":{"view":false}}','DashboardOnly');
    await assert.rejects(()=>read.getCurrencySymbol(request({token:B})),/Denied/i);
    x.sqlite.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
      .run('{"dashboard":{"view":true}}','DashboardOnly');
    await assert.rejects(()=>read.getCurrencySymbol(request({token:B})),/Denied/i);
    x.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(NOW-1,digest(A));
    await assert.rejects(()=>read.getCurrencySymbol(request()),/Denied/i);
  }finally{x.close();}
});

test('malformed D1 responses fail closed and no public Worker RPC is added',async()=>{
  assert.match(readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8'),
    /Object\.freeze\(Object\.create\(null\)\)/);
  const x=fixture();try{
    const read=x.reader();
    assert.equal(await read.getCurrencySymbol(request()),'৳');
    const before=x.sqlite.prepare('SELECT key,value FROM settings ORDER BY row_id').all();
    assert.deepEqual(x.sqlite.prepare('SELECT key,value FROM settings ORDER BY row_id').all(),before);
  }finally{x.close();}
  for(const result of [
    {success:false,results:[]},
    {success:true,results:[{currency_symbol:999}]},
    {success:true,results:[{currency_symbol:'৳'},{currency_symbol:'৳'}]}
  ]){
    const DB={prepare(){return {bind(){return {all:async()=>result};}};}};
    assert.equal(typeof impl?.createM09AuthorizedDashboardCurrencyReader,'function');
    await assert.rejects(
      ()=>impl.createM09AuthorizedDashboardCurrencyReader({DB}).getCurrencySymbol(request()),
      /NEEDS_REVIEW|invalid|malformed/i
    );
  }
});
