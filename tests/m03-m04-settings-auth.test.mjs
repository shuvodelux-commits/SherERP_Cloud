import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AUTH_POLICY} from '../src/auth/d1-auth-core.js';
import {createM04AuthorizedShellSettingsUpdateAdapter}
  from '../src/db/m04-settings-update.js';

const AUTH=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');
const CATALOG=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const digest=token=>createHash('sha256').update(Buffer.from(token,'hex')).digest('hex');
const call=(changes={})=>({
  token:A,nowMs:NOW,key:'Shop Name',
  newValue:'Updated Shop',expectedValue:'Original Shop',
  ...changes
});

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(CATALOG);
  sqlite.exec(AUTH);
  sqlite.exec(`INSERT INTO settings(key,value,legacy_sheet_row)
    VALUES('Shop Name','Original Shop',2),
          ('Currency Symbol','৳',3),
          ('Delete Confirmation Key','TOP_SECRET',4),
          ('Phone 1','01712345678',5)`);
  sqlite.prepare(`INSERT INTO auth_roles(role_name,status,permissions_json,allowed_modules)
    VALUES('Cashier','Active','{"settings":{"edit":true}}','')`).run();
  for(const [id,phone,role] of [
    ['ADMIN-A','01710000001','Administrator'],
    ['ADMIN-B','01710000002','Administrator'],
    ['STAFF-C','01710000003','Cashier']
  ]){
    sqlite.prepare(`INSERT INTO auth_users(user_id,full_name,phone_key,role_name,
      status,password_hash,password_salt,password_iterations)
      VALUES(?,?,?,?,'Active',?,?,210000)`)
      .run(id,'Synthetic '+id,phone,role,'d'.repeat(64),'e'.repeat(48));
  }
  for(const [token,user,roleVersion] of [
    [A,'ADMIN-A',null],[B,'ADMIN-B',null],[C,'STAFF-C',1]
  ]){
    sqlite.prepare(`INSERT INTO auth_sessions(
      token_hash,user_id,user_auth_version,role_auth_version,credential_version,
      created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)
      VALUES(?,?,1,?,1,?,?,?,NULL)`).run(
      digest(token),user,roleVersion,NOW-300_000,NOW-60_000,NOW+3_600_000);
  }
  const prepared=[];
  const DB={prepare(sql){
    prepared.push(sql);
    const stmt=sqlite.prepare(sql);
    return {bind(...args){return {
      async first(){return stmt.get(...args)??null;}
    }}};
  }};
  return {
    sqlite,DB,sqls:prepared,adapter:createM04AuthorizedShellSettingsUpdateAdapter({DB}),
    close:()=>sqlite.close()
  };
}
const records=x=>x.sqlite.prepare(
  'SELECT row_id,legacy_sheet_row,key,value FROM settings ORDER BY row_id'
).all().map(r=>({...r}));

test('M04 Administrator session authorizes one CAS UPDATE, no separate JS permission read',async()=>{
  const x=fixture();try{
    const before=records(x);
    assert.deepEqual(await x.adapter.updateExisting_(call({
      newValue:'  নবাবী হার্ডওয়্যার  '
    })),{updated:true});
    const after=records(x);
    assert.deepEqual(after[0],{...before[0],value:'নবাবী হার্ডওয়্যার'});
    assert.deepEqual(after.slice(1),before.slice(1));
    assert.equal(x.sqls.length,1,'one guarded UPDATE, no separate authorization SELECT');
    assert.match(x.sqls[0],/UPDATE settings SET value=\?/);
    assert.match(x.sqls[0],/auth_sessions/);
    assert.match(x.sqls[0],/auth_users/);
    assert.match(x.sqls[0],/user_auth_version/);
    assert.match(x.sqls[0],/credential_version/);
    assert.match(x.sqls[0],/Administrator/);
    assert.match(x.sqls[0],/RETURNING key,value/);
  }finally{x.close();}
});

