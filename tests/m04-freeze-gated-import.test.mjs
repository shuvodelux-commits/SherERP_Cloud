import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as offline from '../src/auth/d1-offline-staff-import.js';

const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update('SyntheticFreezeRehearsalOnly!'+SALT).digest('hex');
const user=(id,phone,role)=>({
  'User ID':id,'Full Name':'Synthetic '+id,'Mobile Number':phone,
  'Password Hash':HASH,'Password Salt':SALT,
  'Role':role,'Status':'Active','Created By':'First-run bootstrap',
  'Created At':'2025-01-20T12:05:06.000Z','Last Login':'',
});
const source=()=>({
  users:[
    user('USR-FRZ-ADMIN','01790000651','Administrator'),
    {...user('USR-FRZ-CASH',1790000652,'Cashier'),'Created By':'Source actor text','Last Login':'2025-06-30T08:09:10.000Z'},
  ],
  roles:[{
    'Role ID':'ROL-FRZ-CASH','Role Name':'Cashier','Status':'Active',
    'Allowed Modules':'products',
    'Permissions':JSON.stringify({products:{view:true,add:false,edit:false,delete:'disabled'}}),
    'Created At':'2025-01-20T12:06:07.000Z',
  }],
});
async function mustRejectWithoutD1(first,confirmation){
  let io=0;
  const db={prepare(){io++;throw Error('SENSITIVE_SQL_PREPARE');},
    batch(){io++;throw Error('SENSITIVE_SQL_BATCH');}};
  assert.equal(typeof offline.rehearseFrozenLegacyStaffImportWithD1,'function');
  await assert.rejects(
    ()=>offline.rehearseFrozenLegacyStaffImportWithD1(db,first,confirmation),
    e=>e?.message==='Offline staff import rejected'
  );
  assert.equal(io,0,'reject source mismatch before DB read as well as before write');
}

test('freeze-gated importer requires two genuinely distinct supplied snapshot objects',async()=>{
  const s=source();
  await mustRejectWithoutD1(s,s);
});
test('two wrapper objects sharing source USERS or ROLES arrays are not independent snapshots',async()=>{
  const first=source();
  const sharedUsers={users:first.users,roles:structuredClone(first.roles)};
  await mustRejectWithoutD1(first,sharedUsers);
  const sharedRoles={users:structuredClone(first.users),roles:first.roles};
  await mustRejectWithoutD1(first,sharedRoles);
});

test('freeze-gated importer rejects added, removed or reordered staff before touching D1',async()=>{
  const s=source(),second=structuredClone(s);second.users.reverse();
  await mustRejectWithoutD1(s,second);
  const s2=source(),second2=structuredClone(s2);second2.users.pop();
  await mustRejectWithoutD1(s2,second2);
});
test('freeze-gated importer rejects source credential, role permission and history drift',async()=>{
  for(const edit of [
    s=>{s.users[1]['Password Hash']='ab'.repeat(32);},
    s=>{s.users[1]['Last Login']='2025-07-01T08:09:10.000Z';},
    s=>{s.roles[0]['Permissions']=JSON.stringify({products:{view:true,add:true,edit:false,delete:'disabled'}});},
    s=>{s.roles[0]['Created At']='2025-01-21T12:06:07.000Z';},
  ]){
    const first=source(),second=structuredClone(first);
    edit(second);
    await mustRejectWithoutD1(first,second);
  }
});
test('freeze-gated importer fails closed on invalid and accessor exports without invoking getters',async()=>{
  const s=source(),t=structuredClone(s);t.users[0]['Created By']='';
  await mustRejectWithoutD1(s,t);
  const first=source(),second=structuredClone(first);
  let invoked=0;
  Object.defineProperty(second.users[0],'Full Name',{
    enumerable:true,get(){invoked++;throw Error('PRIVATE-SOURCE-ROW');},
  });
  await mustRejectWithoutD1(first,second);
  assert.equal(invoked,0);
});
