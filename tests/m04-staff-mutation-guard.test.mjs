import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateStaffMutationGuard} from '../src/auth/staff-mutation-guard.js';

const admin=(id='USR-A')=>({'User ID':id,'Role':'Administrator','Status':'Active'});
const member=(id='USR-M')=>({'User ID':id,'Role':'Cashier','Status':'Active'});
const ctx=(operation,changes={})=>({
  operation,actor:admin('USR-A'),target:admin('USR-B'),
  activeAdministratorCount:2,...changes,
});
const deny=(obj,code)=>assert.deepEqual(evaluateStaffMutationGuard(obj),{allowed:false,code});

test('immutable UserManagement source forbids deletion of self and losing last Administrator',()=>{
  const src=readFileSync(new URL('../legacy/source/UserManagement.gs',import.meta.url),'utf8');
  assert.match(src,/actor\['User ID'\] === userId/);
  assert.match(src,/existing\['Role'\] === 'Administrator' && countActiveAdmins_\(\) <= 1/);
  assert.match(src,/next === 'Inactive' && existing\['Role'\] === 'Administrator' && countActiveAdmins_\(\) <= 1/);
  assert.match(src,/existing\['Role'\] === 'Administrator' && role !== 'Administrator' && countActiveAdmins_\(\) <= 1/);
  assert.match(src,/existing\['Role'\] === 'Administrator' && actor\['Role'\] !== 'Administrator'/);
});

test('last administrator may not be deleted even by another administrator',()=>{
  deny(ctx('delete',{activeAdministratorCount:1}),'LAST_ADMIN_FORBIDDEN');
  deny(ctx('delete',{target:{...admin('USR-B'),'Status':'Inactive'},activeAdministratorCount:1}),'LAST_ADMIN_FORBIDDEN');
  assert.deepEqual(evaluateStaffMutationGuard(ctx('delete')),{allowed:true,code:'ALLOWED'});
});

test('self-deletion fails regardless of count or role',()=>{
  deny(ctx('delete',{target:admin('USR-A')}),'SELF_DELETE_FORBIDDEN');
  deny(ctx('delete',{actor:member('USR-M'),target:member('USR-M')}),'SELF_DELETE_FORBIDDEN');
  deny(ctx('delete',{actor:admin('USR-A'),target:admin('USR-A'),activeAdministratorCount:1}),'SELF_DELETE_FORBIDDEN');
});

test('last administrator cannot be deactivated, demoted or converted into an inactive account',()=>{
  deny(ctx('set-status',{nextStatus:'Inactive',activeAdministratorCount:1}),'LAST_ADMIN_FORBIDDEN');
  deny(ctx('set-role',{nextRole:'Cashier',activeAdministratorCount:1}),'LAST_ADMIN_FORBIDDEN');
  assert.deepEqual(evaluateStaffMutationGuard(ctx('set-status',{nextStatus:'Active',activeAdministratorCount:1})),
    {allowed:true,code:'ALLOWED'});
  assert.deepEqual(evaluateStaffMutationGuard(ctx('set-role',{nextRole:'Administrator',activeAdministratorCount:1})),
    {allowed:true,code:'ALLOWED'});
  assert.deepEqual(evaluateStaffMutationGuard(ctx('set-status',{nextStatus:'Inactive'})),
    {allowed:true,code:'ALLOWED'});
  assert.deepEqual(evaluateStaffMutationGuard(ctx('set-role',{nextRole:'Cashier'})),
    {allowed:true,code:'ALLOWED'});
});

test('ordinary staff may be deactivated or demoted independently of active admin count',()=>{
  assert.deepEqual(evaluateStaffMutationGuard(ctx('set-status',{
    target:member('USR-M'),nextStatus:'Inactive',activeAdministratorCount:1,
  })),{allowed:true,code:'ALLOWED'});
  assert.deepEqual(evaluateStaffMutationGuard(ctx('set-role',{
    target:member('USR-M'),nextRole:'Clerk',activeAdministratorCount:1,
  })),{allowed:true,code:'ALLOWED'});
});

test('nonadmin actors cannot assign Administrator role or reset Administrator passwords',()=>{
  deny(ctx('set-role',{actor:member('USR-M'),target:member('USR-C'),nextRole:'Administrator'}),
    'ADMIN_ROLE_REQUIRES_ADMIN');
  deny(ctx('set-role',{actor:member('USR-M'),nextRole:'Administrator'}),
    'ADMIN_ROLE_REQUIRES_ADMIN');
  deny(ctx('reset-password',{actor:member('USR-M')}),'ADMIN_RESET_REQUIRES_ADMIN');
  assert.deepEqual(evaluateStaffMutationGuard(ctx('reset-password',{
    actor:member('USR-M'),target:member('USR-C'),
  })),{allowed:true,code:'ALLOWED'});
  assert.deepEqual(evaluateStaffMutationGuard(ctx('set-role',{
    target:member('USR-C'),nextRole:'Administrator',
  })),{allowed:true,code:'ALLOWED'});
});

