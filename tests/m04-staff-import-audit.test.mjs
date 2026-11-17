import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {auditLegacyStaffImport} from '../src/auth/staff-import-audit.js';

const SALT='123e4567-e89b-42d3-a456-426614174000';
const hash=createHash('sha256').update('SyntheticTestOnly!'+SALT,'utf8').digest('hex');
const staff=(overrides={})=>({
  'User ID':'USR-0001',
  'Full Name':'Synthetic Administrator',
  'Mobile Number':'01700000001',
  'Password Hash':hash,
  'Password Salt':SALT,
  'Role':'Administrator',
  'Status':'Active',
  ...overrides,
});
const cashier=(overrides={})=>staff({
  'User ID':'USR-0002','Full Name':'Synthetic Cashier',
  'Mobile Number':'01700000002','Role':'Cashier',...overrides,
});
const role=(overrides={})=>({
  'Role ID':'ROL-0001','Role Name':'Cashier','Allowed Modules':'sales,pos',
  'Permissions':'{"sales":{"view":true}}','Status':'Active',...overrides,
});
const sample=()=>({users:[staff(),cashier()],roles:[role()]});
const has=(result,scope,code,row)=>result.issues.some(i=>
  i.scope===scope && i.code===code && (row===undefined || i.row===row));

test('pinned Config.gs preserves USERS/ROLES identity, credential and role fields',()=>{
  const c=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  for(const field of ['User ID','Full Name','Mobile Number','Password Hash','Password Salt','Role','Status'])
    assert.match(c.slice(c.indexOf('USERS: ['),c.indexOf('ROLES: [')),new RegExp('"'+field+'"'));
  for(const field of ['Role ID','Role Name','Allowed Modules','Permissions','Status'])
    assert.match(c.slice(c.indexOf('ROLES: ['),c.indexOf('DELETE_LOG: [')),new RegExp('"'+field+'"'));
  const auth=readFileSync(new URL('../legacy/source/Auth.gs',import.meta.url),'utf8');
  assert.match(auth,/sha256Hex_\(password \+ salt\)/);
  const mgmt=readFileSync(new URL('../legacy/source/UserManagement.gs',import.meta.url),'utf8');
  assert.match(mgmt,/countActiveAdmins_\(\) <= 1/);
});

test('synthetic valid staff + built-in Administrator pass without mutation',()=>{
  const {users,roles}=sample();
  const before=structuredClone({users,roles});
  assert.deepEqual(auditLegacyStaffImport(users,roles),{
    preflightPass:true,
    counts:{users:2,roles:1,activeAdministrators:1},
    issues:[],
  });
  assert.deepEqual({users,roles},before);
});

test('legacy Sheets coercion of phone to a safe numeric identifier is allowed for audit',()=>{
  const {users,roles}=sample();
  users[1]['Mobile Number']=1712345678;
  assert.equal(auditLegacyStaffImport(users,roles).preflightPass,true);
  users[1]['Mobile Number']=1.5;
  assert.equal(has(auditLegacyStaffImport(users,roles),'user','USER_MOBILE_INVALID',1),true);
});

test('missing or non-array snapshots never become a valid empty import',()=>{
  for(const [users,roles] of [
    [undefined,[]],[[],undefined],[null,[]],[[],null],[{},[]],[[],{}],
  ]){
    const result=auditLegacyStaffImport(users,roles);
    assert.equal(result.preflightPass,false);
    assert.deepEqual(result.counts,{users:0,roles:0,activeAdministrators:0});
    assert.deepEqual(result.issues,[{scope:'snapshot',row:null,code:'SNAPSHOT_INVALID'}]);
  }
});

test('Proxy array length cannot leak values or authorize a partial snapshot',()=>{
  const fake=new Proxy([],{
    get(target,key,receiver){
      if(key==='length') return 'PRIVATE-SNAPSHOT-SIZE';
      return Reflect.get(target,key,receiver);
    },
  });
  const result=auditLegacyStaffImport(fake,[]);
  assert.equal(result.preflightPass,false);
  assert.equal(JSON.stringify(result).includes('PRIVATE-SNAPSHOT-SIZE'),false);
  assert.deepEqual(result.issues,[{scope:'snapshot',row:null,code:'SNAPSHOT_INVALID'}]);
});

