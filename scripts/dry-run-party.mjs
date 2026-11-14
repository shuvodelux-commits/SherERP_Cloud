#!/usr/bin/env node
/** Validates an explicit local export; NO D1 binding or file writes. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {planPartyImport} from '../src/party/party-import-plan.js';
async function main(){
  const input=process.argv[2];
  if(!input)throw new Error('Supply an explicit local source snapshot JSON path');
  const raw=await readFile(resolve(input),'utf8');
  const approved=process.argv[3]?JSON.parse(await readFile(resolve(process.argv[3]),'utf8')):[];
  const summary=planPartyImport(JSON.parse(raw),approved).summary;
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
}
main().catch(()=>{console.error('Party dry-run rejected: invalid or inaccessible input (details withheld to protect party data)');process.exitCode=1;});
