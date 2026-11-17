import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFrontend} from '../scripts/build-frontend.mjs';

async function compiled(t) {
  const outputDir=await mkdtemp(join(tmpdir(),'m01-hisabiq-dashboard-'));
  t.after(()=>rm(outputDir,{recursive:true,force:true}));
  const built=await buildFrontend({
    sourceDir:new URL('../legacy/source/',import.meta.url).pathname,
    outputDir
  });
  return readFile(built.outputPath,'utf8');
}

test('M01: HisabIQ dashboard compiled overlay retains original source semantics and 10 default widgets',async t=>{
  const html=await compiled(t);
  assert.match(html,/id="hisabiq-dashboard"/);
  assert.match(html,/id="hisabiq-dashboard-metrics"/);
  assert.match(html,/id="hisabiq-dashboard-panels"/);
  assert.match(html,/id="hisabiq-dashboard-customize"/);
  assert.match(html,/id="hisabiq-dashboard-dialog"/);
  assert.match(html,/id="hisabiq-dashboard-style"/);
  assert.match(html,/id="hisabiq-dashboard-runtime"/);
  for(const id of ['today-sales','receivable','payable','cash','gross-profit','low-stock',
    'sales-trend','cashflow','recent-sales','dues']) {
    assert.match(html,new RegExp('data-hdb-widget="'+id+'"'),id+' appears in the UI');
  }
  for(const sourceId of ['dashSales','dashCollection','dashExpense','dashPurchase',
    'dashDue','dashPayable','dashBorrowerReceivable','dashOutstandingLoan',
    'dashCash','dashLowStockCount']) {
    assert.equal((html.match(new RegExp('id="'+sourceId+'"','g'))||[]).length,1,
      'must keep original operational dashboard '+sourceId+' for source contract');
  }
  assert.match(html,/function dashLoad\(\)/);
  assert.ok(html.indexOf('id="hisabiq-dashboard-runtime"')>html.indexOf('function dashLoad()'),
    'runtime must execute after original summary cells and loader exist');
  assert.match(html,/serverCall\('getDashboardStats', authToken\)/);
  assert.doesNotMatch(html,/40460|180300|249850|312400|96500|sampleData|demoBalance/);
});