test('zero active Administrators blocks import, including all-inactive user snapshots',()=>{
  const a=auditLegacyStaffImport([staff({'Status':'Inactive'})],[role()]);
  assert.equal(a.counts.activeAdministrators,0);
  assert.equal(has(a,'snapshot','ACTIVE_ADMIN_REQUIRED',null),true);
  const b=auditLegacyStaffImport([],[role()]);
  assert.equal(has(b,'snapshot','ACTIVE_ADMIN_REQUIRED',null),true);
});

test('exact source user IDs and role IDs must be present and unique',()=>{
  const {users,roles}=sample();
  users[1]['User ID']=users[0]['User ID'];
  roles.push(role({'Role ID':'ROL-0001','Role Name':'Clerk'}));
  const result=auditLegacyStaffImport(users,roles);
  assert.equal(has(result,'user','USER_ID_DUPLICATE',1),true);
  assert.equal(has(result,'role','ROLE_ID_DUPLICATE',1),true);
  assert.equal(result.preflightPass,false);
});

test('custom role names cannot duplicate case-insensitively or impersonate Administrator',()=>{
  const {users,roles}=sample();
  roles.push(role({'Role ID':'ROL-0002','Role Name':' CASHIER '}));
  roles.push(role({'Role ID':'ROL-0003','Role Name':'administrator'}));
  const out=auditLegacyStaffImport(users,roles);
  assert.equal(has(out,'role','ROLE_NAME_DUPLICATE',1),true);
  assert.equal(has(out,'role','ROLE_NAME_RESERVED',2),true);
});

test('missing or inactive custom roles are not accepted for active staff',()=>{
  const missing=auditLegacyStaffImport([staff(),cashier({'Role':'Unmapped'})],[role()]);
  assert.equal(has(missing,'user','USER_ROLE_MISSING',1),true);
  const inactive=auditLegacyStaffImport([staff(),cashier()],[role({'Status':'Inactive'})]);
  assert.equal(has(inactive,'user','USER_ROLE_INACTIVE',1),true);
  const allowed=auditLegacyStaffImport([staff(),cashier({'Status':'Inactive'})],[role({'Status':'Inactive'})]);
  assert.equal(allowed.preflightPass,true);
});

test('source lowercase SHA-256 hash and UUID salt are required for every user, even inactive',()=>{
  for(const [field,value] of [
    ['Password Hash',hash.toUpperCase()],['Password Hash','not-a-hash'],
    ['Password Hash',''],['Password Salt',''],['Password Salt','fake'],
    ['Password Salt',null],
  ]){
    const {users,roles}=sample();
    users[1][field]=value;
    users[1].Status='Inactive';
    const out=auditLegacyStaffImport(users,roles);
    assert.equal(has(out,'user','USER_CREDENTIAL_INVALID',1),true,field);
  }
});

test('malformed credential values must not invoke an attacker-controlled toString',()=>{
  const {users,roles}=sample();
  let invoked=0;
  users[1]['Password Hash']={toString(){invoked++;throw new Error('PRIVATE SECRET VALUE');}};
  const report=auditLegacyStaffImport(users,roles);
  assert.equal(invoked,0);
  assert.equal(has(report,'user','USER_CREDENTIAL_INVALID',1),true);
  users[1]['Password Hash']=Symbol('private-marker');
  const symbolic=auditLegacyStaffImport(users,roles);
  assert.equal(has(symbolic,'user','USER_CREDENTIAL_INVALID',1),true);
});

test('role Permissions syntax must be a JSON object, allowed modules must be a string',()=>{
  for(const permissions of ['', 'garbage', 'null','[]','"hello"']){
    const out=auditLegacyStaffImport([staff()], [role({'Permissions':permissions})]);
    assert.equal(has(out,'role','ROLE_PERMISSIONS_INVALID',0),true);
  }
  const badModules=auditLegacyStaffImport([staff()],[role({'Allowed Modules':{}})]);
  assert.equal(has(badModules,'role','ROLE_ALLOWED_MODULES_INVALID',0),true);
});

test('invalid status, blank source IDs, names, phone and staff role are flagged',()=>{
  const users=[staff({'User ID':'','Full Name':' ','Mobile Number':'',
    'Role':'','Status':'Unknown'})];
  const roles=[role({'Role ID':'','Role Name':'','Status':'Unknown'})];
  const out=auditLegacyStaffImport(users,roles);
  for(const code of ['USER_ID_INVALID','USER_NAME_INVALID','USER_MOBILE_INVALID',
    'USER_ROLE_INVALID','USER_STATUS_INVALID'])
    assert.equal(has(out,'user',code,0),true,code);
  for(const code of ['ROLE_ID_INVALID','ROLE_NAME_INVALID','ROLE_STATUS_INVALID'])
    assert.equal(has(out,'role',code,0),true,code);
});

