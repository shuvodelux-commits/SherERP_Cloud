import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {auditLegacyStaffRoleAuthority} from '../src/auth/source-role-permission-import-gate.js';

const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update('SyntheticNotReal!'+SALT).digest('hex');
const admin=(patch={})=>({
  'User ID':'USR-0001','Full Name':'Synthetic Admin','Mobile Number':'01700000001',
  'Password Hash':HASH,'Password Salt':SALT,'Role':'Administrator',
  'Status':'Active',...patch,
});
const cashier=(patch={})=>admin({
  'User ID':'USR-0002','Full Name':'Synthetic Cashier',
  'Mobile Number':'01700000002','Role':'Cashier',...patch,
});
const role=(patch={})=>({
  'Role ID':'ROL-0001','Role Name':'Cashier','Allowed Modules':'products',
  'Permissions':JSON.stringify({
    products:{view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited'},
    users:{view:false,add:false,edit:false,delete:false},
  }),
  'Status':'Active',...patch,
});
const snapshot=()=>({users:[admin(),cashier()],roles:[role()]});
const rejected=(result,code,row=0)=>!result.preflightPass &&
  result.issues.some(x=>x.scope==='role' && x.row===row && x.code===code);

test('frozen RoleManagement derives Allowed Modules exclusively from view-true source grants',()=>{
  const source=readFileSync(new URL('../legacy/source/RoleManagement.gs',import.meta.url),'utf8');
  assert.match(source,/const allowedModules = Object\.keys\(permissions\)\.filter\(function \(k\) \{/);
  assert.match(source,/return permissions\[k\]\.view;/);
});

test('complete Administrator and Cashier snapshot passes strict import authority gate unchanged',()=>{
  const {users,roles}=snapshot();
  const before=structuredClone({users,roles});
  assert.deepEqual(auditLegacyStaffRoleAuthority(users,roles),{
    preflightPass:true,counts:{users:2,roles:1,activeAdministrators:1},issues:[],
  });
  assert.deepEqual({users,roles},before);
});

test('source role Allowed Modules cannot exceed or understate its exact view-true grants',()=>{
  const {users,roles}=snapshot();
  roles[0]['Allowed Modules']='products,users';
  assert.equal(rejected(auditLegacyStaffRoleAuthority(users,roles),'ROLE_ALLOWED_MODULES_MISMATCH'),true);
  roles[0]['Allowed Modules']='';
  assert.equal(rejected(auditLegacyStaffRoleAuthority(users,roles),'ROLE_ALLOWED_MODULES_MISMATCH'),true);
  roles[0]['Allowed Modules']='products,products';
  assert.equal(rejected(auditLegacyStaffRoleAuthority(users,roles),'ROLE_PERMISSION_SCHEMA_INVALID'),true);
  roles[0]['Allowed Modules']='products';
  roles[0].Permissions='{"products":{"view":true},"users":{"view":true}}';
  assert.equal(rejected(auditLegacyStaffRoleAuthority(users,roles),'ROLE_ALLOWED_MODULES_MISMATCH'),true);
});

test('reject unsupported modules and privilege-bearing wrong types or delete/backdate windows',()=>{
  for(const permissions of [
    {products:{view:'true'}},
    {products:{view:true,delete:'365'}},
    {products:{view:true},users:{delete:'7'}},
    {products:{view:true},otherUnknown:{view:true}},
    {products:{view:true,edit:1}},
    {products:{view:true,backdate:'tomorrow'}},
  ]){
    const {users,roles}=snapshot();
    roles[0].Permissions=JSON.stringify(permissions);
    assert.equal(rejected(auditLegacyStaffRoleAuthority(users,roles),'ROLE_PERMISSION_SCHEMA_INVALID'),true,JSON.stringify(permissions));
  }
});

test('non-canonical role names fail rather than silently remap source staff references',()=>{
  const {users,roles}=snapshot();
  roles[0]['Role Name']=' Cashier ';
  assert.equal(rejected(auditLegacyStaffRoleAuthority(users,roles),'ROLE_NAME_NOT_CANONICAL'),true);
});

test('valid built-in Administrator-only roster needs no custom roles',()=>{
  assert.deepEqual(auditLegacyStaffRoleAuthority([admin()],[]),{
    preflightPass:true,counts:{users:1,roles:0,activeAdministrators:1},issues:[],
  });
});

test('structural invalidity, malformed snapshots and role accessor or Proxy fail closed',()=>{
  const {users,roles}=snapshot();
  users[1]['User ID']=users[0]['User ID'];
  const structural=auditLegacyStaffRoleAuthority(users,roles);
  assert.equal(structural.preflightPass,false);
  assert.ok(structural.issues.some(x=>x.code==='USER_ID_DUPLICATE'));
  assert.equal(auditLegacyStaffRoleAuthority(null,roles).preflightPass,false);
  const evil=role();
  Object.defineProperty(evil,'Permissions',{get(){throw Error('PRIVATE-PASSWORD');},enumerable:true});
  assert.equal(auditLegacyStaffRoleAuthority([admin()],[evil]).preflightPass,false);
  const trap=new Proxy(role(),{getOwnPropertyDescriptor(){throw Error('PRIVATE-PASSWORD');}});
  assert.equal(auditLegacyStaffRoleAuthority([admin()],[trap]).preflightPass,false);
});

test('report never exposes user, role, phone, hash, salt, or supplied permissions',()=>{
  const {users,roles}=snapshot();
  roles[0].Permissions='{"products":{"view":"PRIVATE-DATA-SECRET"}}';
  const output=JSON.stringify(auditLegacyStaffRoleAuthority(users,roles));
  for(const sensitive of [
    'Synthetic Cashier','01700000002',HASH,SALT,'ROL-0001','Cashier','PRIVATE-DATA-SECRET',
  ]) assert.equal(output.includes(sensitive),false);
});

test('new staff import gate is pure and cannot activate public Worker RPC or database access',()=>{
  const code=readFileSync(new URL('../src/auth/source-role-permission-import-gate.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\bfetch\(|\bconsole\.|\.prepare\(|\bDB\.batch\(|\bcreateSession\(/);
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/auditLegacyStaffRoleAuthority|source-role-permission-import-gate/);
  assert.doesNotMatch(worker,/auditLegacyStaffRoleAuthority|source-role-permission-import-gate/);
});
