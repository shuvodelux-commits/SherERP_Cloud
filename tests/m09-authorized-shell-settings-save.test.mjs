import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';

const gas=readFileSync(new URL('../legacy/source/Settings.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const settingsHtml=readFileSync(new URL('../legacy/source/settings.html',import.meta.url),'utf8');
const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
const m02=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const m04=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');

function sourceFunction(source,name){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start);
  assert.ok(start>=0&&end>start,'Missing original '+name);
  return source.slice(start,end+2);
}
function sourceArray(name){
  const start=gas.indexOf('const '+name+' = ['),end=gas.indexOf('];',start);
  assert.ok(start>=0&&end>start,'Missing original '+name);
  return gas.slice(start,end+2);
}
const native=[
  ...['SETTINGS_EDITABLE_KEYS','SETTINGS_NUMERIC_KEYS','SETTINGS_BOOLEAN_KEYS'].map(sourceArray),
  ...['sanitizeInput_','isValidNonNegativeNumber_'].map(n=>sourceFunction(utils,n)),
  sourceFunction(gas,'updateSettings')
].join('\n');
const json=v=>JSON.parse(JSON.stringify(v));
function oracle(key,value){
  const writes=[];
  const vm={
    CONFIG:{LOCK_TIMEOUT_MS:30000},
    LockService:{getScriptLock:()=>({waitLock:()=>{},releaseLock:()=>{}})},
    requirePermission_:(token,module,permission)=>{
      assert.equal(token,'original-fixture');
      assert.equal(module,'settings');assert.equal(permission,'edit');
    },
    getAllRows_:name=>{throw Error('Unexpected bank read: '+name);},
    setSetting_:(name,val)=>writes.push({key:name,value:val}),
    ok_:data=>({success:true,data}),
    fail_:error=>({success:false,error}),logError_:()=>{}
  };
  const response=runInNewContext(
    native+'\nupdateSettings("original-fixture",{'+JSON.stringify(key)+':'+JSON.stringify(value)+'})',vm
  );
  return {response:json(response),writes:json(writes)};
}
const impl=await import('../src/modules/m09-authorized-shell-settings-save.js')
  .catch(e=>e.code==='ERR_MODULE_NOT_FOUND'?null:Promise.reject(e));
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const req=(patch={})=>({
  token:A,nowMs:NOW,key:'Shop Name',newValue:'  নতুন দোকান  ',
  expectedValue:'Original Shop',...patch
});
function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(m02);sqlite.exec(m04);
  for(const [key,value,row] of [
    ['Shop Name','Original Shop',2],['Currency Symbol','৳',3],
    ['Phone 1','01712345678',4],['Delete Confirmation Key','SENSITIVE',5]
  ])sqlite.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
    .run(key,value,row);
  for(const [role,permissions] of [
    ['Editor','{"settings":{"edit":true,"view":false}}'],
    ['Viewer','{"settings":{"view":true,"edit":false}}']
  ])sqlite.prepare("INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules) VALUES(?,'Active',?,'')").run(role,permissions);
  for(const [id,phone,role] of [
    ['ADMIN','01710000001','Administrator'],
    ['STAFF','01710000002','Editor'],
    ['VIEWER','01710000003','Viewer']
  ])sqlite.prepare("INSERT INTO auth_users(user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations) VALUES(?,?,?,?,'Active',?,?,210000)")
    .run(id,id,phone,role,'d'.repeat(64),'e'.repeat(48));
  for(const [token,user,epoch] of [
    [A,'ADMIN',null],[B,'STAFF',1],[C,'VIEWER',1]
  ])sqlite.prepare("INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,role_auth_version,credential_version,created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms) VALUES(?,?,1,?,1,?,?,?,NULL)")
    .run(digest(token),user,epoch,NOW-300_000,NOW-60_000,NOW+1_200_000);
  const sql=[];
  const DB={prepare(statement){
    sql.push(statement);
    const stmt=sqlite.prepare(statement);
    return {bind(...values){return {async first(){return stmt.get(...values)??null;}}}};
  }};
  return {sqlite,sql,DB,
    reader:()=>{
      assert.equal(typeof impl?.createM09AuthorizedShellSettingsSave,'function',
        'M09 authorized Shell Settings save adapter not implemented');
      return impl.createM09AuthorizedShellSettingsSave({DB});
    },
    records:()=>sqlite.prepare('SELECT row_id,legacy_sheet_row,key,value FROM settings ORDER BY row_id')
      .all().map(row=>({...row})),
    close:()=>sqlite.close()};
}