test('active custom role with literal settings.edit true can CAS an existing row inside the same SQL guard',async()=>{
  const x=fixture();try{
    const before=records(x);
    // Role metadata is empty from seed: changing it after login would invalidate the M04 session epoch.
    assert.deepEqual(await x.adapter.updateExisting_(call({
      token:C,newValue:'  Role-authorized shop  '
    })),{updated:true});
    const after=records(x);
    assert.deepEqual(after[0],{...before[0],value:'Role-authorized shop'});
    assert.deepEqual(after.slice(1),before.slice(1));
    assert.equal(x.sqls.length,1,'no preflight role SELECT before Settings mutation');
    assert.match(x.sqls[0],/auth_roles/);
    assert.match(x.sqls[0],/role_auth_version/);
    assert.match(x.sqls[0],/json_type/);
  }finally{x.close();}
});

test('custom role must have active status and current role auth_version',async()=>{
  for(const change of [
    "UPDATE auth_roles SET status='Inactive' WHERE role_name='Cashier'",
    "UPDATE auth_roles SET permissions_json='{\"settings\":{\"edit\":false}}' WHERE role_name='Cashier'",
    "UPDATE auth_roles SET permissions_json='{\"settings\":{\"edit\":false}}' WHERE role_name='Cashier'; UPDATE auth_roles SET permissions_json='{\"settings\":{\"edit\":true}}' WHERE role_name='Cashier'"
  ]){
    const x=fixture();try{
      const before=records(x);
      x.sqlite.exec(change);
      await assert.rejects(()=>x.adapter.updateExisting_(call({token:C})),/Denied|stale|conflict/i);
      assert.deepEqual(records(x),before);
    }finally{x.close();}
  }
});

test('role permission downgrade then restore cannot resurrect old custom-role session',async()=>{
  const x=fixture();try{
    x.sqlite.exec(`UPDATE auth_roles SET permissions_json='{"settings":{"edit":false}}' WHERE role_name='Cashier'`);
    x.sqlite.exec(`UPDATE auth_roles SET permissions_json='{"settings":{"edit":true}}' WHERE role_name='Cashier'`);
    await assert.rejects(()=>x.adapter.updateExisting_(call({token:C})),/Denied|stale|conflict/i);
    const newEpoch=x.sqlite.prepare("SELECT auth_version FROM auth_roles WHERE role_name='Cashier'").get().auth_version;
    // A new M04 session with the current role epoch can now be authorized.
    x.sqlite.prepare(`INSERT INTO auth_sessions(token_hash,user_id,user_auth_version,
      role_auth_version,credential_version,created_at_ms,last_activity_at_ms,
      expires_at_ms,revoked_at_ms) VALUES (?,?,1,?,1,?,?,?,NULL)`)
      .run(digest('e'.repeat(64)),'STAFF-C',newEpoch,NOW-1000,NOW-1000,NOW+60000);
    assert.deepEqual(await x.adapter.updateExisting_(call({
      token:'e'.repeat(64),newValue:'Fresh role session'
    })),{updated:true});
  }finally{x.close();}
});

test('malformed, absent and truthy-but-not-boolean Settings grants never authorize a role',async()=>{
  const malformed=[
    '{bad json',
    '[]','null',
    '{"settings":{"view":true}}',
    '{"settings":{"edit":false}}',
    '{"settings":{"edit":1}}',
    '{"settings":{"edit":"true"}}',
    '{"settings":{"edit":[]}}',
    '{"settings":"true"}'
  ];
  for(const permissions of malformed){
    const x=fixture();try{
      const before=records(x);
      x.sqlite.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='Cashier'")
        .run(permissions);
      const roleVersion=x.sqlite.prepare("SELECT auth_version FROM auth_roles WHERE role_name='Cashier'").get().auth_version;
      // Deliberately simulate a fresh matching role epoch, isolating JSON validation.
      x.sqlite.prepare("UPDATE auth_sessions SET role_auth_version=? WHERE token_hash=?")
        .run(roleVersion,digest(C));
      await assert.rejects(()=>x.adapter.updateExisting_(call({token:C})),/Denied|stale|conflict/i,permissions);
      assert.deepEqual(records(x),before);
    }finally{x.close();}
  }
});

