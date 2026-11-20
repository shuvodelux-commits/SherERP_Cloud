import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {test} from 'node:test';
import {generateHostedSupportMigration,MIGRATION_NAME} from
  '../../scripts/m03-hosted-support-migration.mjs';

test('hosted support migration reuses pinned reviewed SQL, refuses drift and stays private',async t=>{
  const root=resolve('.');
  await mkdir(join(root,'.wrangler'),{recursive:true});
  const target=await mkdtemp(join(root,'.wrangler','support-migration-test-'));
  t.after(()=>rm(target,{recursive:true,force:true}));
  const expected=await readFile(
    'staging-migrations/platform-support/0001_support_grants_and_events.sql','utf8');
  const path=await generateHostedSupportMigration(target);
  assert.equal(path,join(target,'control',MIGRATION_NAME));
  assert.equal(await readFile(path,'utf8'),expected);
  assert.equal(await generateHostedSupportMigration(target),path,
    'identical rerun is idempotent');
  await writeFile(path,'tampered');
  await assert.rejects(generateHostedSupportMigration(target),
    /SUPPORT_MIGRATION_OUTPUT_CONFLICT/);
  await assert.rejects(generateHostedSupportMigration(join(root,'docs')),
    /PRIVATE_MIGRATION_DIRECTORY_REQUIRED/);
});