test('M01: dashboard customization source is accessible and isolated from financial writes',async t=>{
  const html=await compiled(t);
  assert.match(html,/data-hdb-action="customize"/);
  assert.match(html,/data-hdb-action="reset"/);
  assert.match(html,/data-hdb-action="finish"/);
  assert.match(html,/data-hdb-action="show-hidden"/);
  assert.match(html,/\['move-prev','←'/);
  assert.match(html,/\['move-next','→'/);
  assert.match(html,/li\.setAttribute\('draggable','true'\)/,
    'runtime renders draggable rows without an inert placeholder');
  assert.match(html,/role="dialog"/);
  assert.match(html,/aria-label="Customize dashboard"/);
  assert.match(html,/localStorage/);
  assert.match(html,/currentUser/);
  assert.doesNotMatch(html,/\b(INSERT INTO|UPDATE parties|DELETE FROM|fetch\('https?:)\b/i);
});


test('M01 Step 1 RED: reference header hierarchy, Lucide SVGs and honest chart geometry',async t=>{
  const html=await compiled(t);
  assert.match(html,/id="hdb-welcome-title"/,'English primary heading must be addressable');
  assert.match(html,/id="hdb-welcome-bn" lang="bn"/,'Bangla helper shares the heading row');
  assert.match(html,/id="hdb-subtitle-bn" lang="bn"/,'Bangla calendar date is visible');
  assert.equal((html.match(/<svg data-hdb-icon=/g)||[]).length,6,
    'the 6 default KPI tiles use SVG rather than emoji/symbol placeholders');
  assert.match(html,/\.hdb-panel-head\s*\{[^}]*border-bottom:\s*1px solid var\(--hdb-border\)/,
    'panel headers use the source Panel component border');
  assert.match(html,/\.hdb-chart-shell\s*\{[^}]*min-height:\s*220px/,
    'charts reserve 220px like reference even while authorized series are unavailable');
  assert.match(html,/\.hdb-head h1\s*\{[^}]*font-size:\s*20px/,
    'HisabIQ header uses text-xl, not a large promotional headline');
  assert.match(html,/@media\(min-width:640px\)\s*\{[^}]*\.hdb-dialog-grid/,
    'reference customizer switches to two columns at small tablet');
  assert.match(html,/<div class="hdb-chart-shell"[^>]*data-hdb-chart="sales-trend"/);
  assert.match(html,/<div class="hdb-chart-shell"[^>]*data-hdb-chart="cashflow"/);
  assert.doesNotMatch(html,/hdb-chart-point|hdb-mock-revenue|hdb-demo-sales/,
    'do not fake financial chart data to imitate screenshot');
});


test('M01 Step 2 RED: discoverable reorder grips and complete touch/keyboard controls',async t=>{
  const html=await compiled(t);
  assert.match(html,/\['list-prev','↑'/,
    'customization rows must offer accessible move-earlier control');
  assert.match(html,/\['list-next','↓'/,
    'customization rows must offer accessible move-later control');
  assert.match(html,/grip\.dataset\.hdbAction='drag-grip'/,
    'customization rows must offer discoverable drag grip');
  assert.match(html,/addEventListener\('pointerdown'/,
    'touch pointer-based reorder starts on the grip');
  assert.match(html,/addEventListener\('pointermove'/,
    'touch pointer-based reorder follows the gesture');
  assert.match(html,/addEventListener\('pointerup'/,
    'touch pointer-based reorder commits after the gesture');
  assert.match(html,/addEventListener\('keydown'/,
    'drag grip supports accessible keyboard reorder');
  assert.match(html,/aria-live="polite"/,
    'user actions should announce their result without visually shifting the layout');
  assert.match(html,/touch-action:\s*none/,
    'drag grip must capture native touch gestures instead of scrolling the page');
});

test('M01 Step 2 RED: user and tenant scope, modal focus, and bounded layout persistence',async t=>{
  const html=await compiled(t);
  assert.match(html,/function syncIdentity\(/);
  assert.match(html,/function closeDialog\(/);
  assert.match(html,/function persist\(/);
  assert.match(html,/function defaultLayout\(/);
  assert.match(html,/function restore\(/);
  assert.match(html,/addEventListener\('focusin'/,
    'modal keeps focus inside even when another element is focused programmatically');
  assert.match(html,/function announce\(/,
    'layout and reorder feedback must reach screen readers');
  assert.match(html,/function restoreDialogFocus\(/,
    're-rendering a switch or row must not lose keyboard focus');
  assert.match(html,/function moveInDialog\(/,
    'hidden items can be rearranged without first unhiding them');
  assert.match(html,/aria-describedby="hdb-dialog-desc"/,
    'the dialog includes a referenced description');
  const start=html.indexOf('<script id="hisabiq-dashboard-runtime">');
  const end=html.indexOf('</script>',start);
  const runtime=html.slice(start,end);
  assert.doesNotMatch(runtime,/window\.eval\(|innerHTML\s*=\s*[^'"]/,
    'layout restoration must not interpret stored text as DOM or code');
});


test('M01 Step 2: drag targets always derive group kind from the widget registry',async t=>{
  const html=await compiled(t);
  const marker='<script id="hisabiq-dashboard-runtime">';
  const start=html.indexOf(marker),end=html.indexOf('</script>',start);
  const runtime=html.slice(start,end);
  assert.match(runtime,/touchTarget\(point,definitions\[w\.id\]\.kind\)/);
  assert.match(runtime,/definitions\[from\]\.kind===definitions\[w\.id\]\.kind/);
  assert.doesNotMatch(runtime,/\bw\.kind\b/,
    'persisted layout entries have only id and visible; w.kind is undefined');
});
