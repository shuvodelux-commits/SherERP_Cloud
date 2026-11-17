import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditReviewedM03AwaitChains,REVIEWED_AWAIT_FILES}
  from '../scripts/audit-m03-reviewed-await-chains.mjs';

const HISTORICAL=Object.freeze([
  'src/db/legacy-error-log-read.js',
  'src/db/delete-log-audit-read.js',
  'src/db/invoice-edit-audit-read.js',
  'src/db/sales-draft-audit-read.js',
  'src/db/opening-balance-edit-audit-read.js',
  'src/db/stock-lot-cost-history-read.js'
]);
const files=()=>Object.fromEntries(REVIEWED_AWAIT_FILES.map(path=>[
  path,readFileSync(new URL('../'+path,import.meta.url),'utf8')
]));

test('Run2 audited async scope adds all six historical archive read chains, without declaring full migration',()=>{
  assert.equal(REVIEWED_AWAIT_FILES.length,12);
  assert(HISTORICAL.every(p=>REVIEWED_AWAIT_FILES.includes(p)));
  assert.deepEqual(auditReviewedM03AwaitChains(files()),{
    status:'REVIEWED_M03_AWAITED_ONLY',
    files:12,awaitedCallSites:51,publicRpcEnabled:false
  });
});

test('all six private D1 source archive SELECTs require an actual await, not a Promise-valued row set',()=>{
  const input=files();
  for(const path of HISTORICAL){
    const original=input[path];
    const pattern='await DB.prepare(SQL_READ).bind(MAX_ROWS+1).all()';
    assert(original.includes(pattern),path+' must preserve fixed D1 query');
    const changed={...input,[path]:original.replace(pattern,
      'DB.prepare(SQL_READ).bind(MAX_ROWS+1).all()')};
    assert.throws(()=>auditReviewedM03AwaitChains(changed),
      /await|conversion|invalid|source/i,path);
  }
});

test('historical archive findRows_ must await each D1 read, preserving original physical indices',()=>{
  const input=files();
  for(const path of HISTORICAL){
    const original=input[path];
    const pattern=/(const rows|const response|const result)=await (readSourceRows|sourceRows|rowsFor)\(DB\);/;
    const match=original.match(pattern);
    assert(match,path+' must contain reviewed awaited downstream read');
    const changed={...input,[path]:original.replace(match[0],
      match[0].replace('=await ','='))};
    assert.throws(()=>auditReviewedM03AwaitChains(changed),
      /await|conversion|invalid|source/i,path);
  }
});

test('historical archive first-row, matched-row and row-index helpers cannot lose awaits',()=>{
  const original=files();
  for(const path of HISTORICAL){
    for(const method of ['findRows_','findFirstRow_','findRow_']){
      const pattern='await '+method+'(';
      assert(original[path].includes(pattern),path+':'+method);
      const mutation={...original,[path]:original[path].replace(pattern,method+'(')};
      assert.throws(()=>auditReviewedM03AwaitChains(mutation),
        /await|conversion|invalid|source/i,path+':'+method);
    }
  }
});

test('historical archive read contracts retain exact original sheet isolation, no public RPC access',()=>{
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  for(const filename of HISTORICAL){
    const source=readFileSync(new URL('../'+filename,import.meta.url),'utf8');
    assert.match(source,/MAX_ROWS\s*=\s*1000/);
    assert.match(source,/ORDER BY legacy_sheet_row ASC LIMIT \?/);
    assert.equal(source.includes('src/index.js'),false);
  }
  assert.equal(registry.includes('legacy-error-log-read'),false);
  assert.equal(worker.includes('stock-lot-cost-history-read'),false);
  assert.match(worker,/database:'not-connected'/);
});
