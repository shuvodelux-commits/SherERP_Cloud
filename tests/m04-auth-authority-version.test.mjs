import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const schema=readFileSync(new URL('./fixtures/m04-auth-migrations/0001_auth_core.sql',import.meta.url),'utf8');
const dbForTest=()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(schema);
  return db;
};
function addStaff(db,id,phone,role='Administrator') {
  db.prepare(`INSERT INTO auth_users
    (user_id,full_name,phone_key,role_name,status,password_hash,password_salt,password_iterations)
    VALUES (?,?,?,?,'Active',?,?,210000)`)
    .run(id,'Fixture '+id,phone,role,'ab'.repeat(32),'cd'.repeat(24));
}
const version=(db,table,col,value)=>db.prepare(`SELECT auth_version AS v FROM ${table} WHERE ${col}=?`).get(value).v;

test('proposed local auth SQL requires authority snapshots; deployed RPC stays inert',()=>{
  const db=dbForTest();
  for(const [table,columns] of [
    ['auth_users',['auth_version']],
    ['auth_roles',['auth_version']],
    ['auth_sessions',['user_auth_version','role_auth_version','credential_version']],
  ]){
    const actual=db.prepare('PRAGMA table_info('+table+')').all().map(r=>r.name);
    for(const column of columns) assert.ok(actual.includes(column),table+'.'+column);
  }
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/d1-auth-core|auth_sessions/);
  db.close();
});

test('staff authority version increments on disable/re-enable, demotion and changed credential, not no-op',()=>{
  const db=dbForTest();
  addStaff(db,'ADM-1','01710000001');
  addStaff(db,'ADM-2','01710000002');
  assert.equal(version(db,'auth_users','user_id','ADM-1'),1);
  db.prepare("UPDATE auth_users SET status='Inactive' WHERE user_id='ADM-1'").run();
  assert.equal(version(db,'auth_users','user_id','ADM-1'),2);
  db.prepare("UPDATE auth_users SET status='Active' WHERE user_id='ADM-1'").run();
  assert.equal(version(db,'auth_users','user_id','ADM-1'),3);
  db.prepare("UPDATE auth_users SET status='Active' WHERE user_id='ADM-1'").run();
  assert.equal(version(db,'auth_users','user_id','ADM-1'),3);
  db.prepare("UPDATE auth_users SET password_hash=? WHERE user_id='ADM-1'").run('ef'.repeat(32));
  assert.equal(version(db,'auth_users','user_id','ADM-1'),4);
  db.prepare("UPDATE auth_users SET role_name='Cashier' WHERE user_id='ADM-1'").run();
  assert.equal(version(db,'auth_users','user_id','ADM-1'),5);
  assert.equal(version(db,'auth_users','user_id','ADM-2'),1);
  db.close();
});

test('custom role version increments on permission changes and status toggles, not on unrelated data',()=>{
  const db=dbForTest();
  db.prepare("INSERT INTO auth_roles (role_name,status,permissions_json) VALUES ('Cashier','Active','{}'),('Auditor','Active','{}')").run();
  assert.equal(version(db,'auth_roles','role_name','Cashier'),1);
  db.prepare("UPDATE auth_roles SET permissions_json=? WHERE role_name='Cashier'").run('{"sales":{"edit":false}}');
  assert.equal(version(db,'auth_roles','role_name','Cashier'),2);
  db.prepare("UPDATE auth_roles SET status='Inactive' WHERE role_name='Cashier'").run();
  db.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='Cashier'").run();
  assert.equal(version(db,'auth_roles','role_name','Cashier'),4);
  db.prepare("UPDATE auth_roles SET status='Active' WHERE role_name='Cashier'").run();
  assert.equal(version(db,'auth_roles','role_name','Cashier'),4);
  assert.equal(version(db,'auth_roles','role_name','Auditor'),1);
  db.close();
});
