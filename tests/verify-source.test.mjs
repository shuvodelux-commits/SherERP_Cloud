import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const cli = new URL('../scripts/verify-source.mjs', import.meta.url).pathname;
const blobSha = (text) => createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0').update(text).digest('hex');

test('verifies an exact source snapshot and rejects modified or extra files', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'm00-verify-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  await writeFile(join(dir,'A.gs'), 'function hello() {}\n');
  const manifest = {files:[{path:'A.gs', blobSha:blobSha('function hello() {}\n'),byteSize:20}]};
  const path = join(dir,'manifest.json');
  await writeFile(path, JSON.stringify(manifest));
  const run=()=>spawnSync(process.execPath,[cli,dir,path],{encoding:'utf8'});
  assert.equal(run().status,0);
  await writeFile(join(dir,'A.gs'), 'function changed() {}\n');
  assert.notEqual(run().status,0);
  await writeFile(join(dir,'A.gs'), 'function hello() {}\n');
  await writeFile(join(dir,'B.html'), '<p>unexpected</p>');
  assert.notEqual(run().status,0);
});
