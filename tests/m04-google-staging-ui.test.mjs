import assert from 'node:assert/strict';
import {mkdtemp,readFile,mkdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {test} from 'node:test';

test('the opt-in Google build retains the password form and leaves normal assets untouched',async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'shererp-google-ui-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
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
  assert.match(script,/call\('\/logout',\{method:'POST'\}/);
  assert.doesNotMatch(script,/localStorage|sessionStorage/);
});

test('the staging builder cannot overwrite the target of a linked input page',async(t)=>{
  const root=await mkdtemp(join(tmpdir(),'shererp-google-ui-link-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const plain=join(root,'plain');
  const target=join(root,'original.html');
  const html='<body><p class="login-footnote">Original</p></body></html>';
  await mkdir(plain);
  await writeFile(target,html);
  await symlink(target,join(plain,'index.html'));
  const run=spawnSync(process.execPath,['scripts/build-staging-google-ui.mjs',plain,join(root,'staging')]);
  assert.equal(await readFile(target,'utf8'),html);
  assert.notEqual(run.status,0);
});
