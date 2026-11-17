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
  assert.match(html,/draggable="true"/);
  assert.match(html,/role="dialog"/);
  assert.match(html,/aria-label="Customize dashboard"/);
  assert.match(html,/localStorage/);
  assert.match(html,/currentUser/);
  assert.doesNotMatch(html,/\b(INSERT INTO|UPDATE parties|DELETE FROM|fetch\('https?:)\b/i);
});
