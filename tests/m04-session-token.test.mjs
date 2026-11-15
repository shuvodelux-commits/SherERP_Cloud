import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {
  createOpaqueSessionToken,
  hashOpaqueSessionToken,
} from '../src/auth/session-token.js';

const tokenPattern=/^[0-9a-f]{64}$/;
const independentDigest=(token)=>createHash('sha256').update(token,'utf8').digest('hex');

test('original GAS generates an opaque 64-character hex bearer token from two UUIDs',()=>{
  const source=readFileSync(new URL('../legacy/source/Auth.gs',import.meta.url),'utf8');
  const portion=source.match(/function generateToken_\(\)\s*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(portion);
  assert.equal((portion.match(/Utilities\.getUuid\(\)\.replace\(\/-\/g,/g)??[]).length,2);
});

test('minted tokens are 32 cryptographically random bytes encoded as 64 lowercase hex',()=>{
  const observed=new Set();
  for(let i=0;i<32;i++){
    const token=createOpaqueSessionToken();
    assert.match(token,tokenPattern);
    assert.equal(token.length,64);
    observed.add(token);
  }
  assert.equal(observed.size,32);
});

test('hashes valid bearer token by exact UTF-8 SHA256, preserving leading zero digest bytes',async()=>{
  const token='0000000000000000000000000000000000000000000000000000000000000014';
  const expected='087bee4b25350ee462142f6270ae6f453ee5bcbd2d7ccb5f0a2223602897c088';
  assert.equal(independentDigest(token),expected);
  assert.equal(await hashOpaqueSessionToken(token),expected);
  const minted=createOpaqueSessionToken();
  assert.equal(await hashOpaqueSessionToken(minted),independentDigest(minted));
  assert.notEqual(await hashOpaqueSessionToken(minted),minted);
});

test('reject malformed, uppercase, non-string and whitespace tokens without hashing',async()=>{
  for(const invalid of [
    undefined,null,'',false,123,{},[], 'A'.repeat(64),'g'.repeat(64),
    'a'.repeat(63),'a'.repeat(65),' '+ 'a'.repeat(64), 'a'.repeat(64)+'\n',
  ]) assert.equal(await hashOpaqueSessionToken(invalid),null);
});

async function withCrypto(value,work) {
  const prior=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  assert.ok(!prior || prior.configurable,'Node test runtime crypto must be configurable');
  Object.defineProperty(globalThis,'crypto',{value,configurable:true});
  try { return await work(); }
  finally {
    if(prior) Object.defineProperty(globalThis,'crypto',prior);
    else delete globalThis.crypto;
  }
}

test('missing crypto cannot mint or hash a valid token',async()=>{
  await withCrypto(undefined,async()=>{
    assert.throws(createOpaqueSessionToken,/Web Crypto/);
    await assert.rejects(hashOpaqueSessionToken('a'.repeat(64)),/Web Crypto/);
  });
});

test('getRandomValues failure does not downgrade to predictable randomness',async()=>{
  const broken={getRandomValues(){throw new Error('injected CSPRNG failure')}};
  await withCrypto(broken,async()=>{
    assert.throws(createOpaqueSessionToken,/injected CSPRNG failure/);
  });
});

test('minting reads exactly 32 Web Crypto random bytes (not Math.random or UUID time)',async()=>{
  let calls=0;
  const cryptoDouble={getRandomValues(bytes) {
    calls++;
    assert.equal(bytes.length,32);
    bytes.fill(7);
    return bytes;
  }};
  await withCrypto(cryptoDouble,async()=>{
    assert.equal(createOpaqueSessionToken(),'07'.repeat(32));
    assert.equal(calls,1);
  });
});

test('token primitive remains internal: no Worker routing, persistence, logs or insecure RNG',()=>{
  const source=readFileSync(new URL('../src/auth/session-token.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Math\.random|Date\.now|console\.|\.prepare\(|\bfetch\(/);
  assert.match(source,/getRandomValues/);
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(registry,/session-token|createOpaqueSessionToken|hashOpaqueSessionToken/);
  assert.doesNotMatch(worker,/session-token|createOpaqueSessionToken|hashOpaqueSessionToken/);
});
