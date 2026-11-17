import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFrontend} from '../scripts/build-frontend.mjs';
import {patchM01Accessibility} from '../scripts/patch-m01-a11y.mjs';

test('compiled M01 accessibility transform is deterministic, idempotent and rejects source drift',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'m01-a11y-unit-'));
  try{
    const {outputPath}=await buildFrontend({
      sourceDir:new URL('../legacy/source/',import.meta.url).pathname,
      outputDir:dir
    });
    const raw=await readFile(outputPath,'utf8');
    const patched=patchM01Accessibility(raw);
    assert.notEqual(patched,raw,'original generated UI should need the accessibility patch');
    assert.match(patched,/<html lang="en">/);
    assert.match(patched,/<label for="loginMobile">Mobile Number<\/label>/);
    assert.match(patched,/<label for="loginPassword">Password<\/label>/);
    assert.equal(patchM01Accessibility(patched),patched,
      're-running a compiled patch must be a safe no-op');
    assert.throws(()=>patchM01Accessibility(raw.replace(
      '<!DOCTYPE html>\n<html>\n<head>',
      '<!DOCTYPE html>\n<html data-unreviewed="change">\n<head>'
    )),/boundary missing or ambiguous/,'unreviewed original template drift must be refused');
    assert.throws(()=>patchM01Accessibility(raw.replace(
      '<!DOCTYPE html>\n<html>\n<head>',
      '<!DOCTYPE html>\n<html>\n<head><head>'
    )),/boundary missing or ambiguous|original/,'bad markup is not accepted');
  }finally{await rm(dir,{force:true,recursive:true});}
});