test('a valid custom role cannot bypass expired, revoked or stale preimage boundaries',async()=>{
  for(const patch of [
    {nowMs:NOW+AUTH_POLICY.sessionIdleMs-60_000},
    {nowMs:NOW+3_600_000},
    {expectedValue:'Different'}
  ]){
    const x=fixture();try{
      const before=records(x);
      await assert.rejects(()=>x.adapter.updateExisting_(call({token:C,...patch})),/Denied|stale|conflict/i);
      assert.deepEqual(records(x),before);
    }finally{x.close();}
  }
  const x=fixture();try{
    x.sqlite.prepare("UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?")
      .run(NOW-1,digest(C));
    await assert.rejects(()=>x.adapter.updateExisting_(call({token:C})),/Denied|stale|conflict/i);
    assert.equal(records(x)[0].value,'Original Shop');
  }finally{x.close();}
});

test('custom-role and Administrator concurrent CAS claims cannot both replace one preimage',async()=>{
  const x=fixture();try{
    const result=await Promise.allSettled([
      x.adapter.updateExisting_(call({token:C,newValue:'Staff'})),
      x.adapter.updateExisting_(call({token:A,newValue:'Administrator'}))
    ]);
    assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(result.filter(r=>r.status==='rejected').length,1);
    assert.equal(records(x)[0].value,result[0].status==='fulfilled'?'Staff':'Administrator');
  }finally{x.close();}
});

test('different Administrator session may edit with valid preimage but cannot bypass stale CAS',async()=>{
  const x=fixture();try{
    await x.adapter.updateExisting_(call({token:B,newValue:'Admin B'}));
    await assert.rejects(()=>x.adapter.updateExisting_(call({
      token:A,newValue:'Stale Admin A'
    })),/Denied|stale|conflict/i);
    assert.equal(records(x)[0].value,'Admin B');
  }finally{x.close();}
});

test('invalid digest, revoked token, expiration and inactivity cannot mutate even matching values',async()=>{
  const changes=[
    {token:'f'.repeat(64)},
    {nowMs:NOW+AUTH_POLICY.sessionIdleMs-60_000},
    {nowMs:NOW+3_600_000},
    {nowMs:NOW-301_000}
  ];
  for(const patch of changes){
    const x=fixture();try{
      const before=records(x);
      await assert.rejects(()=>x.adapter.updateExisting_(call(patch)),/Denied|stale|conflict/i);
      assert.deepEqual(records(x),before);
    }finally{x.close();}
  }
  const x=fixture();try{
    x.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(NOW-100,digest(A));
    const before=records(x);
    await assert.rejects(()=>x.adapter.updateExisting_(call()),/Denied|stale|conflict/i);
    assert.deepEqual(records(x),before);
  }finally{x.close();}
});

test('user disable/re-enable, credential reset and role change invalidate old sessions',async()=>{
  const cases=[
    ["UPDATE auth_users SET status='Inactive' WHERE user_id='ADMIN-A'"],
    ["UPDATE auth_users SET status='Inactive' WHERE user_id='ADMIN-A'",
     "UPDATE auth_users SET status='Active' WHERE user_id='ADMIN-A'"],
    ["UPDATE auth_users SET credential_version=credential_version+1 WHERE user_id='ADMIN-A'"],
    ["UPDATE auth_users SET role_name='Cashier' WHERE user_id='ADMIN-A'"],
    ["UPDATE auth_users SET role_name='Cashier' WHERE user_id='ADMIN-A'",
     "UPDATE auth_users SET role_name='Administrator' WHERE user_id='ADMIN-A'"]
  ];
  for(const statements of cases){
    const x=fixture();try{
      for(const sql of statements)x.sqlite.exec(sql);
      const before=records(x);
      await assert.rejects(()=>x.adapter.updateExisting_(call()),/Denied|stale|conflict/i);
      assert.deepEqual(records(x),before);
    }finally{x.close();}
  }
});

