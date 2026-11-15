import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';

const gas=readFileSync(new URL('../legacy/source/Settings.gs',import.meta.url),'utf8');
const a=gas.indexOf('function getInvoiceDesignBootstrap('),b=gas.indexOf('\n}',a);
assert.ok(a>=0&&b>a,'pinned Invoice Design original function');
const original=gas.slice(a,b+2);
const m02=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const m04=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');
const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const digest=t=>createHash('sha256').update(Buffer.from(t,'hex')).digest('hex');
const request=(p={})=>({token:A,nowMs:NOW,...p});
const oracle=settings=>clone(runInNewContext(original+'\ngetInvoiceDesignBootstrap("source-authorized")',{
  requirePermission_:(token,section,action)=>{
    assert.equal(token,'source-authorized');
    assert.equal(section,'settings');assert.equal(action,'view');
  },getSettingsMap_:()=>settings,resolveInvoiceLogoDataUri_:()=>'',ok_:v=>v,
  fail_:e=>{throw Error('Source rejected: '+e);},logError_:()=>{}
}));
const impl=await import('../src/modules/m09-invoice-design-authorized-d1-read.js')
  .catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?null:Promise.reject(e));

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(m02);sqlite.exec(m04);
  const input=[
    ['Shop Name','নবাবী হার্ডওয়্যার'],
    ['Currency Symbol','৳'],
    ['Phone 1','01712345678'],
    ['Delete Confirmation Key','PRIVATE-SETTINGS-SECRET'],
    ['Invoice Show Signature','true'],
    ['Invoice Logo','']
  ];
  for(let i=0;i<input.length;i++)sqlite.prepare(
    'INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)'
  ).run(...input[i],i+2);
  for(const [role,permissions] of [
    ['Viewer','{"settings":{"view":true,"edit":false}}'],
    ['Editor','{"settings":{"view":false,"edit":true}}']
  ])sqlite.prepare(
    "INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES(?,'Active',?,'')"
  ).run(role,permissions);
  for(const [id,phone,role] of [
    ['ADMIN','01710000001','Administrator'],
    ['VIEWER','01710000002','Viewer'],
    ['EDITOR','01710000003','Editor']
  ])sqlite.prepare(
    "INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,'Active',?,?,210000)"
  ).run(id,id,phone,role,'d'.repeat(64),'e'.repeat(48));
  for(const [token,user,epoch] of [
    [A,'ADMIN',null],[B,'VIEWER',1],[C,'EDITOR',1]
  ])sqlite.prepare(
    "INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) VALUES(?,?,1,?,1,?,?,?,NULL)"
  ).run(digest(token),user,epoch,NOW-300_000,NOW-60_000,NOW+1_200_000);
  const sql=[];
  const DB={prepare(query){
    sql.push(query);
    const stmt=sqlite.prepare(query);
    return {bind(...args){return {async all(){
      return {success:true,results:stmt.all(...args)};
    }}}};
  }};
  return {
    sqlite,sql,DB,
    settings:()=>Object.fromEntries(sqlite.prepare(
      'SELECT key,value FROM settings ORDER BY row_id').all().map(x=>[x.key,x.value])),
    reader:()=>{
      assert.equal(typeof impl?.createM09AuthorizedInvoiceDesignD1Reader,'function',
        'M09 authorized Invoice Design D1 reader not implemented');
      return impl.createM09AuthorizedInvoiceDesignD1Reader({DB});
    },
    close:()=>sqlite.close()
  };
}

test('real SQLite Administrator returns complete native Invoice Design payload for empty logo ID',async()=>{
  const x=fixture();try{
    const out=await x.reader().getBootstrap(request());
    assert.deepEqual(out,oracle(x.settings()));
    assert.deepEqual(Object.keys(out),['settings','logoDataUri']);
    assert.equal(out.settings['Shop Name'],'নবাবী হার্ডওয়্যার');
    assert.equal(out.settings['Currency Symbol'],'৳');
    assert.equal(out.logoDataUri,'');
  }finally{x.close();}
});

