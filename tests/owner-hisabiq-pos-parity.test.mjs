import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildOwnerFrontend} from '../scripts/build-owner-frontend.mjs';

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


test('merged Owner build retains exactly one Settings, Add Product and POS injection',async()=>{
  const dest=await mkdtemp(join(tmpdir(),'shererp-pos-build-regression-'));
  try{
    const built=await buildOwnerFrontend({outputDir:dest});
    const html=await readFile(built.indexPath,'utf8');
    const ids=['hisabiq-settings-controller','hisabiq-owner-unit-editor',
      'hisabiq-pos-parity-controller','hisabiq-pos-parity-styles',
      'hisabiq-owner-unit-editor-style','hisabiq-settings-styles'];
    for(const id of ids){
      assert.equal(html.split('id="'+id+'"').length-1,1,
        id+' must appear exactly once after merging parallel UI modules');
    }
    assert.ok(html.indexOf('id="hisabiq-settings-controller"')<
      html.indexOf('id="hisabiq-owner-unit-editor"'),
      'Settings and Product injector order is source-preserving');
    assert.ok(html.indexOf('id="hisabiq-owner-unit-editor"')<
      html.indexOf('id="hisabiq-pos-parity-controller"'),
      'POS enhancement loads after already-merged Product editor');
  }finally{
    await rm(dest,{recursive:true,force:true});
  }
});
