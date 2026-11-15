import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {AUTH_POLICY} from '../src/auth/d1-auth-core.js';
import {createM04AuthorizedShellSettingsReadAdapter}
  from '../src/db/m04-settings-view.js';

const M02=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const M04=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');
const NOW=1_800_000_000_000;
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64),D='d'.repeat(64),E='e'.repeat(64);
const digest=raw=>createHash('sha256').update(Buffer.from(raw,'hex')).digest('hex');
const req=(patch={})=>({token:A,nowMs:NOW,...patch});

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(M02);
  sqlite.exec(M04);
  for(const [key,value,legacyRow] of [
    ['Shop Name','নবাবী হার্ডওয়্যার',2],
    ['Currency Symbol','৳',3],
    ['Phone 1','01712345678',4],
    ['Delete Confirmation Key','PRIVATE',5],
    ['Invoice Logo','data:image/png;base64,SECRET',6]
  ])sqlite.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)')
    .run(key,value,legacyRow);
  for(const [name,status,permissions] of [
    ['Viewer','Active','{"settings":{"view":true,"edit":false}}'],
    ['Editor','Active','{"settings":{"view":false,"edit":true}}'],
    ['Inactive','Inactive','{"settings":{"view":true}}']
  ])sqlite.prepare(`INSERT INTO auth_roles
    (role_name,status,permissions_json,allowed_modules) VALUES (?,?,?,'')`)
    .run(name,status,permissions);
  for(const [user,phone,role] of [
    ['USR-A','01710000001','Administrator'],
    ['USR-B','01710000002','Viewer'],
    ['USR-C','01710000003','Editor'],
    ['USR-D','01710000004','Inactive']
  ])sqlite.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,'Active',?,?,210000)`)
    .run(user,user,phone,role,'d'.repeat(64),'e'.repeat(48));
  for(const [token,user,version] of [
    [A,'USR-A',null],[B,'USR-B',1],[C,'USR-C',1],[D,'USR-D',1]
  ])sqlite.prepare(`INSERT INTO auth_sessions
    (token_hash,user_id,user_auth_version,role_auth_version,credential_version,
     created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)
    VALUES (?,?,1,?,1,?,?,?,NULL)`).run(
      digest(token),user,version,NOW-300_000,NOW-60_000,NOW+1_200_000
    );
  const sql=[];
  const DB={prepare(statement){
    sql.push(statement);
    const query=sqlite.prepare(statement);
    return {bind(...args){return {async all(){
      return {success:true,results:query.all(...args)};
    }}}};
  }};
  return {sqlite,sql,read:createM04AuthorizedShellSettingsReadAdapter({DB}),
    close:()=>sqlite.close()};
}

test('M04 Administrator reads exactly the two source-shaped shell keys in one authorized D1 SELECT',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.read.getAppShellSettings_(req()),{
      shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'
    });
    assert.equal(x.sql.length,1);
    assert.match(x.sql[0],/FROM auth_sessions/);
    assert.match(x.sql[0],/auth_roles/);
    assert.match(x.sql[0],/settings\.view/);
    assert.match(x.sql[0],/Shop Name/);
    assert.match(x.sql[0],/Currency Symbol/);
    assert.doesNotMatch(x.sql[0],/Phone 1|Delete Confirmation Key|Invoice Logo/);
    assert.doesNotMatch(x.sql[0],/UPDATE |INSERT |DELETE /);
  }finally{x.close();}
});

test('view-only active custom role reads even if edit=false and Allowed Modules is empty',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.read.getAppShellSettings_(req({token:B})),{
      shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'
    });
  }finally{x.close();}
});

test('edit-only role cannot read, inactive role cannot read, unknown token cannot enumerate Settings',async()=>{
  const x=fixture();try{
    for(const token of [C,D,'f'.repeat(64)]){
      await assert.rejects(()=>x.read.getAppShellSettings_(req({token})),/Denied/i);
    }
    assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get().n,5);
  }finally{x.close();}
});

test('authorization absence and empty Settings row set stay distinguishable only to authorized session',async()=>{
  const x=fixture();try{
    x.sqlite.exec('DELETE FROM settings');
    assert.deepEqual(await x.read.getAppShellSettings_(req()),{
      shopName:'Hardware Store ERP',currencySymbol:''
    });
    await assert.rejects(()=>x.read.getAppShellSettings_(req({token:C})),/Denied/i);
    x.sqlite.exec("INSERT INTO settings(key,value) VALUES('Shop Name','   ')");
    assert.deepEqual(await x.read.getAppShellSettings_(req()),{
      shopName:'   ',currencySymbol:''
    });
  }finally{x.close();}
});

test('current valid grant but expired, idle-expired or revoked session cannot read',async()=>{
  const x=fixture();try{
    for(const nowMs of [
      NOW+AUTH_POLICY.sessionIdleMs-60_000,
      NOW+1_200_000,
      NOW-300_001
    ]){
      await assert.rejects(()=>x.read.getAppShellSettings_(req({token:B,nowMs})),/Denied/i);
    }
    x.sqlite.prepare('UPDATE auth_sessions SET revoked_at_ms=? WHERE token_hash=?')
      .run(NOW-1,digest(B));
    await assert.rejects(()=>x.read.getAppShellSettings_(req({token:B})),/Denied/i);
  }finally{x.close();}
});

test('role permission change bumps epoch: restoring view never resurrects old session',async()=>{
  const x=fixture();try{
    x.sqlite.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
      .run('{"settings":{"view":false}}','Viewer');
    await assert.rejects(()=>x.read.getAppShellSettings_(req({token:B})),/Denied/i);
    x.sqlite.prepare('UPDATE auth_roles SET permissions_json=? WHERE role_name=?')
      .run('{"settings":{"view":true}}','Viewer');
    await assert.rejects(()=>x.read.getAppShellSettings_(req({token:B})),/Denied/i);
    const version=x.sqlite.prepare("SELECT auth_version FROM auth_roles WHERE role_name='Viewer'")
      .get().auth_version;
    x.sqlite.prepare(`INSERT INTO auth_sessions
      (token_hash,user_id,user_auth_version,role_auth_version,credential_version,
       created_at_ms,last_activity_at_ms,expires_at_ms,revoked_at_ms)
      VALUES (?,'USR-B',1,?,1,?,?,?,NULL)`).run(
        digest(E),version,NOW-1000,NOW-1000,NOW+50000
      );
    assert.deepEqual(await x.read.getAppShellSettings_(req({token:E})),{
      shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'
    });
    x.sqlite.exec("UPDATE auth_roles SET status='Inactive' WHERE role_name='Viewer'");
    await assert.rejects(()=>x.read.getAppShellSettings_(req({token:E})),/Denied/i);
  }finally{x.close();}
});

test('malformed and typed-but-not-boolean role grants fail closed even with matching epoch',async()=>{
  for(const permissions of [
    'invalid','null','[]','{"settings":{"edit":true}}',
    '{"settings":{"view":1}}','{"settings":{"view":"true"}}',
    '{"settings":{"view":[]}}','{"settings":"yes"}'
  ]){
    const x=fixture();try{
      x.sqlite.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='Viewer'")
        .run(permissions);
      const epoch=x.sqlite.prepare("SELECT auth_version FROM auth_roles WHERE role_name='Viewer'")
        .get().auth_version;
      x.sqlite.prepare('UPDATE auth_sessions SET role_auth_version=? WHERE token_hash=?')
        .run(epoch,digest(B));
      await assert.rejects(()=>x.read.getAppShellSettings_(req({token:B})),/Denied/i,
        permissions);
    }finally{x.close();}
  }
});

test('inactive user, credential epoch, role reassignment and user epoch prevent reads',async()=>{
  for(const sql of [
    "UPDATE auth_users SET status='Inactive' WHERE user_id='USR-B'",
    "UPDATE auth_users SET status='Inactive' WHERE user_id='USR-B'; UPDATE auth_users SET status='Active' WHERE user_id='USR-B'",
    "UPDATE auth_users SET credential_version=credential_version+1 WHERE user_id='USR-B'",
    "UPDATE auth_users SET role_name='Editor' WHERE user_id='USR-B'"
  ]){
    const x=fixture();try{
      x.sqlite.exec(sql);
      await assert.rejects(()=>x.read.getAppShellSettings_(req({token:B})),/Denied/i);
    }finally{x.close();}
  }
});

test('strict two-field request refuses forged roles, accessors and invalid token before D1',async()=>{
  const x=fixture();try{
    const requests=[null,[],{},req({token:'bad'}),req({nowMs:-1}),req({nowMs:'1800000000000'}),
      {...req(),actorId:'USR-A'}, {...req(),role:'Administrator'},
      {...req(),key:'Delete Confirmation Key'}, {...req(),sql:'SELECT * FROM settings'}];
    const accessor=req();Object.defineProperty(accessor,'token',{
      enumerable:true,get(){throw Error('UNSAFE GETTER');}
    });requests.push(accessor);
    for(const candidate of requests)
      await assert.rejects(()=>x.read.getAppShellSettings_(candidate),/Invalid/i);
    assert.equal(x.sql.length,0);
  }finally{x.close();}
});

test('unavailable or malformed D1 results never disclose sensitive Settings',async()=>{
  assert.throws(()=>createM04AuthorizedShellSettingsReadAdapter({}),/D1|binding/i);
  for(const result of [
    null,{}, {success:false,results:[]}, {success:true,results:null},
    {success:true,results:[{key:'Phone 1',value:'PRIVATE'}]},
    {success:true,results:[{key:'Shop Name',value:5}]},
    {success:true,results:[{key:'Shop Name',value:'A'},{key:'Shop Name',value:'B'}]},
    {success:true,results:[{key:null,value:'PRIVATE'}]},
    {success:true,results:[{key:null,value:null},{key:'Shop Name',value:'A'}]}
  ]){
    const DB={prepare(){return {bind(){return {all:async()=>result}}}}};
    await assert.rejects(()=>createM04AuthorizedShellSettingsReadAdapter({DB})
      .getAppShellSettings_(req()),/NEEDS_REVIEW/i);
  }
  const DB={prepare(){throw Error('Connection lost')}};
  await assert.rejects(()=>createM04AuthorizedShellSettingsReadAdapter({DB})
    .getAppShellSettings_(req()),/NEEDS_REVIEW/i);
});
