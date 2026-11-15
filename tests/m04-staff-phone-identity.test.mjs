import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {
  normalizeLegacyStaffPhoneDisplay,
  normalizeLegacyStaffPhoneSearch,
  legacyStaffPhonesEqual,
  findUniqueLegacyStaffPhone,
} from '../src/auth/staff-phone-identity.js';

const source=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const start=source.indexOf('function sanitizeInput_(str) {');
const end=source.indexOf('function isValidNonNegativeNumber_(value) {');
assert.ok(start>=0 && end>start,'Pinned Utils.gs helpers must be present');
const gas=runInNewContext(source.slice(start,end)+
  ';({display:normalizePhoneDisplay_,search:normalizePhoneSearch_,equal:phoneNumbersEqual_})',{});

test('pinned GAS mobile display/search helpers are source identical for synthetic fixtures',()=>{
  const cases=[
    null,undefined,'',' ','01712345678','1712345678',1712345678,
    '+8801712345678','8801712345678','০১৭১২৩৪৫৬৭৮','১৭১২৩৪৫৬৭৮',
    '০১৭-১২৩৪-৫৬৭৮','01 7123 456 78','+88 (017) 1234 5678',
    '01912345678','01312345678','01800000000','+12025550100',
    'prefix 01712345678 suffix','hello','১২৩','0171234567',' 1712345678 ',
  ];
  for(const input of cases) {
    assert.equal(normalizeLegacyStaffPhoneDisplay(input),gas.display(input),`display ${String(input)}`);
    assert.equal(normalizeLegacyStaffPhoneSearch(input),gas.search(input),`search ${String(input)}`);
  }
});

test('Sheets-damaged ten-digit Bangladesh mobile repairs display leading zero only',()=>{
  assert.equal(normalizeLegacyStaffPhoneDisplay(1712345678),'01712345678');
  assert.equal(normalizeLegacyStaffPhoneDisplay('1912345678'),'01912345678');
  assert.equal(normalizeLegacyStaffPhoneDisplay('1212345678'),'1212345678');
  assert.equal(normalizeLegacyStaffPhoneDisplay('+8801712345678'),'+8801712345678');
  assert.equal(normalizeLegacyStaffPhoneDisplay('০১৭১২৩৪৫৬৭৮'),'০১৭১২৩৪৫৬৭৮');
  assert.equal(normalizeLegacyStaffPhoneDisplay('  a  '),'a');
});

test('Bangla digits, +880 and separators compare equal without changing displayed text',()=>{
  const canonical='01712345678';
  for(const variant of [
    canonical,'1712345678',1712345678,'+8801712345678','8801712345678',
    '০১৭১২৩৪৫৬৭৮','১৭১২৩৪৫৬৭৮','(017) 1234-5678',' 017 1234 5678 ',
  ]) {
    assert.equal(normalizeLegacyStaffPhoneSearch(variant),canonical,`variant ${String(variant)}`);
    assert.equal(legacyStaffPhonesEqual(canonical,variant),true);
    assert.equal(legacyStaffPhonesEqual(variant,canonical),true);
    assert.equal(gas.equal(canonical,variant),true);
  }
});

test('source preserves unmatched numbers and rejects empty equality',()=>{
  for(const [a,b] of [[null,undefined],['',''],['foo','bar'],['01712345678','01812345678']]){
    assert.equal(legacyStaffPhonesEqual(a,b),false);
    assert.equal(legacyStaffPhonesEqual(a,b),gas.equal(a,b));
  }
  assert.equal(normalizeLegacyStaffPhoneSearch('০১৭ '),'017');
  assert.equal(normalizeLegacyStaffPhoneSearch('hello'),'');
  assert.equal(legacyStaffPhonesEqual('hello','hello'),false);
});

test('unique staff mobile index uses only explicit source Mobile Number field',()=>{
  const users=[
    {'Mobile Number':'01800000000','Full Name':'synthetic A'},
    {'Mobile Number':1712345678,'Full Name':'synthetic B'},
  ];
  const before=structuredClone(users);
  assert.deepEqual(findUniqueLegacyStaffPhone(users,'০১৭১২৩৪৫৬৭৮'),{status:'unique',index:1});
  assert.deepEqual(findUniqueLegacyStaffPhone(users,'01900000000'),{status:'none',index:null});
  assert.deepEqual(findUniqueLegacyStaffPhone(users,'hello'),{status:'none',index:null});
  assert.deepEqual(users,before);
});

test('ambiguous staff phone collisions deny a unique login identity',()=>{
  const users=[
    {'Mobile Number':'01712345678'},
    {'Mobile Number':'+8801712345678'},
    {'Mobile Number':'০১৭১২৩৪৫৬৭৮'},
  ];
  assert.deepEqual(findUniqueLegacyStaffPhone(users,'1712345678'),{status:'ambiguous',index:null});
  assert.deepEqual(findUniqueLegacyStaffPhone(users,'01712345678'),{status:'ambiguous',index:null});
});

test('malformed server staff records cannot be silently omitted to grant a unique match',()=>{
  const valid={'Mobile Number':'01712345678'};
  const bad=[
    undefined,null,false,'01712345678',{},Object.create({'Mobile Number':'01812345678'}),
  ];
  for(const record of bad)
    assert.deepEqual(findUniqueLegacyStaffPhone([valid,record],'01712345678'),{status:'invalid-record',index:null});
  const accessor={};
  Object.defineProperty(accessor,'Mobile Number',{get(){throw new Error('getter invoked')},enumerable:true});
  assert.deepEqual(findUniqueLegacyStaffPhone([valid,accessor],'01712345678'),{status:'invalid-record',index:null});
  const proxy=new Proxy({}, {getOwnPropertyDescriptor(){throw new Error('proxy trap')}});
  assert.deepEqual(findUniqueLegacyStaffPhone([valid,proxy],'01712345678'),{status:'invalid-record',index:null});
});

test('untrusted non-array staff snapshots do not look like an empty roster',()=>{
  for(const invalid of [undefined,null,{},false,'',0,new Set()])
    assert.deepEqual(findUniqueLegacyStaffPhone(invalid,'01712345678'),{status:'invalid-record',index:null});
});

test('internal helper never creates Party links or activates public auth RPC',async()=>{
  const code=readFileSync(new URL('../src/auth/staff-phone-identity.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\bfetch\(|\bconsole\.|\.prepare\(|\b(createParty|mergeParty|linkParty|createSession)\s*\(/);
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/staff-phone-identity|findUniqueLegacyStaffPhone/);
  assert.doesNotMatch(worker,/staff-phone-identity|findUniqueLegacyStaffPhone/);
  const {default:app}=await import('../src/index.js');
  const origin='https://preview.shererp.invalid';
  const result=await app.fetch(new Request(origin+'/api/rpc',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'login',args:['01712345678','synthetic']}),
  }),{});
  assert.equal(result.status,501);
});
