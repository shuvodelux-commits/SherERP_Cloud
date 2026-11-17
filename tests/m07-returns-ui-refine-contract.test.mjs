import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('M07 UI refinement selectors fit both exact original nested search rows',()=>{
 const markup=read('legacy/source/returns.html');
 const css=read('docs/reviews/m07-returns-ui-refine/proposal.css');
 for(const [panel,input,find,clear] of [
  ['rtInvoiceSearchPanel','rtSearchInput','rtFindBtn','rtClearBtn'],
  ['rtCustomerSearchPanel','rtCustomerSearchInput','rtFindCustomerBtn','rtCustomerClearBtn']
 ]){
  assert.match(markup,new RegExp('<div id="'+panel+'"'));
  assert.match(markup,new RegExp('<input id="'+input+'"'));
  assert.match(markup,new RegExp('<button class="btn btn-primary" id="'+find+'"'));
  assert.match(markup,new RegExp('<button class="btn" id="'+clear+'"'));
  assert.ok(css.includes('#page-returns #'+panel+' > div[style*="display:flex"]'),
   panel+' layout refinement must select actual nested flex row, not the card');
  assert.ok(css.includes('#page-returns #'+input),'missing source input '+input);
  assert.ok(css.includes('#page-returns #'+find),'missing action '+find);
  assert.ok(css.includes('#page-returns #'+clear),'missing action '+clear);
 }
 assert.match(css,/@media\s*\(max-width:\s*540px\)/);
 assert.match(css,/grid-template-columns:\s*minmax\(0,1fr\)\s+minmax\(0,1fr\)/);
 assert.match(css,/grid-column:\s*1\s*\/\s*-1/);
 assert.match(css,/min-height:\s*44px/);
 assert.match(css,/:focus-visible/);
});

test('M07 UI proposed CSS is preview-only and must not modify auth, posting or source code',()=>{
 const css=read('docs/reviews/m07-returns-ui-refine/proposal.css');
 const script=read('qa/m07-returns-ui-refine-preview.mjs');
 assert.match(script,/serveCompiledUi/,'preview must render the real compiled original UI');
 assert.match(script,/playwright/,'preview must execute Chromium screenshots');
 assert.match(script,/\.screenshot\(/,'Playwright screenshots must be saved');
 assert.match(script,/proposal\.css/);
 assert.match(script,/320/);
 assert.match(script,/375/);
 assert.match(script,/1440/);
 assert.doesNotMatch(css,/@import|url\(|https?:|\bsrc\/rpc\b|\bD1\b|\b(?:authToken|loginOverlay)\b/);
 assert.doesNotMatch(css,/(?:#app|\.login-overlay|#page-purchase|#page-pos|#page-reports)/);
 assert.ok(css.split(/\r?\n/).filter(x=>x.trim()).length<100,'small scoped CSS only');
});


test('M07 compiled Returns search-clear span occupies the full mobile grid row',()=>{
 const css=read('docs/reviews/m07-returns-ui-refine/proposal.css');
 const script=read('qa/m07-returns-ui-refine-preview.mjs');
 // M01 compiled frontend wraps the original input inside a direct-child span.
 // Styling the input alone cannot span the parent search grid columns.
 for(const panel of ['rtInvoiceSearchPanel','rtCustomerSearchPanel']){
  const parent='#page-returns #'+panel+' > div[style*="display:flex"]';
  assert.ok(css.includes(parent+' > .erp-search-clear-field'),
   'mobile CSS must target the compiled direct-child wrapper in '+panel);
 }
 assert.match(css,/\.erp-search-clear-field\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
  'compiled wrapper must span both mobile columns');
 assert.match(script,/row\.children/,
  'search row actions must be direct child buttons; M01 adds a nested global clear');
 assert.doesNotMatch(script,/row\.querySelectorAll\(['"]button['"]\)/,
  'nested hidden clear is not a Find/Clear search action');
 assert.match(script,/metrics\.actions\.length\s*,\s*2/,
  'exactly two native Find/Clear actions expected in each search mode');
});
