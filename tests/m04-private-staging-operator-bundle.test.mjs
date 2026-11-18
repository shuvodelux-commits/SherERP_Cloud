import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,lstatSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeM04PrivateStagingOperatorBundle} from '../scripts/prepare-m04-private-staging-operator.mjs';

test('private M04 operator config is isolated, ephemeral, nondeploying, and bound ONLY to reviewed staging D1',()=>{
 const base=mkdtempSync(join(tmpdir(),'m04-private-'));
 const target=join(base,'operator');
 try{
  const result=makeM04PrivateStagingOperatorBundle(target);
  assert.equal(result.prepared,true);
  assert.equal(result.remoteImportAuthorized,false);
  const config=JSON.parse(readFileSync(join(target,'wrangler.private.jsonc'),'utf8'));
  assert.equal(config.name,'shererp-m04-private-one-shot');
  assert.equal(config.workers_dev,false);
  assert.equal(config.routes,undefined);
  assert.equal(config.d1_databases.length,1);
  const db=config.d1_databases[0];
  assert.equal(db.database_name,'shererp-staging-db');
  assert.equal(db.database_id,'aa04618e-1639-4cb9-bdf5-7b967d8b968b');
  assert.equal(db.remote,true);
  assert.equal(db.binding,'DB');
  assert.equal(config.vars.M04_PRIVATE_SCOPE,'private-staging-one-shot');
  assert.equal(config.vars.M04_D1_UUID,db.database_id);
  assert.equal(config.vars.M04_IMPORT_TOKEN,undefined);
  const vars=readFileSync(join(target,'.dev.vars'),'utf8');
  assert.match(vars,/^M04_IMPORT_TOKEN=[A-Za-z0-9_-]{40,}\n$/);
  assert.equal(lstatSync(target).mode & 0o077,0);
  assert.equal(lstatSync(join(target,'.dev.vars')).mode & 0o077,0);
  assert.equal(lstatSync(join(target,'wrangler.private.jsonc')).mode & 0o077,0);
  assert.throws(()=>makeM04PrivateStagingOperatorBundle(target),/rejected/);
 }finally{rmSync(base,{recursive:true,force:true});}
});

test('M04 private config refuses repository-relative, target-reuse and short unsafe paths',()=>{
 assert.throws(()=>makeM04PrivateStagingOperatorBundle('relative'),/rejected/);
 assert.throws(()=>makeM04PrivateStagingOperatorBundle('/'),/rejected/);
 assert.throws(()=>makeM04PrivateStagingOperatorBundle(process.cwd()),/rejected/);
});
