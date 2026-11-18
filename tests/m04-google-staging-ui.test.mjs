import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

test('the opt-in Google build retains the password form and leaves normal assets untouched',async()=>{
  const root=await mkdtemp(join(tmpdir(),'shererp-google-ui-'));
  const plain=join(root,'plain');
  const google=join(root,'google');
  await mkdir(plain);
  execFileSync(process.execPath,['scripts/build-frontend.mjs','legacy/source',plain]);
  execFileSync(process.execPath,['scripts/patch-rpc.mjs',join(plain,'index.html')]);
  execFileSync(process.execPath,['scripts/patch-auth-shell.mjs',join(plain,'index.html')]);
  const before=await readFile(join(plain,'index.html'),'utf8');
  execFileSync(process.execPath,['scripts/build-staging-google-ui.mjs',plain,google]);
  assert.equal(await readFile(join(plain,'index.html'),'utf8'),before);
  assert.doesNotMatch(before,/shererp-google-signin/);
  const staged=await readFile(join(google,'index.html'),'utf8');
  assert.match(staged,/id="loginMobile"/);
  assert.match(staged,/id="loginPassword"/);
  assert.match(staged,/id="shererp-google-signin"/);
  assert.match(staged,/src="\/staging-google-signin.js"/);
  const script=await readFile(join(google,'staging-google-signin.js'),'utf8');
  assert.match(script,/\/api\/auth\/google\/logout/);
  assert.doesNotMatch(script,/localStorage|sessionStorage/);
});
