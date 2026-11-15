import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {verifyLegacyPassword} from '../src/auth/legacy-password.js';

const SALT='9c1bc30f-2d45-4a02-821b-2a0e8b3476e3';
const referenceHash=(password,salt=SALT)=>createHash('sha256')
  .update(password+salt,'utf8').digest('hex');

test('verifies original GAS salted SHA256 source vector through Web Crypto',async()=>{
  const correct=referenceHash('hardwareERP2026!');
  assert.match(correct,/^[0-9a-f]{64}$/);
  assert.equal(await verifyLegacyPassword('hardwareERP2026!',correct,SALT),true);
  assert.equal(await verifyLegacyPassword('wrong-password',correct,SALT),false);
  assert.equal(await verifyLegacyPassword('hardwareERP2026!',correct,SALT.slice(0,-1)+'0'),false);
});

test('preserves UTF-8, Bengali, emoji and original byte ordering without normalization',async()=>{
  const password='পাসওয়ার্ড🔐💡';
  const digest=referenceHash(password);
  assert.equal(await verifyLegacyPassword(password,digest,SALT),true);
  assert.equal(await verifyLegacyPassword(password+' ',digest,SALT),false);
  assert.equal(await verifyLegacyPassword(password.normalize('NFD'),digest,SALT),
    password.normalize('NFD')===password);
});

test('preserves case and whitespace and does not trim password or UUID salt',async()=>{
  const password='  Exact Case  ';
  const digest=referenceHash(password);
  assert.equal(await verifyLegacyPassword(password,digest,SALT),true);
  assert.equal(await verifyLegacyPassword(password.trim(),digest,SALT),false);
  assert.equal(await verifyLegacyPassword(password.toLowerCase(),digest,SALT),false);
  assert.equal(await verifyLegacyPassword(password,digest,SALT.toUpperCase()),false);
});

test('low-level verifier preserves source empty password hash but public login remains separate',async()=>{
  assert.equal(await verifyLegacyPassword('',referenceHash(''),SALT),true);
  assert.equal(await verifyLegacyPassword('',referenceHash('x'),SALT),false);
});

test('compares all 64 lowercase hex digits and rejects altered first or last nibble',async()=>{
  const hash=referenceHash('correct!');
  const first=(hash[0]==='0'?'1':'0')+hash.slice(1);
  const last=hash.slice(0,-1)+(hash.at(-1)==='0'?'1':'0');
  assert.equal(await verifyLegacyPassword('correct!',first,SALT),false);
  assert.equal(await verifyLegacyPassword('correct!',last,SALT),false);
});

test('malformed stored hex or non-string fields fail closed without throwing or coercing',async()=>{
  const hash=referenceHash('password');
  for(const badHash of [hash.toUpperCase(),hash.slice(1),hash+'f','Z'.repeat(64),'',null,undefined,17,{}]) {
    assert.equal(await verifyLegacyPassword('password',badHash,SALT),false);
  }
  for(const [p,s] of [[null,SALT],[undefined,SALT],[1234,SALT],['password',null],['password',1234],['password','']]) {
    assert.equal(await verifyLegacyPassword(p,hash,s),false);
  }
});

test('helper remains internal: no database, public RPC, cookie, logging, or legacy hash issuance',()=>{
  const code=readFileSync(new URL('../src/auth/legacy-password.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\bconsole\.|\bfetch\(|\bDB\b|\.prepare\(|\bSet-Cookie\b|\bgetAppShellData\b/);
  assert.doesNotMatch(code,/export (async )?function (hashPassword|createPassword|login|createSession)/);
  const deployed=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(deployed.includes('verifyLegacyPassword'),false);
  assert.equal(registry.includes('verifyLegacyPassword'),false);
});
