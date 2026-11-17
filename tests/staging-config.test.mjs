import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateStagingConfig} from '../scripts/check-staging-d1.mjs';

const staging = JSON.parse(readFileSync(new URL('../wrangler.staging.jsonc', import.meta.url), 'utf8'));
const preview = JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc', import.meta.url), 'utf8'));

test('staging binding is isolated, non-public and points only to the chosen D1 database', () => {
  assert.equal(validateStagingConfig(staging, preview), true);
  assert.equal(staging.d1_databases[0].database_id, '74102df7-dd31-4999-81d5-69bca42f0424');
  assert.equal(staging.d1_databases[1].database_id, '19190fd2-1f5e-4e8a-a062-bd7a0cbf3d96');
});
test('never permit public staging routes or production Worker name', () => {
  assert.throws(() => validateStagingConfig({...staging,workers_dev:true},preview), /workers_dev/);
  assert.throws(() => validateStagingConfig({...staging,routes:['example.com/*']},preview), /unexpected|route/);
  assert.throws(() => validateStagingConfig({...staging,name:'shererp-cloud'},preview), /staging/);
  assert.throws(() => validateStagingConfig({...staging,name:'shererp-cloud-preview'},preview), /staging/);
});
test('reject wrong binding, database, id, migrations path or extra resources',()=>{
  const altered=(change)=>({...staging,d1_databases:[{...staging.d1_databases[0],...change},staging.d1_databases[1]]});
  assert.throws(()=>validateStagingConfig(altered({binding:'PROD_DB'}),preview), /binding|database/);
  assert.throws(()=>validateStagingConfig(altered({database_name:'production'}),preview), /database/);
  assert.throws(()=>validateStagingConfig(altered({database_id:'nope'}),preview), /database|id/);
  assert.throws(()=>validateStagingConfig(altered({migrations_dir:'other'}),preview), /migration/);
  assert.throws(()=>validateStagingConfig({...staging,r2_buckets:[]},preview), /unexpected/i);
});
test('preview must stay DB-free and separately named',()=>{
  assert.throws(()=>validateStagingConfig(staging,{...preview,d1_databases:[{binding:'DB'}]}),/preview.*binding|preview.*D1/i);
  assert.throws(()=>validateStagingConfig(staging,{...preview,name:'shererp-cloud-staging'}),/separate|preview/);
});

test('staging guard refuses nested preview database bindings',()=>{
  assert.throws(()=>validateStagingConfig(staging,{...preview,previews:{d1_databases:[{binding:'DB'}]}}),/preview|unexpected|binding/i);
});
