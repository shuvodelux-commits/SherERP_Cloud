import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const root = new URL('../',import.meta.url);
const read = path => readFileSync(new URL(path,root),'utf8');
const dir=new URL('../.github/workflows/',import.meta.url);
const files=readdirSync(dir).filter(name=>name.endsWith('.yml')||name.endsWith('.yaml'));

test('all PR workflows cancel only superseded runs of their own PR and never cancel manual releases',()=>{
 let count=0;
 for(const file of files){
  const y=read('.github/workflows/'+file);
  if(!/^\s*pull_request:\s*$/m.test(y))continue;
  count++;
  assert.match(y,/^concurrency:\s*$/m,file+' must cancel superseded PR work');
  assert.match(y,/^\s+group:.*github\.workflow.*github\.event\.pull_request\.number.*github\.ref/m,file+' must isolate workflow+PR');
  assert.match(y,/^\s+cancel-in-progress:.*github\.event_name\s*==\s*'pull_request'/m,file+' must never cancel non-PR operational jobs');
 }
 assert.ok(count>=42,'all existing 42 PR workflows remain covered');
});

test('every PR Node runner uses lockfile-keyed npm tarball cache; no node_modules reuse',()=>{
 let count=0;
 for(const file of files){
  const y=read('.github/workflows/'+file);
  if(!/^\s*pull_request:\s*$/m.test(y)||!y.includes('actions/setup-node@v4'))continue;
  const segments=y.split(/^\s+- uses: actions\/setup-node@v4\s*$/m).slice(1);
  for(const segment of segments){
   const block=segment.split(/^\s+- (?:name:|uses:|run:)/m)[0];
   assert.match(block,/cache:\s*['"]?npm['"]?/,file+' must cache downloaded npm packages');
   assert.doesNotMatch(block,/node_modules|cache:\s*['"]?node_modules['"]?/i,file+' must not share installed node_modules');
   count++;
  }
 }
 assert.ok(count>=43,'all existing Node setup steps are covered');
});

test('fast PR confidence feedback does not skip critical full integration checks or deploy',()=>{
 const y=read('.github/workflows/fast-pr-confidence.yml');
 assert.match(y,/^on:\n  pull_request:/m);
 assert.match(y,/name: Fast PR confidence/);
 assert.match(y,/timeout-minutes:\s*8/);
 assert.match(y,/npm ci --no-audit --no-fund/);
 assert.match(y,/npm run verify:source/);
 assert.match(y,/npm run build:frontend/);
 assert.match(y,/node --test/);
 assert.match(y,/scripts\/check-cloudflare-preview\.mjs/);
 assert.doesNotMatch(y,/--remote\b|wrangler deploy|CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID|continue-on-error|--test-skip-pattern/i);
 const full=read('.github/workflows/foundation-checks.yml');
 const d1=read('.github/workflows/m03-d1-workerd.yml');
 assert.match(full,/run: npm test/,'full baseline remains separate and mandatory');
 assert.match(d1,/needs: \[verify-repo, workerd-shards\]/,'six-shard Workerd gate remains fail closed');
});