test('existing Settings preimage enforced in same SQL statement, with no UPSERT',async()=>{
  const x=fixture();try{
    await x.adapter.updateExisting_(call({newValue:'Newer'}));
    const before=records(x);
    await assert.rejects(()=>x.adapter.updateExisting_(call({
      newValue:'Stale write'
    })),/Denied|stale|conflict/i);
    await assert.rejects(()=>x.adapter.updateExisting_(call({
      key:'Nonexistent',newValue:'x',expectedValue:''
    })),/Invalid|unsupported/i);
    assert.deepEqual(records(x),before);
  }finally{x.close();}
});

test('concurrent valid Administrators with same preimage commit at most one write',async()=>{
  const x=fixture();try{
    const results=await Promise.allSettled([
      x.adapter.updateExisting_(call({token:A,newValue:'First'})),
      x.adapter.updateExisting_(call({token:B,newValue:'Second'}))
    ]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    assert.equal(records(x)[0].value,results[0].status==='fulfilled'?'First':'Second');
  }finally{x.close();}
});

test('private keys, forged actor and accessor payloads fail before preparing SQL',async()=>{
  const x=fixture();try{
    const invalid=[
      null,[],{},call({token:'bad'}),call({nowMs:'1800000000000'}),
      call({nowMs:-1}),call({newValue:15}),call({newValue:'   '}),
      call({expectedValue:null}),call({key:'Phone 1'}),
      call({key:'Delete Confirmation Key'}),call({key:'__proto__'}),
      {...call(),actorId:'ADMIN-A'}, {...call(),role:'Administrator'},
      {...call(),sql:'DROP TABLE settings'}
    ];
    const getter=call();
    Object.defineProperty(getter,'token',{enumerable:true,get(){throw Error('malicious getter')}});
    invalid.push(getter);
    for(const input of invalid){
      await assert.rejects(()=>x.adapter.updateExisting_(input),/Invalid|unsupported|required/i);
    }
    assert.equal(x.sqls.length,0);
    assert.equal(records(x)[2].value,'TOP_SECRET');
  }finally{x.close();}
});

test('valid Currency Symbol clearing and same-value update preserve source row identity',async()=>{
  const x=fixture();try{
    const before=records(x);
    assert.deepEqual(await x.adapter.updateExisting_(call({
      key:'Currency Symbol',newValue:' ',expectedValue:'৳'
    })),{updated:true});
    assert.deepEqual(await x.adapter.updateExisting_(call({
      key:'Shop Name',newValue:' Original Shop ',expectedValue:'Original Shop'
    })),{updated:true});
    const after=records(x);
    assert.deepEqual(after[0],before[0]);
    assert.deepEqual(after[1],{...before[1],value:''});
    assert.deepEqual(after.slice(2),before.slice(2));
  }finally{x.close();}
});

test('missing D1, malformed return and uncertain DB errors never report success',async()=>{
  assert.throws(()=>createM04AuthorizedShellSettingsUpdateAdapter({}),/D1|binding/i);
  for(const fake of [undefined,{},[],{key:'Other',value:'Updated Shop'},
    {key:'Shop Name',value:'wrong'}]){
    const DB={prepare(){return {bind(){return {first:async()=>fake}}}}};
    await assert.rejects(()=>createM04AuthorizedShellSettingsUpdateAdapter({DB})
      .updateExisting_(call()),/NEEDS_REVIEW/i);
  }
  const DB={prepare(){throw Error('D1 uncertain')}};
  await assert.rejects(()=>createM04AuthorizedShellSettingsUpdateAdapter({DB})
    .updateExisting_(call()),/NEEDS_REVIEW/i);
});

test('unauthorized and stale updates have indistinguishable refusal text',async()=>{
  const x=fixture();try{
    let unauthorized,stale;
    try{await x.adapter.updateExisting_(call({token:'f'.repeat(64)}));}catch(e){unauthorized=e.message;}
    try{await x.adapter.updateExisting_(call({expectedValue:'Wrong'}));}catch(e){stale=e.message;}
    assert.equal(unauthorized,stale);
    assert.equal(records(x)[0].value,'Original Shop');
  }finally{x.close();}
});
