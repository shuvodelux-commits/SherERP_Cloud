#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const EXPECTED_NAME='shererp-staging-db';
export const EXPECTED_UUID='aa04618e-1639-4cb9-bdf5-7b967d8b968b';
export const EXPECTED_ARCHIVE_NAME='shererp-legacy-history-staging-20261118';
export const EXPECTED_ARCHIVE_UUID='3328e5c8-7695-4d6c-8bcf-9725437ebdd5';

export function assertExactD1Resource(data){
  const items=Array.isArray(data)?data:data?.result;
  if(!Array.isArray(items))throw new Error('Invalid remote database list');
  const matching=items.filter(x=>x?.name===EXPECTED_NAME);
  if(matching.length!==1)throw new Error('Expected exactly one staging database name');
  if(matching[0].uuid!==EXPECTED_UUID)throw new Error('Staging database identity/UUID mismatch');
  if(items.filter(x=>x?.uuid===EXPECTED_UUID).length!==1)throw new Error('Staging UUID is not uniquely resolved');
  const archives=items.filter(x=>x?.name===EXPECTED_ARCHIVE_NAME);
  if(archives.length!==1||archives[0].uuid!==EXPECTED_ARCHIVE_UUID)
    throw new Error('Private archive database identity/UUID mismatch');
  if(items.filter(x=>x?.uuid===EXPECTED_ARCHIVE_UUID).length!==1||
     EXPECTED_ARCHIVE_UUID===EXPECTED_UUID)
    throw new Error('Private archive UUID is not uniquely resolved');
  return true;
}

function queryRow(data){
  const results=Array.isArray(data)?data:[data];
  if(results.length!==1 || results[0]?.success!==true ||
    !Array.isArray(results[0].results) || results[0].results.length!==1) {
    throw new Error('Invalid or failed remote D1 query result');
  }
  return results[0].results[0];
}

export function assertSafePreflight(data,requireEmpty=false){
  const n=queryRow(data).existing_user_tables;
  if(!Number.isInteger(n)||n<0)throw new Error('Invalid remote D1 table count');
  if(requireEmpty&&n!==0)throw new Error('Remote database is not empty; refusing to apply reviewed initial migrations');
  return n;
}

export function assertRecoveryBookmark(data){
  const bookmark=data?.bookmark??data?.result?.bookmark;
  if(typeof bookmark!=='string'|| !/^[a-zA-Z0-9-]{28,128}$/.test(bookmark))throw new Error('Missing valid pre-migration Time Travel bookmark');
  return true;
}

export function assertRemoteSchema(data){
  const row=queryRow(data);
  if(row.app_tables!==7||row.applied_migrations!==2||row.history_triggers!==4){
    throw new Error('Remote D1 schema mismatch after migration');
  }
  return true;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [mode,filename]=process.argv.slice(2);
    if(!filename)throw new Error('Explicit output file required');
    const data=JSON.parse(readFileSync(resolve(filename),'utf8'));
    if(mode==='verify-identity'){
      assertExactD1Resource(data);
      console.log('Verified remote D1 identity matches the staging database UUID');
    }else if(mode==='inspect'||mode==='assert-empty'){
      const count=assertSafePreflight(data,mode==='assert-empty');
      console.log('Remote D1 non-system table count:',count);
    }else if(mode==='bookmark'){
      assertRecoveryBookmark(data);
      const bookmark=data?.bookmark??data?.result?.bookmark;
      console.log('PRE-MIGRATION RECOVERY BOOKMARK:',bookmark);
      console.log('Do not restore automatically; a restore overwrites the remote database');
    }else if(mode==='verify-schema'){
      assertRemoteSchema(data);
      console.log('Verified remote staging D1: 7 app tables, 2 migrations, 4 history-protection triggers');
    }else throw new Error('Unknown remote staging verification operation');
  }catch(e){console.error('Staging migration guard refused operation: '+e.message);process.exitCode=1;}
}
