import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {test} from 'node:test';
import {createOfflinePasswordCredential} from '../src/auth/d1-auth-core.js';

test('hosted Workers restriction preserves the existing PBKDF2-SHA256 credential format',async(t)=>{
  t.mock.method(crypto.subtle,'deriveBits',async({iterations})=>{
    assert.equal(iterations,210_000);
    throw new DOMException('PBKDF2 iteration limit','NotSupportedError');
  });
  const password='synthetic-পাসওয়ার্ড-fixture';
  const credential=await createOfflinePasswordCredential(password);
  const expected=pbkdf2Sync(password,Buffer.from(credential.passwordSalt,'hex'),210_000,32,'sha256');
  assert.equal(credential.iterations,210_000);
  assert.equal(credential.passwordHash,expected.toString('hex'));
});

test('unexpected Web Crypto failures propagate',async(t)=>{
  const failure=new DOMException('Synthetic failure','OperationError');
  t.mock.method(crypto.subtle,'deriveBits',async()=>{throw failure;});
  await assert.rejects(createOfflinePasswordCredential('synthetic-password'),error=>error===failure);
});
