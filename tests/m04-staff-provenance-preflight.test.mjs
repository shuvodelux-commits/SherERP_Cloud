import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {auditLegacyStaffProvenance} from '../src/auth/staff-provenance-preflight.js';

const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update('SyntheticOnlySecret!'+SALT).digest('hex');
const user=(more={})=>({
  'User ID':'USR-1','Full Name':'Synthetic Test Admin',
  'Mobile Number':'01700000201','Password Hash':HASH,'Password Salt':SALT,
  'Role':'Administrator','Status':'Active',
  'Created By':'First-run bootstrap','Created At':'2025-01-20T12:05:06.000Z',
  'Last Login':'',...more,
});
const cashier=(more={})=>user({
  'User ID':'USR-2','Full Name':'Synthetic Cashier',
  'Mobile Number':'01700000202','Role':'Cashier','Created By':'Synthetic Admin',
  'Last Login':'2025-06-30T08:09:10.000Z',...more,
});
const role=(more={})=>({
  'Role ID':'ROL-1','Role Name':'Cashier','Allowed Modules':'products',
  'Permissions':JSON.stringify({products:{view:true,add:false,edit:false,delete:'disabled'}}),
  'Status':'Active','Created At':'2025-01-20T12:06:07.000Z',...more,
});
const snapshot=()=>({users:[user(),cashier()],roles:[role()]});
const has=(r,scope,row,code)=>r.issues.some(x=>x.scope===scope&&x.row===row&&x.code===code);

test('source contract retains historical fields with no automatic actor ID inference',()=>{
  const cfg=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  assert.match(cfg,/USERS: \[([\s\S]*?)"Created By",([\s\S]*?)"Created At",([\s\S]*?)"Last Login"/);
  assert.match(cfg,/ROLES: \[([\s\S]*?)"Created At"/);
  const source=readFileSync(new URL('../legacy/source/UserManagement.gs',import.meta.url),'utf8');
  assert.match(source,/'Created By': 'First-run bootstrap'/);
});

test('complete protected staff export passes without altering any source values',()=>{
  const src=snapshot(),before=structuredClone(src);
  assert.deepEqual(auditLegacyStaffProvenance(src),{
    preflightPass:true,counts:{users:2,roles:1,activeAdministrators:1},issues:[],
  });
  assert.deepEqual(src,before);
});

test('missing or invalid Created By and Created At cannot be replaced by guessed timestamps',()=>{
  for(const [field,value,code] of [
    ['Created By','','USER_CREATED_BY_MISSING'],
    ['Created By',null,'USER_CREATED_BY_MISSING'],
    ['Created At','','USER_CREATED_AT_INVALID'],
    ['Created At','2026-02-30T10:00:00.000Z','USER_CREATED_AT_INVALID'],
    ['Created At','2026-01-01T10:00:00+06:00','USER_CREATED_AT_INVALID'],
    ['Created At',new Date('2026-01-01T00:00:00Z'),'USER_CREATED_AT_INVALID'],
  ]){
    const s=snapshot();s.users[0][field]=value;
    assert.equal(has(auditLegacyStaffProvenance(s),'user',0,code),true,field);
  }
});

test('never-signed-in Last Login is empty only; malformed or noncanonical timestamps fail',()=>{
  for(const value of [null,'Never','2025-13-02T00:00:00.000Z',0,'2025-01-01']){
    const s=snapshot();s.users[1]['Last Login']=value;
    assert.equal(has(auditLegacyStaffProvenance(s),'user',1,'USER_LAST_LOGIN_INVALID'),true,String(value));
  }
  const s=snapshot();s.users[1]['Last Login']='';
  assert.equal(auditLegacyStaffProvenance(s).preflightPass,true);
});

test('roles require real source Created At, not current time fallback',()=>{
  for(const value of ['',null,'2025-02-29T00:00:00.000Z','2025-01-01T10:00:00Z']){
    const s=snapshot();s.roles[0]['Created At']=value;
    assert.equal(has(auditLegacyStaffProvenance(s),'role',0,'ROLE_CREATED_AT_INVALID'),true,String(value));
  }
});

test('source actor display text remains source text, never resolved to staff User ID',()=>{
  const src=snapshot();src.users[1]['Created By']='Unknown original actor';
  assert.equal(auditLegacyStaffProvenance(src).preflightPass,true);
});

test('malformed root exports and accessor/private proxy fields fail closed with redacted reports',()=>{
  const bad=snapshot();
  Object.defineProperty(bad.users[1],'Created By',{get(){throw Error('PRIVATE SOURCE ACTOR')},enumerable:true});
  const res=auditLegacyStaffProvenance(bad);
  assert.equal(res.preflightPass,false);
  assert.ok(res.issues.some(x=>x.code==='ROW_MALFORMED' || x.code==='USER_PROVENANCE_MALFORMED'));
  assert.equal(JSON.stringify(res).includes('PRIVATE SOURCE ACTOR'),false);
  assert.equal(auditLegacyStaffProvenance(null).preflightPass,false);
  const evil=new Proxy(snapshot(),{getOwnPropertyDescriptor(){throw Error('PRIVATE SOURCE') }});
  assert.equal(auditLegacyStaffProvenance(evil).preflightPass,false);
});

test('identity/permission audit failure also denies provenance pass',()=>{
  const s=snapshot();s.users[1]['Mobile Number']=s.users[0]['Mobile Number'];
  const report=auditLegacyStaffProvenance(s);
  assert.equal(report.preflightPass,false);
  assert.ok(report.issues.some(x=>x.code==='USER_MOBILE_DUPLICATE'));
  const another=snapshot();another.roles[0]['Allowed Modules']='products,users';
  assert.equal(auditLegacyStaffProvenance(another).preflightPass,false);
});

test('pure preflight neither opens D1 nor registers public import RPC',()=>{
  const code=readFileSync(new URL('../src/auth/staff-provenance-preflight.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\.prepare\(|\.batch\(|\bfetch\(|\bconsole\.|\bimportLegacyStaffSnapshotWithD1\(/);
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/auditLegacyStaffProvenance|staff-provenance-preflight/);
});
