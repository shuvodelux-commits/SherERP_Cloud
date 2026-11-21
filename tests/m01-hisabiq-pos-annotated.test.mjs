import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFrontend} from '../scripts/build-frontend.mjs';
import {patchHisabiqPos} from '../scripts/patch-hisabiq-pos.mjs';

const original=`<!doctype html><html><head></head><body><div id="app">
<section class="page" id="page-pos" data-page="pos" hidden>
<div class="pos-layout"><input id="posCustomerName"><input id="posCustomerPhone">
<div id="posCartList"></div><input id="posDiscount"><input id="posAmountReceived">
<select id="posPaymentMethod"></select><div id="posMultiPaymentFields"></div>
<div id="posMultiPaymentRows"></div><button id="posAddPaymentRowBtn"></button>
<input id="posSearch"><div id="posProductGrid"></div>
<button id="posCompleteBtn"></button><button id="posClearCartBtn"></button></div>
<script>var posState={cart:[]};function posRenderCart_(){};serverCall('completeSale');</script>
</section></div></body></html>`;
const css='[data-hisabiq-pos]{--hi-pos-teal:#0d7c74}';
const js='window.hisabiqPosMounted=true;';

test('compiled POS enhancement retains each native financial control and source checkout exactly once',()=>{
  const html=patchHisabiqPos(original,css,js);
  for(const id of ['posCartList','posCompleteBtn','posDiscount','posAmountReceived','posSearch',
    'posMultiPaymentRows','posCustomerName','posCustomerPhone'])
    assert.equal(html.split('id="'+id+'"').length-1,1,id);
  assert.equal(html.split("serverCall('completeSale')").length-1,1);
  assert.match(html,/id="hisabiq-pos-style"/);
  assert.match(html,/id="hisabiq-pos-runtime"/);
  assert.match(html,/data-hisabiq-pos/);
  assert.match(html,/hisabiqPosMounted/);
});

test('unrelated HtmlService fixtures are completely unchanged',()=>{
  const unrelated='<html><head></head><body><div id="app">Fixture</div></body></html>';
  assert.equal(patchHisabiqPos(unrelated,css,js),unrelated);
});

test('POS injector fails closed on missing or duplicate source controls',()=>{
  assert.throws(()=>patchHisabiqPos(original+original,css,js),/Ambiguous.*POS/);
  assert.throws(()=>patchHisabiqPos(original.replace('id="posCartList"','id="gone"'),css,js),/POS.*posCartList/);
  assert.throws(()=>patchHisabiqPos(patchHisabiqPos(original,css,js),css,js),/already installed/);
});

test('compiled UI assets cannot escape their HTML tags',()=>{
  assert.throws(()=>patchHisabiqPos(original,'</style>',js),/Unsafe/);
  assert.throws(()=>patchHisabiqPos(original,css,'</script>'),/Unsafe/);
});

test('real source Owner compilation receives the annotated POS UI without modifying source transactions',async()=>{
  const dest=await mkdtemp(join(tmpdir(),'shererp-pos-compiled-'));
  try{
    const {outputPath}=await buildFrontend({sourceDir:'legacy/source',outputDir:dest});
    const html=await readFile(outputPath,'utf8');
    assert.match(html,/id="hisabiq-pos-style"/);
    assert.match(html,/id="hisabiq-pos-runtime"/);
    assert.match(html,/id="page-pos"[^>]*data-hisabiq-pos/);
    assert.match(html,/function posRenderCart_\(/);
    assert.match(html,/completeSale/);
    assert.equal(html.split('id="posCompleteBtn"').length-1,1);
  }finally{await rm(dest,{recursive:true,force:true});}
});
