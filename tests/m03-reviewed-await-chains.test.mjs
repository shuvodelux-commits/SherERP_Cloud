import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditReviewedM03AwaitChains,REVIEWED_AWAIT_FILES}
  from '../scripts/audit-m03-reviewed-await-chains.mjs';

const source=()=>Object.fromEntries(REVIEWED_AWAIT_FILES.map(path=>[
  path,readFileSync(new URL('../'+path,import.meta.url),'utf8')
]));
const analyze=sources=>auditReviewedM03AwaitChains(sources);

test('source-pinned M03 converted read/RPC slice and six archived groups contain 12 reviewed awaited chains',()=>{
  const report=analyze(source());
  assert.deepEqual(report,{
    status:'REVIEWED_M03_AWAITED_ONLY',
    files:12,awaitedCallSites:39,
    publicRpcEnabled:false
  });
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(live,/database:'not-connected'/);
  assert.doesNotMatch(live+registry,/auditReviewedM03AwaitChains|REVIEWED_M03_AWAITED_ONLY/);
});

test('catalog findRows_ cannot consume a pending getAllRows_ Promise like an array',()=>{
  const files=source(),p='src/db/legacy-catalog-read.js';
  const old='const rows=await getAllRows_(sheetKey);';
  assert(files[p].includes(old));
  files[p]=files[p].replace(old,'const rows=getAllRows_(sheetKey);');
  assert.throws(()=>analyze(files),/await|unresolved|Promise|conversion/i);
});

test('catalog findRowIndex_ must await transitive helper to preserve numeric source row index',()=>{
  const files=source(),p='src/db/legacy-catalog-read.js';
  const old='const result=await findRow_(sheetKey,columnName,value);';
  assert(files[p].includes(old));
  files[p]=files[p].replace(old,'const result=findRow_(sheetKey,columnName,value);');
  assert.throws(()=>analyze(files),/await|unresolved|Promise|conversion/i);
});

test('Promise.all must itself be awaited for product dropdown and Settings D1 reads',()=>{
  const files=source(),p='src/modules/product-master-options.js';
  const old='const [categories,units]=await Promise.all([';
  assert(files[p].includes(old));
  files[p]=files[p].replace(old,'const [categories,units]=Promise.all([');
  assert.throws(()=>analyze(files),/await|unresolved|Promise|conversion/i);
});

test('direct Settings SQL result must await D1.all before mapping response',()=>{
  const files=source(),p='src/db/settings-read.js';
  const old='const response=await DB.prepare(READ_ALL).bind(MAX_SETTINGS_ROWS+1).all();';
  assert(files[p].includes(old));
  files[p]=files[p].replace(old,'const response=DB.prepare(READ_ALL).bind(MAX_SETTINGS_ROWS+1).all();');
  assert.throws(()=>analyze(files),/await|unresolved|Promise|conversion/i);
});

test('Party identity source lookup cannot return a promise-valued D1.first read',()=>{
  const files=source(),p='src/db/party-identity-read.js';
  const old='const result=await db.prepare(EXACT_LEGACY_LINK).bind(sourceGroup,sourceId).first();';
  assert(files[p].includes(old));
  files[p]=files[p].replace(old,'const result=db.prepare(EXACT_LEGACY_LINK).bind(sourceGroup,sourceId).first();');
  assert.throws(()=>analyze(files),/await|unresolved|Promise|conversion/i);
});

test('Day Book private RPC bridge must await authorized D1 reader before wrapping success data',()=>{
  const files=source(),p='src/rpc/internal-daybook-bootstrap.js';
  const old='const data=await createM09AuthorizedDayBookBootstrapReader(env)';
  assert(files[p].includes(old));
  files[p]=files[p].replace(old,'const data=createM09AuthorizedDayBookBootstrapReader(env)');
  assert.throws(()=>analyze(files),/await|unresolved|Promise|conversion/i);
});

test('a deferred callback inside an awaited container does not count as awaiting its D1 call',()=>{
  const files=source(),p='src/db/legacy-catalog-read.js';
  const old='const rows=await getAllRows_(sheetKey);';
  assert(files[p].includes(old));
  files[p]=files[p].replace(old,'const rows=await Promise.all([()=>getAllRows_(sheetKey)]);');
  assert.throws(()=>analyze(files),/await|unresolved|Promise|conversion/i);
});

test('comment text, string literals and uncalled identifiers never count as async proof',()=>{
  const files=source(),p='src/db/legacy-catalog-read.js',expected=analyze(files);
  files[p]+='\n// getAllRows_(\'PRODUCTS\') is just commentary\nconst unrelatedText="await findRows_()";\n';
  assert.deepEqual(analyze(files),expected);
});

test('missing audited file, renamed required call, unparseable or injected code fails closed',()=>{
  const files=source();
  const missing={...files};delete missing['src/db/settings-read.js'];
  assert.throws(()=>analyze(missing),/source|file|review|invalid/i);
  const extra={...files,'src/db/finance-writer.js':"export const x=()=>0;"};
  assert.throws(()=>analyze(extra),/source|file|review|invalid/i);
  const renamed={...files};
  renamed['src/db/settings-read.js']=renamed['src/db/settings-read.js']
    .replace('.bind(MAX_SETTINGS_ROWS+1).all()','.bind(MAX_SETTINGS_ROWS+1).unsafe()');
  assert.throws(()=>analyze(renamed),/await|missing|review|conversion/i);
  const broken={...files,'src/db/settings-read.js':'function broken( {'};
  assert.throws(()=>analyze(broken),/parse|syntax|review|invalid|conversion/i);
});
