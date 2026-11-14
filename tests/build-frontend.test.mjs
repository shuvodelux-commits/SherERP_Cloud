import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFrontend } from '../scripts/build-frontend.mjs';

const fixture = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'm01-ui-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  const sourceDir=join(dir,'legacy'),outputDir=join(dir,'dist');
  await mkdir(sourceDir);
  return {sourceDir,outputDir};
};

test('resolves nested includes without altering original order', async (t) => {
  const {sourceDir,outputDir}=await fixture(t);
  await writeFile(join(sourceDir,'index.html'), "A<?!= include('style'); ?>B<?!= include('page'); ?>C");
  await writeFile(join(sourceDir,'style.html'), '<style>body{margin:0}</style>');
  await writeFile(join(sourceDir,'page.html'), "<article>Page</article><?!= include('javascript') ?>");
  await writeFile(join(sourceDir,'javascript.html'), '<script>window.ready=true</script>');
  const output=await buildFrontend({sourceDir,outputDir});
  assert.equal(output.includeCount,3);
  assert.equal(await readFile(output.outputPath,'utf8'), 'A<style>body{margin:0}</style>B<article>Page</article><script>window.ready=true</script>C');
});

test('rejects missing include files', async (t) => {
  const {sourceDir,outputDir}=await fixture(t);
  await writeFile(join(sourceDir,'index.html'), "<?!= include('absent'); ?>");
  await assert.rejects(buildFrontend({sourceDir,outputDir}),/absent/);
});

test('rejects cycles and path traversal includes', async (t) => {
  const {sourceDir,outputDir}=await fixture(t);
  await writeFile(join(sourceDir,'index.html'), "<?!= include('loop'); ?>");
  await writeFile(join(sourceDir,'loop.html'), "<?!= include('index'); ?>");
  await assert.rejects(buildFrontend({sourceDir,outputDir}),/cycle/i);
  await writeFile(join(sourceDir,'index.html'), "<?!= include('../secrets'); ?>");
  await assert.rejects(buildFrontend({sourceDir,outputDir}),/unsupported|invalid/i);
});

test('fails on unexpanded Google template instructions', async (t) => {
  const {sourceDir,outputDir}=await fixture(t);
  await writeFile(join(sourceDir,'index.html'), '<div><?!= unsafeExpression ?></div>');
  await assert.rejects(buildFrontend({sourceDir,outputDir}),/unsupported/i);
});
