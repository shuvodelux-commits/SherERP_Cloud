import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const patch=async()=>await import('../scripts/patch-owner-hisabiq-pos.mjs').catch(()=>({}));

test('Owner POS patch exists and is not a global or legacy mutation',async()=>{
  const mod=await patch();
  assert.equal(typeof mod.patchOwnerHisabiqPos,'function','compiled-only POS injector required');
  const original='<!doctype html><html><head></head><body><section id="page-pos"><div class="pos-layout"><div id="posCartList"></div><button id="posCompleteBtn"></button></div></section></body></html>';
  const css='body.pos-v2-active #page-pos .cart-row { color: teal; }';
  const js='(function () { document.body.dataset.posUi = "yes"; })();';
  const result=mod.patchOwnerHisabiqPos(original,{css,js});
  assert.match(result,/id="hisabiq-pos-parity-styles"/);
  assert.match(result,/id="hisabiq-pos-parity-controller"/);
  assert.match(result,/body.pos-v2-active #page-pos/);
  assert.equal(result.includes('id="page-pos"'),true);
  assert.throws(()=>mod.patchOwnerHisabiqPos(result,{css,js}),/already/i);
  assert.throws(()=>mod.patchOwnerHisabiqPos(original,{css:'',js}),/missing/i);
  assert.throws(()=>mod.patchOwnerHisabiqPos(original.replace('id="page-pos"','id="other"'),{css,js}),/boundary/i);
  assert.throws(()=>mod.patchOwnerHisabiqPos(original,{css:'</style>',js}),/unsafe/i);
});

test('HisabIQ source design contract is used without introducing a money writer',async()=>{
  const css=await readFile(new URL('../src/ui/hisabiq/pos-parity.css',import.meta.url),'utf8').catch(()=> '');
  const js=await readFile(new URL('../src/ui/hisabiq/pos-parity.mjs',import.meta.url),'utf8').catch(()=> '');
  assert.match(css,/#0D7C74/i,'HisabIQ brand teal');
  assert.match(css,/#0B1A2C/i,'HisabIQ Ink');
  assert.match(css,/@media\s*\(max-width:\s*767px\)/i);
  assert.match(css,/#page-pos\s+\.cart-row/);
  assert.match(js,/New sale/);
  assert.match(js,/Quick items/);
  assert.match(js,/posSearch/);
  assert.doesNotMatch(js,/fetch\s*\(|serverCall\s*\(|completeSale\s*\(/);
});