test('original Shop Name update returns source success only after SQL CAS commits the same sanitized value',async()=>{
  const x=fixture();try{
    const before=x.records();
    const original=oracle('Shop Name','  নতুন দোকান  ');
    assert.deepEqual(original,{response:{success:true,data:'Settings saved.'},
      writes:[{key:'Shop Name',value:'নতুন দোকান'}]});
    const result=await x.reader().saveOne(req());
    assert.deepEqual(result,original.response);
    assert.deepEqual(x.records()[0],{...before[0],value:original.writes[0].value});
    assert.deepEqual(x.records().slice(1),before.slice(1));
    assert.equal(x.sql.length,1);
    assert.match(x.sql[0],/UPDATE settings SET value=\?/);
    assert.match(x.sql[0],/auth_sessions/);
    assert.match(x.sql[0],/settings\.edit/);
    assert.match(x.sql[0],/RETURNING key,value/);
  }finally{x.close();}
});

test('source Unicode Currency Symbol normalization uses one reviewed M04 edit and leaves unrelated Settings untouched',async()=>{
  const x=fixture();try{
    const before=x.records();
    const nativeValue=oracle('Currency Symbol','  টাকা ');
    const result=await x.reader().saveOne(req({
      key:'Currency Symbol',newValue:'  টাকা ',expectedValue:'৳'
    }));
    assert.deepEqual(result,nativeValue.response);
    assert.equal(x.records()[1].value,nativeValue.writes[0].value);
    assert.deepEqual(x.records().filter(r=>r.key!=='Currency Symbol'),
      before.filter(r=>r.key!=='Currency Symbol'));
  }finally{x.close();}
});

test('blank Shop Name returns exact original validation rejection before preparing D1 SQL',async()=>{
  const x=fixture();try{
    const before=x.records();
    for(const value of ['','  ','\t']){
      const result=await x.reader().saveOne(req({newValue:value}));
      assert.deepEqual(result,oracle('Shop Name',value).response);
      assert.deepEqual(result,{success:false,error:'Shop Name is required.'});
      assert.equal(x.sql.length,0);
      assert.deepEqual(x.records(),before);
    }
  }finally{x.close();}
});

test('reviewed scope only: unsupported Settings fields and multi-key request cannot write SQL',async()=>{
  const x=fixture();try{
    for(const invalid of [
      req({key:'Phone 1',newValue:'0100000000'}),
      req({key:'Invoice Logo',newValue:'file-id'}),
      req({key:'Delete Confirmation Key',newValue:'WEAK'}),
      req({key:'__proto__',newValue:'evil'}),
      {...req(),extra:'unexpected'},
      {...req(),newValue:42},
      {...req(),expectedValue:null},
      {...req(),token:'bad'},
      {...req(),nowMs:Infinity},
      {get token(){throw Error('GETTER EXECUTED');},nowMs:NOW,key:'Shop Name',newValue:'Hi',expectedValue:'Original Shop'}
    ]){
      await assert.rejects(()=>x.reader().saveOne(invalid),/Invalid|trusted|request|key|accessor|unsupported/i);
    }
    assert.equal(x.sql.length,0);
    assert.equal(x.records()[0].value,'Original Shop');
    assert.equal(x.records()[2].value,'01712345678');
  }finally{x.close();}
});

test('view-only and unknown M04 token cannot save, even with a valid source preflight',async()=>{
  const x=fixture();try{
    const before=x.records();
    for(const token of [C,'f'.repeat(64)])
      await assert.rejects(()=>x.reader().saveOne(req({token})),/Denied|stale/i);
    assert.deepEqual(x.records(),before);
    assert.equal(x.sql.length,2,'each attempt is one authorization-guarded UPDATE');
  }finally{x.close();}
});