test('inherited/accessor/proxy/sparse input rows fail closed without running getters',()=>{
  const valid=staff();
  const inherited=Object.assign(Object.create({'User ID':'USR-INHERITED'}),valid);
  delete inherited['User ID'];
  const accessor=staff();
  Object.defineProperty(accessor,'Password Hash',{get(){throw new Error('PRIVATE HASH');},enumerable:true});
  const bad=[inherited,accessor,new Proxy({}, {ownKeys(){throw new Error('PRIVATE KEY');}}),undefined];
  for(const row of bad){
    const out=auditLegacyStaffImport([valid,row],[role()]);
    assert.equal(has(out,'user','ROW_MALFORMED',1),true);
  }
  const sparse=[valid]; sparse.length=2;
  assert.equal(has(auditLegacyStaffImport(sparse,[role()]),'user','ROW_MALFORMED',1),true);
  const accessorRole=role();
  Object.defineProperty(accessorRole,'Permissions',{get(){throw new Error('PRIVATE ROLE');},enumerable:true});
  assert.equal(has(auditLegacyStaffImport([valid],[accessorRole]),'role','ROW_MALFORMED',0),true);
});

test('results expose no source IDs, names, mobiles, password hashes, salts, or permissions',()=>{
  const marker='PRIVATE-NOT-FOR-OUTPUT-12345';
  const u=staff({'User ID':marker,'Full Name':marker,'Mobile Number':marker});
  const r=role({'Role ID':marker,'Role Name':marker,'Permissions':'{"canSee":"'+marker+'"}'});
  const result=auditLegacyStaffImport([u,u],[r,r]);
  const output=JSON.stringify(result);
  assert.equal(output.includes(marker),false);
  assert.equal(output.includes(hash),false);
  assert.equal(output.includes(SALT),false);
  assert.ok(result.issues.length>0);
  assert.ok(result.issues.every(i=>
    ['scope','row','code'].every(k=>Object.hasOwn(i,k)) &&
    Object.keys(i).length===3));
});

test('staff preflight is internal: RPC and Worker remain fail closed',async()=>{
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/auditLegacyStaffImport|staff-import-audit/);
  assert.doesNotMatch(worker,/auditLegacyStaffImport|staff-import-audit/);
  const {default:app}=await import('../src/index.js');
  const origin='https://shererp.invalid';
  const response=await app.fetch(new Request(origin+'/api/rpc',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'login',args:['synthetic','synthetic']}),
  }),{});
  // The public Worker explicitly reports unconfigured login as HTTP 503.
  assert.equal(response.status,503);
});

test('offline source preflight blocks staff-phone aliases even with distinct source IDs',()=>{
  const users=[
    staff({'Mobile Number':'01712345678'}),
    cashier({'Mobile Number':'+8801712345678'}),
    cashier({'User ID':'USR-0003','Mobile Number':'০১৭১২৩৪৫৬৭৮','Status':'Inactive'}),
    cashier({'User ID':'USR-0004','Mobile Number':1712345678}),
  ];
  const before=structuredClone(users);
  const result=auditLegacyStaffImport(users,[role()]);
  assert.equal(result.preflightPass,false);
  assert.equal(has(result,'user','USER_MOBILE_DUPLICATE',0),false);
  for(const row of [1,2,3])
    assert.equal(has(result,'user','USER_MOBILE_DUPLICATE',row),true,'duplicate staff row '+row);
  assert.deepEqual(users,before);
  assert.deepEqual(result.counts,{users:4,roles:1,activeAdministrators:1});
});

test('offline preflight fails closed on noncanonical phones instead of treating any nonblank string as login-safe',()=>{
  const entries=['hello','+12025550100','0171234567','০১৭১২৩৪৫৬৭','00000000000','013000000001'];
  for(const raw of entries){
    const {users,roles}=sample();
    users[1]['Mobile Number']=raw;
    const out=auditLegacyStaffImport(users,roles);
    assert.equal(has(out,'user','USER_MOBILE_UNSUPPORTED',1),true,'unsupported phone '+raw);
    assert.equal(out.preflightPass,false);
  }
  const out=auditLegacyStaffImport([staff({'Mobile Number':null})],[role()]);
  assert.equal(has(out,'user','USER_MOBILE_INVALID',0),true);
  assert.equal(has(out,'user','USER_MOBILE_UNSUPPORTED',0),false);
});

