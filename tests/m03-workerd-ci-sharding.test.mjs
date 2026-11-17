import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const read=relative=>readFileSync(new URL('../'+relative,import.meta.url),'utf8');
const aggregator='tests/integration/m03-workerd.spec.mjs';
const core='tests/integration/m03-workerd-core.spec.mjs';
const workflow='.github/workflows/m03-d1-workerd.yml';
const extra=[
 'm03-daybook-rpc-workerd.spec.mjs',
 'm03-daybook-http-workerd.spec.mjs',
 'm03-expense-category-read-workerd.spec.mjs',
 'm03-expense-payee-party-proof-workerd.spec.mjs',
 'm03-invoice-edit-audit-read-workerd.spec.mjs',
 'm03-frozen-source-readback-workerd.spec.mjs'
];
test('M03 sharded integration preserves every former imported suite exactly once plus standalone cases',()=>{
 const aggregate=read(aggregator);
 const imported=[...aggregate.matchAll(/^import '\.\/([^']+\.spec\.mjs)';/gm)].map(x=>x[1]);
 assert.equal(imported.length,45,'44 original suites plus the extracted 10-test core');
 assert.ok(imported.includes('m03-workerd-core.spec.mjs'));
 assert.doesNotMatch(aggregate,/\btest\(/,'the aggregator must only compose suites');
 assert.ok(existsSync(new URL('../'+core,import.meta.url)));
 const coreSource=read(core);
 assert.equal((coreSource.match(/\btest\('/g)||[]).length,10,'all ten original core test cases remain intact');
 assert.match(coreSource,/applied_migrations,14/);
 assert.match(coreSource,/application_tables,20/);
 const ci=read(workflow);
 const listed=[...ci.matchAll(/tests\/integration\/([a-z0-9-]+\.spec\.mjs)/g)].map(x=>x[1]);
 const expected=[...imported,...extra].sort();
 assert.equal(listed.length,expected.length,'no omissions, duplicates or glob expansion');
 assert.deepEqual(listed.sort(),expected,'the matrix must enumerate the complete existing M03 suite');
});
test('M03 aggregate check is fail-closed across six parallel local Workerd/D1 shards',()=>{
 const ci=read(workflow);
 assert.match(ci,/workerd-shards:/);
 assert.match(ci,/matrix:/);
 assert.equal((ci.match(/- group:/g)||[]).length,6);
 assert.match(ci,/fail-fast:\s*false/);
 assert.match(ci,/node --test --test-concurrency=1/);
 assert.match(ci,/wrangler@4\.161\.0/);
 assert.match(ci,/node-version:\s*'22'/);
 assert.match(ci,/npm test/);
 assert.match(ci,/name: Test read-only adapters against local workerd and D1/);
 assert.match(ci,/needs: \[verify-repo, workerd-shards\]/);
 assert.match(ci,/needs\.verify-repo\.result/);
 assert.match(ci,/needs\.workerd-shards\.result/);
 assert.doesNotMatch(ci,/continue-on-error|test-skip-pattern|--test-name-pattern/);
});

test('M03 private frozen-source Workerd readback must execute exactly once in required CI',()=>{
 const name='m03-frozen-source-readback-workerd.spec.mjs';
 const ci=read(workflow);
 assert.equal(ci.split('tests/integration/'+name).length-1,1,'the four-case source readback must run in one real Workerd shard');
 const suite=read('tests/integration/'+name);
 assert.equal(suite.split('test(').length-1,4,'the source-readback suite must retain all four safety cases');
 assert.match(suite,/createFrozenSourceReadback/);
 assert.match(suite,/readAllSourceGroups/);
});