test('inactive actor cannot mutate another user even if proposed operation otherwise safe',()=>{
  for(const operation of ['delete','reset-password','set-role','set-status']){
    const opts=operation==='set-role'?{nextRole:'Cashier'}:operation==='set-status'?{nextStatus:'Active'}:{};
    deny(ctx(operation,{actor:{...admin('USR-A'),'Status':'Inactive'},...opts}),
      'ACTOR_INACTIVE');
  }
});

test('untrustworthy active-admin counts fail closed instead of assuming surplus admins',()=>{
  for(const count of [undefined,null,NaN,Infinity,-1,0,1.5,'2',2n,Number.MAX_SAFE_INTEGER+1])
    deny(ctx('delete',{activeAdministratorCount:count}),'INVALID_CONTEXT');
});

test('missing / malformed / inherited context, actor or target values deny',()=>{
  for(const bad of [undefined,null,[],false,{},Object.create(ctx('delete'))])
    deny(bad,'INVALID_CONTEXT');
  for(const invalidRecord of [
    null,{},[],{...admin(),'User ID':' '},
    {...admin(),'Role':''},{...admin(),'Status':'Disabled'},
    Object.assign(Object.create({'User ID':'USR-B'}),{'Role':'Administrator','Status':'Active'}),
  ]) deny(ctx('delete',{target:invalidRecord}),'INVALID_CONTEXT');
  deny(ctx('reset-password',{actor:{...admin('USR-A'),'User ID':17}}),'INVALID_CONTEXT');
});

test('unknown operations, malformed next values and irrelevant fields all deny',()=>{
  for(const operation of [undefined,null,'update','create','DELETE','role-change',{}])
    deny(ctx(operation),'INVALID_CONTEXT');
  for(const nextRole of [undefined,null,'','  ',77,{},'\n'])
    deny(ctx('set-role',{nextRole}),'INVALID_CONTEXT');
  for(const nextStatus of [undefined,null,'Locked',false,'active'])
    deny(ctx('set-status',{nextStatus}),'INVALID_CONTEXT');
  deny(ctx('delete',{nextRole:'Administrator'}),'INVALID_CONTEXT');
  deny(ctx('reset-password',{nextStatus:'Inactive'}),'INVALID_CONTEXT');
  deny(ctx('set-role',{nextRole:'Cashier',nextStatus:'Active'}),'INVALID_CONTEXT');
  deny({...ctx('delete'),actorId:'USR-A'},'INVALID_CONTEXT');
});

test('accessor and proxy traps never execute successful mutation policy',()=>{
  let reads=0;
  const raw=ctx('delete');
  Object.defineProperty(raw,'activeAdministratorCount',{get(){reads++;throw new Error('SECRET');}});
  deny(raw,'INVALID_CONTEXT');
  assert.equal(reads,0);
  const target=admin('USR-B');
  Object.defineProperty(target,'Role',{get(){reads++;throw new Error('SECRET');}});
  deny(ctx('delete',{target}),'INVALID_CONTEXT');
  assert.equal(reads,0);
  const targetProxy=new Proxy({}, {getOwnPropertyDescriptor(){throw new Error('PRIVATE');}});
  deny(ctx('delete',{target:targetProxy}),'INVALID_CONTEXT');
});

test('return codes never contain names, user IDs, role details or passwords',()=>{
  const secret='PRIVATE-MUST-NOT-RETURN';
  const c=ctx('delete',{actor:admin(secret),target:admin('USR-B'),activeAdministratorCount:1});
  const result=evaluateStaffMutationGuard(c);
  assert.equal(JSON.stringify(result).includes(secret),false);
  assert.deepEqual(Object.keys(result),['allowed','code']);
});

test('Worker and RPC registry remain unconnected to internal guard',async()=>{
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/staff-mutation-guard|evaluateStaffMutationGuard/);
  assert.doesNotMatch(rpc,/staff-mutation-guard|evaluateStaffMutationGuard/);
  const {default:app}=await import('../src/index.js');
  const origin='https://auth-preview.invalid';
  const r=await app.fetch(new Request(origin+'/api/rpc',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'deleteUser',args:['dummy','USR-A']}),
  }),{});
  assert.equal(r.status,501);
});
