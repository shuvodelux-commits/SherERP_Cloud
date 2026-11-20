import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFrontend} from '../../scripts/build-frontend.mjs';

test('M01 compiled shell retains original ERP IDs and adds a single HisabIQ shell layer',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'m01-hisabiq-shell-'));
  try {
    const {outputPath}=await buildFrontend({
      sourceDir:new URL('../../legacy/source/',import.meta.url).pathname,
      outputDir:dir
    });
    const html=await readFile(outputPath,'utf8');
    assert.match(html, /<style data-hisabiq-shell>/,'HisabIQ design CSS must be present');
    assert.match(html, /<script data-hisabiq-shell>/,'accessible shell interactions must be present');
    assert.equal(html.split('<style data-hisabiq-shell>').length-1,1,'no duplicated CSS');
    assert.equal(html.split('<script data-hisabiq-shell>').length-1,1,'no duplicated JS');
    for(const id of ['app','sidebar','navList','sidebarCollapseBtn','shopNameLabel','menuToggle',
      'pageTitle','mobileBottomNav','mobileMoreSheet','subNav','cashSessionToggleBtn',
      'calcToggleBtn','refreshBtn','content','printHost']){
      assert.match(html,new RegExp('id="'+id+'"'),'must preserve original '+id);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('M01 shell source locks permission-safe navigation and HisabIQ breakpoints',async()=>{
  const script=await readFile(new URL('../../src/ui/hisabiq-shell.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../../src/ui/hisabiq-shell.css',import.meta.url),'utf8');
  assert.match(script,/subNavVisible_/,'children are filtered with original permissions');
  assert.match(script,/navLandingKey_/,'existing landing-key resolution is retained');
  assert.match(script,/goToPage/,'navigation is still delegated to the original router');
  assert.match(script,/aria-modal/,'mobile drawer is a dialog');
  assert.match(css,/256px/,'desktop must match expanded 256px');
  assert.match(css,/64px/,'desktop must match collapsed 64px');
  assert.match(css,/1024px/,'reference breakpoint');
  assert.match(css,/prefers-reduced-motion/,'respect motion preference');
  assert.doesNotMatch(script,/fetch\s*\(/,'shell must not create a second API transport');
});
