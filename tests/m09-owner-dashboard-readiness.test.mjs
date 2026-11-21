import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

async function compiled(t){
  const outputDir=await mkdtemp(join(tmpdir(),'shererp-owner-dash-readiness-'));
  t.after(()=>rm(outputDir,{recursive:true,force:true}));
  await buildOwnerFrontend({outputDir});
  return readFile(join(outputDir,'owner-erp.html'),'utf8');
}

test('Owner Dashboard shows a scoped, hidden until needed inline summary-readiness status',async t=>{
  const html=await compiled(t);
  assert.equal((html.match(/id="hdb-data-readiness"/g)||[]).length,1);
  assert.match(html,/id="hdb-data-readiness"[^>]*role="status"[^>]*hidden/);
  assert.match(html,/Full Dashboard totals/i);
  assert.match(html,/individual modules/i);
  assert.match(html,/11-field/);
});

test('only missing authenticated Owner Dashboard summary is handled inline; other failures stay visible',async t=>{
  const html=await compiled(t);
  assert.match(html,/serverCall\('getDashboardStats', authToken\)/);
  assert.match(html,/err\.message\s*===\s*'Shop business data is not connected yet\.'/);
  assert.match(html,/document\.getElementById\('owner-data-notice'\)/);
  assert.match(html,/showToast\(err\.message, 'error'\)/);
  assert.match(html,/ownerNotice\.textContent/);
  assert.match(html,/Shop D1 is connected for enabled modules/);
  assert.match(html,/notice\.hidden\s*=\s*false/);
  assert.match(html,/notice\.hidden\s*=\s*true/);
  assert.equal((html.match(/function dashLoad\(\)/g)||[]).length,1);
  assert.match(html,/else return Promise\.reject\(new Error\('Shop business data is not connected yet\.'\)\)/,
    'Other unsupported Owner functions still fail closed');
});

test('Dashboard readiness cannot introduce fake financial fields, writes, or alter preserved original source',async t=>{
  const [html,original]=await Promise.all([
    compiled(t),readFile(new URL('../legacy/source/dashboard.html',import.meta.url),'utf8')
  ]);
  assert.match(original,/.catch\(function \(err\) \{ showToast\(err\.message, 'error'\); \}\)/,
    'The frozen source dashboard remains byte-identical');
  assert.doesNotMatch(original,/hdb-data-readiness/);
  const status=html.match(/id="hdb-data-readiness"[^>]*>[^<]*<\/p>/)?.[0]||'';
  assert.doesNotMatch(status,/0\.00|৳0|fake|test invoice|sample data/i);
  assert.match(html,/id="owner-data-notice"/);
  assert.match(html,/id="page-suppliers"/);
  assert.match(html,/id="page-customers"/);
  assert.match(html,/id="page-supplierLedger"/);
});
