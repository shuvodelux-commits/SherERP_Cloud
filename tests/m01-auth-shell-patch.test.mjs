import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchServerCall} from '../scripts/patch-rpc.mjs';
import {patchAuthenticatedShellCall} from '../scripts/patch-auth-shell.mjs';

const source=readFileSync(new URL('../legacy/source/javascript.html',import.meta.url),'utf8');

test('compiled source app-shell request requires an issued bearer and retains original login/restore handlers',()=>{
  const original=patchServerCall(source);
  const result=patchAuthenticatedShellCall(original);
  assert(!result.includes("appShellDataPromise_ = serverCall('getAppShellData').catch"));
  assert(result.includes("serverCall('getAppShellData', authToken)"));
  assert(result.includes('if (!authToken) return Promise.reject('));
  assert(result.includes("withLoader(serverCall('validateSession', saved))"));
  assert(result.includes("withLoader(serverCall('login', mobile, password))"));
  assert(result.includes("var saved = readStoredToken_();"));
  assert(result.includes("function brandLoginScreen_()"));
  assert(result.includes("function doLogout_()"));
  assert(!original.includes("serverCall('getAppShellData', authToken)"));
  assert.equal(source.includes("serverCall('getAppShellData', authToken)"),false);
});

test('patch stays idempotent and refuses changed/no source boundaries',()=>{
  const patched=patchAuthenticatedShellCall(patchServerCall(source));
  assert.equal(patchAuthenticatedShellCall(patched),patched);
  assert.throws(()=>patchAuthenticatedShellCall('getAppShellData'),/source|shell|changed|missing/i);
});
