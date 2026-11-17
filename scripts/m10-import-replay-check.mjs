#!/usr/bin/env node
/**
 * M10-16 — local-only, read-only 49-group replay candidate preflight.
 * Cannot read source Sheets, query D1, replay an import, rollback any data,
 * authorize private export, or activate remote/prod services.
 */
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {assessM10ImportReplayEvidence} from
  '../src/migration/m10-import-replay-evidence.js';

const ERROR='M10 local import replay evidence rejected\n';
const MAX_BYTES=64*1024*1024;

async function main(){
  try{
    const args=process.argv.slice(2);
    if(args.length!==1||!args[0]||args[0].startsWith('-'))
      throw new Error('requires explicit local file');
    const input=resolve(args[0]);
    // Open once with no-follow, then inspect *that same descriptor* to avoid
    // symlink replacement between lstat and readFile.
    const handle=await open(input,constants.O_RDONLY|constants.O_NOFOLLOW);
    let raw;
    try{
      const st=await handle.stat();
      if(!st.isFile()||st.size<1||st.size>MAX_BYTES)
        throw new Error('invalid local evidence file');
      raw=await handle.readFile({encoding:'utf8'});
    }finally{await handle.close();}
    const report=assessM10ImportReplayEvidence(JSON.parse(raw));
    process.stdout.write(JSON.stringify(report)+'\n');
    if(!report.candidateReplayEvidence)process.exitCode=2;
  }catch{
    // Never echo private file paths, source IDs, rows, digests or errors.
    process.stderr.write(ERROR);
    process.exitCode=2;
  }
}
await main();
