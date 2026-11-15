import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifyLegacyPassword} from '../src/modules/auth/legacy-password.js';

const UUID='123e4567-e89b-42d3-a456-426614174000';
const independentHash=(password,salt)=>createHash('sha256').update(password+salt,'utf8').digest('hex');

test('pinned Auth.gs states SHA256(password+salt) and exact hash compare',()=>{
  const original=readFileSync(new URL('../legacy/source/Auth.gs',import.meta.url),'utf8');
  assert.match(original,/hash:\s*sha256Hex_\(password \+ salt\)/);
  assert.match(original,/timingSafeEquals_\(sha256Hex_\(password \+ salt\), hash\)/);
  assert.match(original,/Utilities\.Charset\.UTF_8/);
});

test('correct synthetic legacy salted SHA-256 password verifies exactly',async()=>{
  const password='Example-Only-Secr3t!';
  const hash=independentHash(password,UUID);
  assert.equal(hash.length,64);
  assert.equal(await verifyLegacyPassword(password,hash,UUID),true);
  assert.equal(await verifyLegacyPassword(password+'x',hash,UUID),false);
  assert.equal(await verifyLegacyPassword(password,hash,UUID.toUpperCase()),false);
  assert.equal(await verifyLegacyPassword('wrong',hash,UUID),false);
});

test('UTF-8 Unicode and whitespace are byte-exact, not trimmed or normalized',async()=>{
  const password='  B\u00e9ngal\ud83d\udd12 \u09ac\u09be\u0982\u09b2\u09be  ';
  const h=independentHash(password,UUID);
  assert.equal(await verifyLegacyPassword(password,h,UUID),true);
  assert.equal(await verifyLegacyPassword(password.trim(),h,UUID),false);
  assert.equal(await verifyLegacyPassword(password.replace('\u00e9','e\u0301'),h,UUID),false);
  assert.equal(await verifyLegacyPassword(password.toLowerCase(),h,UUID),false);
});

test('stored digest must be exact lowercase 64-digit hex',async()=>{
  const password='Synthet1cOnly';
  const h=independentHash(password,UUID);
  for (const invalid of [
    h.toUpperCase(), ' '+h, h+'\n', h.slice(0,-1),h+'0',
    h.replace(/[a-f0-9]/,'g'), '', 'a'.repeat(64)+'x', null, undefined, 0,
  ]) assert.equal(await verifyLegacyPassword(password,invalid,UUID),false,String(invalid));
});

test('equal-length guesses with a changed first or last digest digit never match',async()=>{
  const pw='SomeStr0ng-Test-Only';
  const h=independentHash(pw,UUID);
  const change=c=>c==='0'?'1':'0';
  const first=change(h[0])+h.slice(1);
  const last=h.slice(0,63)+change(h[63]);
  assert.equal(first.length,64);
  assert.equal(last.length,64);
  assert.equal(await verifyLegacyPassword(pw,first,UUID),false);
  assert.equal(await verifyLegacyPassword(pw,last,UUID),false);
});

test('invalid missing, empty or non-string credentials always fail closed',async()=>{
  const hash=independentHash('x',UUID);
  for(const pw of [null,undefined,'',0,false,{},['x']])
    assert.equal(await verifyLegacyPassword(pw,hash,UUID),false);
  for(const salt of [null,undefined,'',0,false,{},['salt']])
    assert.equal(await verifyLegacyPassword('x',hash,salt),false);
});

test('password helper remains unregistered as any public RPC',()=>{
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/legacy-password|verifyLegacyPassword/);
  assert.doesNotMatch(worker,/legacy-password|verifyLegacyPassword/);
});

test('missing Web Crypto rejects rather than authorizing a valid legacy credential',async()=>{
  const password='Synthet1c-Only';
  const hash=independentHash(password,UUID);
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  assert.equal(descriptor?.configurable ?? true,true);
  Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
  try {
    await assert.rejects(verifyLegacyPassword(password,hash,UUID),/Web Crypto SHA-256 unavailable/);
  } finally {
    if(descriptor) Object.defineProperty(globalThis,'crypto',descriptor);
    else delete globalThis.crypto;
  }
});
