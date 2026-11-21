import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {patchHisabiqSales} from '../scripts/patch-hisabiq-sales.mjs';
import {buildFrontend} from '../scripts/build-frontend.mjs';

const original = `<!doctype html><html><head></head><body>
<div id="app">
<section class="page" id="page-sales" data-page="sales" hidden>
<input id="smSearch"><input id="smDateFrom"><input id="smDateTo">
<select id="smPaymentStatus"></select><select id="smReturnStatus"></select>
<button id="smRefreshBtn"></button><div id="smTableScroll"><table>
<thead><tr><th id="smProfitHeader">Profit</th></tr></thead>
<tbody id="smTableBody"></tbody></table></div><div id="smEmpty"></div>
<div id="smViewModal"></div><div id="smPayModal"></div>
<script>function smRender(){};function smLoad(){return serverCall("getSalesManagementList",authToken)};function smDetail(){return serverCall("getSaleDetail",authToken)};</script>
</section></div></body></html>`;
const css = '#page-sales[data-hisabiq-sales] { color:#0b1a2c; }';
const js = '(function(){ window.hisabiqSalesUiInstalled = true; })();';

test('compiled Sales enhancement retains native Sales handlers and client IDs exactly once',()=>{
  const after = patchHisabiqSales(original,css,js);
  assert.equal(after.split('id="smTableBody"').length-1,1);
  assert.equal(after.split('id="smViewModal"').length-1,1);
  assert.equal(after.split('id="smPayModal"').length-1,1);
  assert.equal(after.split('getSalesManagementList').length-1,1);
  assert.match(after,/<style id="hisabiq-sales-style">/);
  assert.match(after,/<script id="hisabiq-sales-runtime">/);
  assert.match(after,/data-hisabiq-sales/);
  assert.match(after,/#0b1a2c/);
  assert.match(after,/hisabiqSalesUiInstalled/);
  assert.match(after,/function smRender\(\)/);
});

test('Sales enhancement must not change unrelated HtmlService fixtures',()=>{
  const fixture='<html><head></head><body><div id="app">Dashboard fixture</div></body></html>';
  assert.equal(patchHisabiqSales(fixture,css,js),fixture);
});

test('ambiguous or missing native Sales contract fails closed before injection',()=>{
  assert.throws(()=>patchHisabiqSales(original+original,css,js),/Ambiguous.*Sales/);
  assert.throws(()=>patchHisabiqSales(original.replace('id="smTableBody"','id="changed"'),css,js),/Sales.*smTableBody/);
  const installed=patchHisabiqSales(original,css,js);
  assert.throws(()=>patchHisabiqSales(installed,css,js),/already installed/);
});

test('unsafe closing markers in trusted asset files cannot escape injected tags',()=>{
  assert.throws(()=>patchHisabiqSales(original,'</style>',js),/Unsafe/);
  assert.throws(()=>patchHisabiqSales(original,css,'</script>'),/Unsafe/);
});

test('real compiled ERP receives Sales UI while original financial code stays present',async()=>{
  const outputDir=await mkdtemp(join(tmpdir(),'shererp-sales-compile-'));
  try {
    const {outputPath}=await buildFrontend({sourceDir:'legacy/source',outputDir});
    const html=await readFile(outputPath,'utf8');
    assert.match(html,/id="hisabiq-sales-style"/);
    assert.match(html,/id="hisabiq-sales-runtime"/);
    assert.match(html,/id="page-sales"[^>]*data-hisabiq-sales/);
    assert.match(html,/getSalesManagementList/);
    assert.match(html,/getSaleDetail/);
    assert.match(html,/id="smPaySaveBtn"/);
    assert.match(html,/id="smViewReturnBtn"/);
    assert.equal(html.split('id="smTableBody"').length-1,1);
  } finally {await rm(outputDir,{recursive:true,force:true});}
});
