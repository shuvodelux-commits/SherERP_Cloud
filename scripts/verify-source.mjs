#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';

export async function verifySource(directory, manifestFile) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(manifestFile,'utf8'));
  if (!Array.isArray(manifest.files)) throw new Error('Invalid source manifest');
  const actual = (await readdir(root,{withFileTypes:true}))
    .filter((f)=>f.isFile() && /\.(gs|html)$/.test(f.name))
    .map((f)=>f.name).sort();
  const expected=manifest.files.map((f)=>f.path).sort();
  if (new Set(expected).size !== expected.length || expected.some((p)=>p!==basename(p))) {
    throw new Error('Duplicate or unsafe manifest path');
  }
  if (JSON.stringify(actual)!==JSON.stringify(expected)) {
    throw new Error('Snapshot path mismatch: missing or additional .gs/.html files');
  }
  for (const entry of manifest.files) {
    const data=await readFile(join(root,entry.path));
    const hash=createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex');
    if (data.length!==entry.byteSize || hash!==entry.blobSha) {
      throw new Error('Source blob mismatch: '+entry.path);
    }
  }
  return {verifiedFiles:expected.length};
}

if (process.argv[1] && resolve(process.argv[1])===new URL(import.meta.url).pathname) {
  try {
    const report=await verifySource(process.argv[2]||'legacy/source',process.argv[3]||'docs/baseline/source-manifest.json');
    console.log(JSON.stringify(report));
  } catch (error) {
    console.error('M00 verification failed: '+error.message);
    process.exitCode=1;
  }
}