test('current edit-only role can save but a revoked, expired or stale epoch session cannot',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.reader().saveOne(req({
      token:B,newValue:'Editor Shop'
    })),{success:true,data:'Settings saved.'});
    assert.equal(x.records()[0].value,'Editor Shop');
    const before=x.records();
    for(const patch of [
      {token:B,expectedValue:'Editor Shop',nowMs:NOW+1_200_000},
      {token:B,expectedValue:'Editor Shop',nowMs:NOW+31*60_000}
    ])await assert.rejects(()=>x.reader().saveOne(req(patch)),/Denied|stale/i);
    x.sqlite.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
      .run('{"settings":{"edit":false}}','Editor');
    x.sqlite.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
      .run('{"settings":{"edit":true}}','Editor');
    await assert.rejects(()=>x.reader().saveOne(req({
      token:B,expectedValue:'Editor Shop'
    })),/Denied|stale/i);
    x.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(NOW-1,digest(A));
    await assert.rejects(()=>x.reader().saveOne(req({
      expectedValue:'Editor Shop'
    })),/Denied|stale/i);
    assert.deepEqual(x.records(),before);
  }finally{x.close();}
});

test('stale preimage, absent original key and concurrent two-admin attempts never claim saved',async()=>{
  const x=fixture();try{
    await assert.rejects(()=>x.reader().saveOne(req({
      expectedValue:'Stale Value'
    })),/Denied|stale/i);
    assert.equal(x.records()[0].value,'Original Shop');
    const results=await Promise.allSettled([
      x.reader().saveOne(req({newValue:'First Value'})),
      x.reader().saveOne(req({newValue:'Second Value'}))
    ]);
    assert.equal(results.filter(v=>v.status==='fulfilled').length,1);
    assert.equal(results.filter(v=>v.status==='rejected').length,1);
    const committed=results[0].status==='fulfilled'?'First Value':'Second Value';
    assert.equal(x.records()[0].value,committed);
    x.sqlite.exec("DELETE FROM settings WHERE key='Shop Name'");
    await assert.rejects(()=>x.reader().saveOne(req({
      expectedValue:committed,newValue:'Missing Key'
    })),/Denied|stale/i);
    assert.equal(x.sqlite.prepare("SELECT COUNT(*) AS n FROM settings WHERE key='Shop Name'").get().n,0);
  }finally{x.close();}
});

test('D1 unavailable or malformed outcome remains uncertain; no fake successful Settings save',async()=>{
  assert.equal(typeof impl?.createM09AuthorizedShellSettingsSave,'function',
    'M09 authorized Shell Settings save adapter not implemented');
  const broken=impl.createM09AuthorizedShellSettingsSave({
    DB:{prepare(){throw new Error('D1 offline');}}
  });
  await assert.rejects(()=>broken.saveOne(req()),/NEEDS_REVIEW/i);
  const wrong=impl.createM09AuthorizedShellSettingsSave({
    DB:{prepare(){return {bind(){return {first:async()=>({key:'Other',value:'FORGED'})}}}}}
  });
  await assert.rejects(()=>wrong.saveOne(req()),/NEEDS_REVIEW/i);
});

test('unmodified Settings HTML/RPC and original GAS are not wired to a public writer',async()=>{
  const x=fixture();try{
    assert.match(settingsHtml,/serverCall\('updateSettings', authToken, payload\)/);
    assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
    const source=readFileSync(new URL('../src/modules/m09-authorized-shell-settings-save.js',import.meta.url),'utf8');
    assert.doesNotMatch(source,/\b(?:UPDATE|INSERT|DELETE)\s+settings|\bfetch\s*\(|\bDriveApp\b/i);
    assert.doesNotMatch(source,/function\s+updateSettings\s*\(/);
    assert.equal(x.records().length,4);
  }finally{x.close();}
});