test('view-only role gets original full Settings through one authorized D1 SQL statement',async()=>{
  const x=fixture();try{
    const out=await x.reader().getBootstrap(request({token:B}));
    assert.deepEqual(out,oracle(x.settings()));
    assert.equal(out.settings['Phone 1'],'01712345678');
    assert.equal(out.settings['Delete Confirmation Key'],'PRIVATE-SETTINGS-SECRET');
    assert.equal(x.sql.length,1);
    assert.match(x.sql[0],/FROM auth_sessions/);
    assert.match(x.sql[0],/settings\.view/);
    assert.match(x.sql[0],/LEFT JOIN settings/);
    assert.doesNotMatch(x.sql[0],/\b(?:UPDATE|DELETE|INSERT)\s+settings/i);
  }finally{x.close();}
});

test('nonempty legacy Drive Invoice Logo stops bootstrap and does not leak ID',async()=>{
  const x=fixture();try{
    x.sqlite.prepare("UPDATE settings SET value='OLD-PRIVATE-DRIVE-ID' WHERE key='Invoice Logo'").run();
    let error;
    try{await x.reader().getBootstrap(request());}catch(e){error=e;}
    assert.ok(error,'A real legacy logo must not be silently lost');
    assert.match(error.message,/NEEDS_REVIEW|logo migration/i);
    assert.doesNotMatch(error.message,/OLD-PRIVATE-DRIVE-ID/);
    assert.equal(x.sqlite.prepare("SELECT value FROM settings WHERE key='Invoice Logo'").get().value,
      'OLD-PRIVATE-DRIVE-ID');
  }finally{x.close();}
});

test('empty authorized Settings remains empty, never silently replaced with shop defaults',async()=>{
  const x=fixture();try{
    x.sqlite.exec('DELETE FROM settings');
    assert.deepEqual(await x.reader().getBootstrap(request({token:B})),{
      settings:{},logoDataUri:''
    });
    assert.equal(x.sql.length,1);
  }finally{x.close();}
});

test('edit-only, unknown, expired, idle-expired and revoked M04 sessions are denied',async()=>{
  const x=fixture();try{
    const read=x.reader();
    for(const req of [
      request({token:C}),request({token:'f'.repeat(64)}),
      request({token:B,nowMs:NOW+1_200_000}),
      request({token:B,nowMs:NOW+31*60_000})
    ])await assert.rejects(()=>read.getBootstrap(req),/Denied/i);
    x.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(NOW-1,digest(B));
    await assert.rejects(()=>read.getBootstrap(request({token:B})),/Denied/i);
  }finally{x.close();}
});

test('role version revocation cannot be reversed by restoring grant on old session',async()=>{
  const x=fixture();try{
    const update=x.sqlite.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?');
    update.run('{"settings":{"view":false}}','Viewer');
    update.run('{"settings":{"view":true}}','Viewer');
    await assert.rejects(()=>x.reader().getBootstrap(request({token:B})),/Denied/i);
  }finally{x.close();}
});

test('invalid token/clock input fails before authorized SQL and never invokes an unsafe field',async()=>{
  const x=fixture();try{
    const reader=x.reader();
    for(const req of [null,undefined,{},[],{token:A,nowMs:NaN},
      {token:A,nowMs:NOW,actor:'Administrator'},
      {token:'bad',nowMs:NOW},{token:A,nowMs:-1}
    ])await assert.rejects(()=>reader.getBootstrap(req),/Invalid|Denied/i);
    assert.equal(x.sql.length,0);
  }finally{x.close();}
});

test('internal reader does not expose RPC, mutate D1, or fabricate an Invoice logo',async()=>{
  const x=fixture();try{
    const before=clone(x.settings());
    const result=await x.reader().getBootstrap(request());
    result.settings['Shop Name']='TAMPER';
    assert.deepEqual(clone(x.settings()),before);
    assert.deepEqual(await x.reader().getBootstrap(request()),oracle(before));
    assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
    const code=readFileSync(new URL('../src/modules/m09-invoice-design-authorized-d1-read.js',import.meta.url),'utf8');
    assert.doesNotMatch(code,/\b(?:INSERT|UPDATE|DELETE)\b|\bfetch\s*\(|\bDriveApp\b/);
    assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get().n,6);
  }finally{x.close();}
});
