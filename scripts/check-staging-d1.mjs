#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const exactKeys = (obj, allowed, label) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Invalid '+label);
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) throw new Error('Unexpected '+label+' field: '+key);
};

/** A guard on the staging-only D1 configuration, NOT an authorization or migration operation. */
export function validateStagingConfig(staging, preview) {
  exactKeys(staging,['name','main','compatibility_date','workers_dev','assets','d1_databases'],'staging config');
  if(staging.name !== 'shererp-cloud-staging') throw new Error('Expected isolated staging Worker name');
  if(staging.main !== 'src/index.js' || staging.compatibility_date !== '2026-11-14') throw new Error('Unexpected staging entry/date');
  if(staging.workers_dev !== false) throw new Error('Staging workers_dev must be disabled until auth is implemented');
  exactKeys(staging.assets,['directory','binding','run_worker_first','not_found_handling'],'staging assets');
  if(staging.assets.directory !== './dist' || staging.assets.binding !== 'ASSETS' ||
     staging.assets.not_found_handling !== 'single-page-application' ||
     !Array.isArray(staging.assets.run_worker_first) || staging.assets.run_worker_first.length !== 1 || staging.assets.run_worker_first[0] !== '/api/*') {
    throw new Error('Unexpected staging static assets/routing');
  }
  if(!Array.isArray(staging.d1_databases) || staging.d1_databases.length !== 2) throw new Error('Staging requires exactly two D1 bindings');
  const db = staging.d1_databases[0];
  exactKeys(db,['binding','database_name','database_id','migrations_dir'],'staging database');
  if(db.binding !== 'DB' || db.database_name !== 'shererp-operational-staging-20261118' ||
     db.database_id !== '74102df7-dd31-4999-81d5-69bca42f0424') throw new Error('Unexpected staging database binding/name/id');
  if(db.migrations_dir !== 'migrations') throw new Error('Unexpected migration directory');
  const archive=staging.d1_databases[1];
  exactKeys(archive,['binding','database_name','database_id'],'private archive D1 binding');
  if(archive.binding !== 'HISTORY_ARCHIVE' ||
     archive.database_name !== 'shererp-legacy-history-staging-20261118' ||
     archive.database_id !== '19190fd2-1f5e-4e8a-a062-bd7a0cbf3d96' ||
     archive.database_id === db.database_id) {
    throw new Error('Unexpected private archive database binding/name/id');
  }
  exactKeys(preview,['name','main','compatibility_date','workers_dev','assets','previews'],'preview config');
  exactKeys(preview.previews, [], 'DB-free Worker Previews configuration');
  if(preview.name !== 'shererp-cloud-preview' || preview.name === staging.name) throw new Error('Preview and staging Workers must stay separate');
  return true;
}

if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const staging=JSON.parse(readFileSync(resolve(process.argv[2] || 'wrangler.staging.jsonc'),'utf8'));
    const preview=JSON.parse(readFileSync(resolve(process.argv[3] || 'wrangler.preview.jsonc'),'utf8'));
    validateStagingConfig(staging,preview);
    console.log('Staging config accepted: private Worker, separate D1 binding, no preview database exposure');
  }catch(err){ console.error('Staging D1 safety check failed: '+err.message); process.exitCode=1; }
}
