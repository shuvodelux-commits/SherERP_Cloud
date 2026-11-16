import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {importLegacyStaffSnapshotWithD1,reconcileLegacyStaffSnapshotWithD1} from
  '../src/auth/d1-offline-staff-import.js';

const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update('SyntheticNotRealSecret!'+SALT).digest('hex');
const admin=()=>({
  'User ID':'USR-SYNTH-1','Full Name':'Synthetic Administrator',
  'Mobile Number':'01700000101','Password Hash':HASH,'Password Salt':SALT,
  'Role':'Administrator','Status':'Active'
});
const cashier=()=>({
  ...admin(),'User ID':'USR-SYNTH-2','Full Name':'Synthetic Cashier',
  'Mobile Number':1712345678,'Role':'Cashier'
});
const role=()=>({
  'Role ID':'ROL-SYNTH-1','Role Name':'Cashier',
  'Allowed Modules':'products',
  'Permissions':JSON.stringify({products:{view:true,add:false,edit:false,delete:'disabled'}}),
  'Status':'Active'
});
const snapshot=()=>({users:[admin(),cashier()],roles:[role()]});

test('source contract preserves original ID keys, and the importer requires a private D1 binding',async()=>{
  const src=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  assert.match(src,/USERS:\s*\[\s*"User ID"/);
  assert.match(src,/ROLES:\s*\[\s*"Role ID"/);
  assert.equal(typeof importLegacyStaffSnapshotWithD1,'function');
  assert.equal(typeof reconcileLegacyStaffSnapshotWithD1,'function');
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(null,snapshot()),/Offline staff import unavailable/);
  await assert.rejects(()=>reconcileLegacyStaffSnapshotWithD1(null,snapshot()),/Offline staff import unavailable/);
});

test('invalid authority snapshots never touch D1 or disclose credentials',async()=>{
  const {users,roles}=snapshot();
  roles[0]['Allowed Modules']='products,users'; // mismatch with view-true grants
  let called=0;
  const db={prepare(){called++;throw Error('SQL SHOULD NOT EXECUTE');},batch(){called++;throw Error('SQL SHOULD NOT EXECUTE');}};
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(db,{users,roles}),error=>{
    assert.equal(error.message,'Offline staff import rejected');
    assert.doesNotMatch(error.message,/017|USR-|ROL-|Synthetic|products|SYNTH|Password/);
    return true;
  });
  assert.equal(called,0);
});

test('readback report is a fixed, redacted envelope and cannot expose source secrets',async()=>{
  const source=readFileSync(new URL('../src/auth/d1-offline-staff-import.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/console\.|\bfetch\(|\bgetAppShellData\b|\bhandleRpc\b/);
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(live,/d1-offline-staff-import|importLegacyStaffSnapshotWithD1/);
  const fake={prepare(){throw Error('PRIVATE SOURCE SECRET MUST NOT LEAK');}};
  await assert.rejects(()=>reconcileLegacyStaffSnapshotWithD1(fake,snapshot()),e=>{
    assert.equal(e.message,'Offline staff import readback unavailable');
    return true;
  });
});
