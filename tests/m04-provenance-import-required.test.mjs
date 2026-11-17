import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {importLegacyStaffSnapshotWithD1} from '../src/auth/d1-offline-staff-import.js';

const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update('SyntheticOfflineProvenance!'+SALT).digest('hex');
const admin=()=>({
  'User ID':'USR-SYNTH-PROV-ADMIN','Full Name':'Synthetic Administrator',
  'Mobile Number':'01700000501','Password Hash':HASH,'Password Salt':SALT,
  'Role':'Administrator','Status':'Active',
  'Created By':'First-run bootstrap','Created At':'2025-01-20T12:05:06.000Z',
  'Last Login':'',
});
const cashier=()=>({
  ...admin(),'User ID':'USR-SYNTH-PROV-CASH','Full Name':'Synthetic Cashier',
  'Mobile Number':'01700000502','Role':'Cashier',
  'Created By':'Source actor display text','Last Login':'2025-06-30T08:09:10.000Z',
});
const role=()=>({
  'Role ID':'ROL-SYNTH-PROV-1','Role Name':'Cashier',
  'Allowed Modules':'products',
  'Permissions':JSON.stringify({products:{view:true,add:false,edit:false,delete:'disabled'}}),
  'Status':'Active','Created At':'2025-01-20T12:06:07.000Z',
});
const snapshot=()=>({users:[admin(),cashier()],roles:[role()]});

const expectNoWrite=async(source)=>{
  let touched=0;
  const db={
    prepare(){touched++;throw Error('PRIVATE SQL CALL');},
    batch(){touched++;throw Error('PRIVATE D1 BATCH');},
  };
  await assert.rejects(()=>importLegacyStaffSnapshotWithD1(db,source),err=>{
    assert.equal(err.message,'Offline staff import rejected');
    return true;
  });
  assert.equal(touched,0,'unprovenanced source snapshot must be rejected BEFORE touching D1');
};

test('missing historical source staff and role fields are fail-closed before D1 access',async()=>{
  for(const key of ['Created By','Created At','Last Login']){
    const s=snapshot();
    delete s.users[1][key];
    await expectNoWrite(s);
  }
  const s=snapshot();
  delete s.roles[0]['Created At'];
  await expectNoWrite(s);
});

test('noncanonical or ambiguous historical date/actor metadata never reaches D1',async()=>{
  for(const [field,value] of [
    ['Created By',''],['Created At','2025-02-30T08:00:00.000Z'],
    ['Created At','2025-01-20T18:05:06.000+06:00'],
    ['Last Login',null],['Last Login','Never'],
  ]){
    const s=snapshot();s.users[0][field]=value;
    await expectNoWrite(s);
  }
  for(const value of ['',null,'2025-01-20T12:06:07Z']){
    const s=snapshot();s.roles[0]['Created At']=value;
    await expectNoWrite(s);
  }
});

test('original source Created By getter must never run and secrets never enter error output',async()=>{
  const s=snapshot();
  let getters=0;
  Object.defineProperty(s.users[0],'Created By',{
    get(){getters++;throw Error('PRIVATE CREATED BY');},enumerable:true,
  });
  await expectNoWrite(s);
  assert.equal(getters,0);
});

test('import remains disconnected from public Worker, preview D1 and arbitrary RPC',()=>{
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/d1-offline-staff-import|importLegacyStaffSnapshotWithD1/);
  const cfg=JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.d1_databases,undefined);
  const remote=readFileSync(new URL('../.github/workflows/remote-d1-staging.yml',import.meta.url),'utf8');
  assert.match(remote,/EXPECTED_REMOTE_MIGRATION_COUNT=2/);
});

test('protected source export rejects unknown, hidden, symbol and non-enumerable user/role header fields before D1',async()=>{
  const variants=[
    s=>{s.users[0]['Unexpected Future Column']='synthetic';},
    s=>{s.roles[0]['Unexpected Permissions Column']='synthetic';},
    s=>Object.defineProperty(s.users[1],'unreviewedPrivateValue',{
      enumerable:false,value:'SYNTHETIC_PRIVATE_VALUE'
    }),
    s=>{s.roles[0][Symbol('unexpected')]='synthetic';},
    s=>Object.defineProperty(s.users[0],'User ID',{
      enumerable:false,value:s.users[0]['User ID']
    }),
    s=>Object.defineProperty(s.roles[0],'Created At',{
      enumerable:false,value:s.roles[0]['Created At']
    }),
    s=>Object.defineProperty(s.roles[0],'futureSecret',{
      enumerable:true,get(){throw Error('PRIVATE_GETTER_EXECUTED');}
    })
  ];
  for(const mutate of variants){
    const s=snapshot();
    mutate(s);
    await expectNoWrite(s);
  }
});

test('malformed protected extra field cannot be accepted by readback reconciliation',async()=>{
  const {reconcileLegacyStaffSnapshotWithD1}=await import('../src/auth/d1-offline-staff-import.js');
  const s=snapshot();
  s.users[0]['New Source Permission']='not in pinned Config.gs';
  let queries=0;
  const db={prepare(){queries++;throw Error('PRIVATE SQL CALL');}};
  await assert.rejects(()=>reconcileLegacyStaffSnapshotWithD1(db,s),err=>{
    assert.equal(err.message,'Offline staff import rejected');
    assert.doesNotMatch(err.message,/Permission|PRIVATE|User ID|017/);
    return true;
  });
  assert.equal(queries,0);
});


test('protected export root must be exactly own enumerable users and roles before D1 access',async()=>{
  const malformed=[
    src=>{src.sessions=[{Token:'SYNTHETIC_SESSION_MUST_NOT_BE_IMPORTED'}];},
    src=>{src.unreviewedPrivateField='SYNTHETIC_PRIVATE_FIELD';},
    src=>Object.defineProperty(src,'hiddenFutureData',{
      value:'SYNTHETIC_HIDDEN',enumerable:false,
    }),
    src=>{src[Symbol('unreviewed')]='SYNTHETIC_SYMBOL';},
    src=>Object.defineProperty(src,'unreviewedGetter',{
      enumerable:true,get(){throw Error('PRIVATE_ROOT_GETTER_EXECUTED');},
    }),
    src=>Object.setPrototypeOf(src,{inheritedTrusted:false}),
  ];
  for(const change of malformed){
    const src=snapshot();
    change(src);
    await expectNoWrite(src);
  }
  // A hostile Proxy cannot supply an unverifiable list of root keys.
  const src=new Proxy(snapshot(),{
    ownKeys(){throw Error('PRIVATE_ROOT_KEYS_EXECUTED');},
  });
  await expectNoWrite(src);
});

test('ordinary and null-prototype exact snapshot roots reach read-only D1 preflight',async()=>{
  for(const src of [
    snapshot(),
    Object.assign(Object.create(null),snapshot()),
  ]){
    let inspected=0;
    const db={
      prepare(){
        inspected++;
        throw Error('SYNTHETIC_DB_PREFLIGHT_REACHED');
      },
      batch(){
        throw Error('Unexpected write');
      },
    };
    await assert.rejects(()=>importLegacyStaffSnapshotWithD1(db,src),
      err=>err.message==='SYNTHETIC_DB_PREFLIGHT_REACHED');
    assert.equal(inspected,1);
  }
});
