#!/usr/bin/env node
/**
 * M10-14 private/local evidence review ONLY. No network, D1, original Sheets,
 * credentials, remote data writes, output files, or production GO permissions.
 *
 * Accept one explicitly authorized regular local JSON file and output only
 * the pure comparator's aggregate, redacted issues. All errors are fixed-text.
 */
import {lstat,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {assessM10GrossPartyReconciliation} from
  '../src/migration/m10-gross-party-reconcile.js';

const ERROR='M10 local gross Party evidence rejected\n';
const MAX_INPUT_BYTES=64*1024*1024;

async function main(){
  try{
    const args=process.argv.slice(2);
    if(args.length!==1||!args[0]||args[0].startsWith('-'))
      throw new Error('invalid argument count');
    const file=resolve(args[0]);
    // Explicit regular files only: no symlinks, device files, FIFO or remote URL.
    const stat=await lstat(file);
    if(!stat.isFile()||stat.size<1||stat.size>MAX_INPUT_BYTES)
      throw new Error('unsupported evidence input');
    const raw=await readFile(file,'utf8');
    const report=assessM10GrossPartyReconciliation(JSON.parse(raw));
    process.stdout.write(JSON.stringify(report)+'\n');
    if(!report.candidateGrossParity)process.exitCode=2;
  }catch{
    // Do not leak source rows, original IDs, phone numbers, sums or file paths.
    process.stderr.write(ERROR);
    process.exitCode=2;
  }
}
await main();
