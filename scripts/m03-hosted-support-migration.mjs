#!/usr/bin/env node
/**
 * Reuse the reviewed support audit SQL in an existing hosted Control D1
 * migration sequence. Writes an ignored, operator-local migration only.
 * No Cloudflare API, credentials, D1 writes, or runtime billing features.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const SOURCE='staging-migrations/platform-support/0001_support_grants_and_events.sql';
const EXPECTED='d9e3d537ea409191e3e318463b278e37333fc80920edd5a4276d0d3ecf17d1f9';
export const MIGRATION_NAME='0014_hosted_support_grants_and_events.sql';

export async function generateHostedSupportMigration(directory,root=ROOT){
  const target=resolve(directory);
  if(!target.startsWith(resolve(root,'.wrangler')+'/'))
    throw Error('PRIVATE_MIGRATION_DIRECTORY_REQUIRED');
  const sql=await readFile(join(root,SOURCE),'utf8');
  if(createHash('sha256').update(sql).digest('hex')!==EXPECTED)
    throw Error('REVIEWED_SUPPORT_SQL_CHECKSUM_MISMATCH');
  const path=join(target,'control',MIGRATION_NAME);
  await mkdir(join(target,'control'),{recursive:true,mode:0o700});
  try{await writeFile(path,sql,{flag:'wx',mode:0o600});}
  catch(error){
    if(error.code!=='EEXIST'||await readFile(path,'utf8')!==sql)
      throw Error('SUPPORT_MIGRATION_OUTPUT_CONFLICT');
  }
  return path;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv[2]!=='--generate'||process.argv.length!==4)
    throw Error('Usage: --generate <.wrangler/hosted-pilot/migrations>');
  await generateHostedSupportMigration(process.argv[3]);
  console.log('Prepared one pinned, private Support D1 migration; NO remote write');
}
