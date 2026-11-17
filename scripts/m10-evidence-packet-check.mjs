#!/usr/bin/env node
/**
 * M10-15: authorized local OFFLINE evidence packet review ONLY.
 * No source Sheets, network, D1, secrets, writes or production cutover.
 * Outputs fixed redacted aggregate codes and candidate flags only.
 */
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {assessM10EvidencePacket} from '../src/migration/m10-evidence-packet.js';

const ERROR='M10 offline evidence packet rejected\n';
const MAX_BYTES=64*1024*1024;

async function main(){
  try{
    const args=process.argv.slice(2);
    if(args.length!==1||!args[0]||args[0].startsWith('-'))
      throw new Error('invalid command');
    const file=resolve(args[0]);
    // O_NOFOLLOW is important: checking a path and opening it separately
    // permits symlink substitution between operations.
    const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
    let raw;
    try{
      const stat=await handle.stat();
      if(!stat.isFile()||stat.size<1||stat.size>MAX_BYTES)
        throw new Error('unsupported input');
      raw=await handle.readFile({encoding:'utf8'});
    }finally{
      await handle.close();
    }
    const report=assessM10EvidencePacket(JSON.parse(raw));
    process.stdout.write(JSON.stringify(report)+'\n');
    if(!report.candidateEvidenceComplete)process.exitCode=2;
  }catch{
    // No raw source rows, IDs, contracts, metrics, exceptions or paths escape.
    process.stderr.write(ERROR);
    process.exitCode=2;
  }
}
await main();
