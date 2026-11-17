import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {patchM01ProductsPreview,installM01ProductsPreviewAssets} from '../scripts/patch-m01-products-preview.mjs';

const origin='<html><body><div id="prodModal"></div><tbody id="prodTableBody"></tbody></body></html>';

test('compiled enhancement is additive, deterministic and idempotent',()=>{
 const patched=patchM01ProductsPreview(origin);
 assert.match(patched,/m05-products\/m01-products-preview-controller\.mjs/);
 assert.match(patched,/<script type="module"/);
 assert.equal(patchM01ProductsPreview(patched),patched);
 assert.match(patched,/<div id="prodModal"><\/div>/);
});

test('compiled enhancement fails closed if original Product modal/table or body is missing or duplicated',()=>{
 for(const input of [
  '<html><body><tbody id="prodTableBody"></tbody></body></html>',
  '<html><body><div id="prodModal"></div></body></html>',
  origin.replace('</body>',''),
  origin.replace('<div id="prodModal"></div>','<div id="prodModal"></div><div id="prodModal"></div>')
 ]){
   assert.throws(()=>patchM01ProductsPreview(input),/missing|duplicate|ambiguous|anchor/i);
 }
});

test('compiled asset installation copies exactly source-reviewed M05 ESM dependencies and the browser adapter',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'m01-product-ui-test-'));
 try {
  const dest=await installM01ProductsPreviewAssets(dir);
  const names=(await readdir(dest)).sort();
  assert.deepEqual(names,[
   'm01-products-preview-controller.mjs',
   'm05-product-form-stock-preview.js',
   'm05-product-unit-price-profile.js',
   'm05-tile-stock-view.js',
   'product-unit-conversions.js',
   'tile-quantity-contract.js'
  ].sort());
  const body=await readFile(join(dest,'m01-products-preview-controller.mjs'),'utf8');
  assert.match(body,/previewM05ProductAddForm/);
  assert.match(body,/previewM05TileAreaOpening/);
  assert.match(body,/postingAllowed/);
  const source=await readFile(join(dest,'m05-product-form-stock-preview.js'),'utf8');
  assert.match(source,/formatM05ProductStockCell/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('patcher never edits the frozen source or introduces source-of-truth posting',()=>{
 const updated=patchM01ProductsPreview(origin);
 assert.doesNotMatch(updated,/addProduct\(|updateProduct\(|INSERT INTO|UPDATE products/);
 assert.equal((updated.match(/m05-products\/m01-products-preview-controller/g)||[]).length,1);
});
