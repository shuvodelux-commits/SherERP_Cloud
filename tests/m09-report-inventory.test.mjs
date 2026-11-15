import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync as spawnSyncNode} from 'node:child_process';
import {auditM09ReportContracts, assertM09Snapshot} from '../scripts/audit-m09-reports.mjs';

const sourceRoot=new URL('../legacy/source/',import.meta.url);
const files=['Reports.gs','Dashboard.gs','DayBook.gs'];
const sources=()=>Object.fromEntries(files.map(name=>[
  name,readFileSync(new URL(name,sourceRoot),'utf8')
]));
const sha='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const scan=(values=sources())=>auditM09ReportContracts({sources:values,sourceCommit:sha});
const find=(data,name)=>data.surfaces.flatMap(s=>s.endpoints).find(e=>e.name===name);

test('audits ten original report, dashboard and Day Book public read endpoints',()=>{
  const data=scan();
  assert.equal(data.sourceCommit,sha);
  assert.equal(data.formatVersion,1);
  assert.deepEqual(data.surfaces.map(s=>[s.sourceFile,s.endpoints.length]),[
    ['Reports.gs',7],['Dashboard.gs',1],['DayBook.gs',2]
  ]);
  assert.equal(find(data,'getSalesReport').permission,'reports:view');
  assert.equal(find(data,'getDashboardStats').permission,'dashboard:view');
  assert.equal(find(data,'getDayBookTransactions').permission,'daybook:view');
  assert.deepEqual(find(data,'getReportsBootstrap').directReads,[]);
  assert.ok(find(data,'getSalesReport').directReads.includes('getAllRows_:SALES'));
  assert.ok(find(data,'getSalesReport').directReads.includes('getAllRows_:CUSTOMER_LEDGER'));
  assert.ok(find(data,'getDashboardStats').directReads.includes('activeRows_:FINANCE_TRANSACTIONS'));
  assert.ok(find(data,'getDayBookTransactions').directReads.includes('getAllRows_:BANK_TRANSFERS'));
  assert.ok(find(data,'getProfitReport').helpers.includes('computeProfit_'));
  assert.ok(find(data,'getBalanceSheetReport').helpers.includes('getInventoryValueAtCost_'));
});

test('auditor is deterministic and never emits business-data values',()=>{
  const first=scan(),second=scan();
  assert.deepEqual(first,second);
  assert.doesNotMatch(JSON.stringify(first),/01700000000|Invoice Test|Rahim/i);
  assert.ok(first.methodology.includes('not transitive'));
});

test('missing source endpoint or removed server permission cannot silently pass',()=>{
  const deleted=sources();
  deleted['DayBook.gs']=deleted['DayBook.gs'].replace('function getDayBookBootstrap(', 'function missingDayBookBootstrap(');
  assert.throws(()=>scan(deleted),/missing.*getDayBookBootstrap/i);
  const unsecured=sources();
  unsecured['Reports.gs']=unsecured['Reports.gs'].replace(
    "requirePermission_(token, 'reports', 'view');",
    "// requirePermission_(token, 'reports', 'view');"
  );
  assert.throws(()=>scan(unsecured),/permission.*getReportsBootstrap|permission.*missing/i);
});

test('live read-source changes are visible but comments are never counted as dependencies',()=>{
  const first=scan(),changed=sources();
  changed['Reports.gs']=changed['Reports.gs'].replace(
    "const allSales = getAllRows_('SALES');",
    "const allSales = getAllRows_('SALES');\n    getAllRows_('STOCK_MOVEMENT');"
  );
  assert.ok(find(scan(changed),'getSalesReport').directReads.includes('getAllRows_:STOCK_MOVEMENT'));
  assert.notDeepEqual(scan(changed),first);
  const ignored=sources();
  ignored['Reports.gs']=ignored['Reports.gs'].replace(
    "const allSales = getAllRows_('SALES');",
    "/* getAllRows_('STOCK_MOVEMENT'); */\n    const allSales = getAllRows_('SALES');"
  );
  assert.deepEqual(scan(ignored),first);
});

test('locked snapshot verifies current source and rejects stale report read contracts',()=>{
  const data=scan();
  assert.doesNotThrow(()=>assertM09Snapshot(data,structuredClone(data)));
  const drift=structuredClone(data);
  drift.surfaces[1].endpoints[0].directReads.pop();
  assert.throws(()=>assertM09Snapshot(data,drift),/drift|mismatch/i);
});

test('CLI --check passes against committed inventory and rejects wrong args',()=>{
  const script=fileURLToPath(new URL('../scripts/audit-m09-reports.mjs',import.meta.url));
  const {spawnSync}=requireSpawnSync();
  const cwd=fileURLToPath(new URL('..',import.meta.url));
  const good=spawnSync(process.execPath,[script,'--check'],{cwd,encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  assert.match(good.stdout,/M09 report contracts verified/i);
  const invalid=spawnSync(process.execPath,[script,'--unexpected'],{cwd,encoding:'utf8'});
  assert.equal(invalid.status,1);
});
function requireSpawnSync(){
  return {spawnSync:spawnSyncNode};
}