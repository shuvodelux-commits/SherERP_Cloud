import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {auditStableLegacyStaffFreeze} from '../src/auth/two-pass-source-freeze.js';

const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update('SyntheticFreezeOnly!'+SALT).digest('hex');
const user=(id,mobile,role,extras={})=>({
  'User ID':id,'Full Name':'Synthetic '+id,'Mobile Number':mobile,
  'Password Hash':HASH,'Password Salt':SALT,'Role':role,'Status':'Active',
  'Created By':role==='Administrator'?'First-run bootstrap':'Source actor text',
  'Created At':'2025-01-20T12:05:06.000Z','Last Login':'',...extras,
});
const role=()=>({
  'Role ID':'ROL-FREEZE-1','Role Name':'Cashier',
  'Allowed Modules':'products',
  'Permissions':JSON.stringify({products:{view:true,add:false,edit:false,delete:'disabled'}}),
  'Status':'Active','Created At':'2025-01-20T12:06:07.000Z',
});
const source=()=>({
  users:[user('USR-FREEZE-ADMIN','01790000921','Administrator'),
    user('USR-FREEZE-CASH',1790000922,'Cashier',{ 'Last Login':'2025-06-30T08:09:10.000Z'})],
  roles:[role()],
});
const verify=(s,modify)=>{
  const second=structuredClone(s);
  modify(second);
  const report=auditStableLegacyStaffFreeze(s,second);
  assert.equal(report.freezeMatch,false);
  assert.equal(report.issues.length>0,true);
  return report;
};

test('complete independently captured equal source snapshots pass without returning any private value',()=>{
  const first=source(), second=structuredClone(first), initial=structuredClone(first);
  assert.deepEqual(auditStableLegacyStaffFreeze(first,second),{
    freezeMatch:true,counts:{users:2,roles:1},issues:[],
  });
  assert.deepEqual(first,initial);
  assert.deepEqual(second,initial);
});

test('any original credential, person or historical user field drift is rejected',()=>{
  for(const [field,change] of [
    ['User ID','USR-DIFFERENT'],['Full Name','Different name'],
    ['Mobile Number','01790000922'],['Password Hash','ab'.repeat(32)],
    ['Password Salt','00000000-0000-0000-0000-000000000001'],
    ['Role','Administrator'],['Status','Inactive'],
    ['Created By','Unknown actor'],['Created At','2025-01-21T12:05:06.000Z'],
    ['Last Login','2025-07-01T08:09:10.000Z'],
  ]){
    const first=source();
    const result=verify(first,second=>{second.users[1][field]=change;});
    assert.ok(result.issues.some(x=>x.code==='USER_SOURCE_CHANGED'||x.code==='SOURCE_PREFLIGHT_FAILED'),field);
    assert.equal(JSON.stringify(result).includes(change),false,field);
  }
});

test('role identity, permissions, allowed modules, status and source created timestamp must match exactly',()=>{
  for(const [field,change] of [
    ['Role ID','ROL-OTHER'],['Role Name','Other Role'],
    ['Allowed Modules',''],
    ['Permissions',JSON.stringify({products:{view:true,edit:true,add:false,delete:'disabled'}})],
    ['Status','Inactive'],['Created At','2025-01-21T12:06:07.000Z'],
  ]){
    const first=source();
    const result=verify(first,second=>{second.roles[0][field]=change;});
    assert.ok(result.issues.some(x=>x.code==='ROLE_SOURCE_CHANGED'||x.code==='SOURCE_PREFLIGHT_FAILED'),field);
    assert.doesNotMatch(JSON.stringify(result),/ROL-FREEZE|Cashier|2025-01/);
  }
});

test('source row ordering and row counts are invariant; never guess or canonicalize them',()=>{
  let result=verify(source(),next=>next.users.reverse());
  assert.ok(result.issues.some(x=>x.code==='USER_SOURCE_CHANGED'));
  result=verify(source(),next=>next.users.pop());
  assert.ok(result.issues.some(x=>x.code==='USERS_COUNT_CHANGED'));
  result=verify(source(),next=>next.roles.pop());
  assert.ok(result.issues.some(x=>x.code==='ROLES_COUNT_CHANGED'||x.code==='SOURCE_PREFLIGHT_FAILED'));
});

test('two equally corrupted snapshots cannot pass source freeze validation',()=>{
  const first=source();first.users[0]['Created At']='2025-02-30T12:05:06.000Z';
  const second=structuredClone(first);
  const report=auditStableLegacyStaffFreeze(first,second);
  assert.equal(report.freezeMatch,false);
  assert.deepEqual(report.issues,[{scope:'snapshot',row:null,code:'SOURCE_PREFLIGHT_FAILED'}]);
});

test('accessors and proxy failures never execute source getters or leak their error details',()=>{
  const first=source(),second=source();
  let invoked=0;
  Object.defineProperty(second.users[0],'Full Name',{
    enumerable:true,get(){invoked++;throw Error('PRIVATE SOURCE CREDENTIAL');},
  });
  const result=auditStableLegacyStaffFreeze(first,second);
  assert.equal(result.freezeMatch,false);
  assert.equal(invoked,0);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE SOURCE/);
  const evil=new Proxy(source(),{getOwnPropertyDescriptor(){throw Error('SECRET') }});
  assert.equal(auditStableLegacyStaffFreeze(first,evil).freezeMatch,false);
});

test('pure source-freeze helper never uses D1, fetch, console or public RPC wiring',()=>{
  const helper=readFileSync(new URL('../src/auth/two-pass-source-freeze.js',import.meta.url),'utf8');
  assert.doesNotMatch(helper,/\\.prepare\\(|\\.batch\\(|\\bfetch\\(|\\bconsole\\.|\\bgetAppShellData\\b/);
  const publicFiles=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(publicFiles,/two-pass-source-freeze|auditStableLegacyStaffFreeze/);
  const manifest=readFileSync(new URL('../.github/workflows/remote-d1-staging.yml',import.meta.url),'utf8');
  assert.match(manifest,/EXPECTED_REMOTE_MIGRATION_COUNT=2/);
});