test('distinct normalized staff phones pass and preflight reports never expose phone or credentials',()=>{
  const users=[
    staff({'Mobile Number':1712345678}),
    cashier({'Mobile Number':'০১৮১২৩৪৫৬৭৮'}),
  ];
  const ok=auditLegacyStaffImport(users,[role()]);
  assert.equal(ok.preflightPass,true);
  assert.deepEqual(ok.issues,[]);
  users[1]['Mobile Number']='+8801712345678';
  const denied=auditLegacyStaffImport(users,[role()]);
  assert.equal(has(denied,'user','USER_MOBILE_DUPLICATE',1),true);
  const output=JSON.stringify(denied);
  assert.equal(output.includes('1712345678'),false);
  assert.equal(output.includes('+880'),false);
  assert.equal(output.includes(hash),false);
  assert.equal(output.includes(SALT),false);
  assert.ok(denied.issues.every(i=>Object.keys(i).sort().join(',')==='code,row,scope'));
});


test('protected staff preflight rejects unknown, hidden and symbol export columns without disclosing them',()=>{
  const marker='PRIVATE-UNAPPROVED-EXPORT-COLUMN-DO-NOT-LOG';
  const cases=[
    {
      scope:'user',
      mutate:({users})=>{users[0]['Session Token']=marker;},
    },
    {
      scope:'role',
      mutate:({roles})=>{roles[0]['Private Permission Override']=marker;},
    },
    {
      scope:'user',
      mutate:({users})=>Object.defineProperty(users[0],'Extra Hidden Secret',{
        enumerable:false,value:marker,
      }),
    },
    {
      scope:'role',
      mutate:({roles})=>{roles[0][Symbol('PRIVATE_ROLE_KEY')]=marker;},
    },
  ];
  for(const {scope,mutate} of cases){
    const source=sample();
    mutate(source);
    const result=auditLegacyStaffImport(source.users,source.roles);
    assert.equal(result.preflightPass,false,
      'the standalone audit must not certify unknown source columns');
    assert.equal(has(result,scope,'ROW_MALFORMED',0),true);
    assert.equal(JSON.stringify(result).includes(marker),false,
      'no unreviewed export value should be reflected');
  }

  // The pinned frozen source includes provenance columns. These are
  // approved historical data, not arbitrary extensions to the export.
  const approved=sample();
  approved.users[0]['Created By']='Synthetic Administrator';
  approved.users[0]['Created At']='2026-01-01T00:00:00.000Z';
  approved.users[0]['Last Login']='';
  approved.roles[0]['Created At']='2026-01-01T00:00:00.000Z';
  assert.equal(auditLegacyStaffImport(approved.users,approved.roles).preflightPass,true,
    'reviewed source provenance columns remain eligible');
});


test('M04 protected staff preflight rejects unapproved array-level export metadata',()=>{
  const secret='PRIVATE-NOT-FOR-AUDIT-ARRAY-OUTPUT-338';
  const modifiers=[
    {
      name:'named USERS array field',
      change:(source)=>{source.users['SESSIONS']=secret;},
    },
    {
      name:'named ROLES array field',
      change:(source)=>{source.roles['Private Role Dump']=secret;},
    },
    {
      name:'symbol USERS array field',
      change:(source)=>{source.users[Symbol('hidden-bearer')]=secret;},
    },
    {
      name:'nonenumerable ROLES array field',
      change:(source)=>Object.defineProperty(source.roles,'secret',{
        value:secret,enumerable:false,
      }),
    },
    {
      name:'array ownKeys Proxy error',
      change:(source)=>{source.users=new Proxy(source.users,{
        ownKeys(){throw new Error(secret);}
      });},
    },
  ];
  for(const {name,change} of modifiers){
    const source=sample();
    change(source);
    const result=auditLegacyStaffImport(source.users,source.roles);
    assert.equal(result.preflightPass,false,name);
    assert.deepEqual(result.issues,[{
      scope:'snapshot',row:null,code:'SNAPSHOT_INVALID',
    }],name);
    assert.equal(JSON.stringify(result).includes(secret),false,
      'no unreviewed array metadata or Proxy message may be returned');
  }
  const source=sample();
  assert.equal(auditLegacyStaffImport(source.users,source.roles).preflightPass,
    true,'ordinary dense source arrays must remain accepted');
});
