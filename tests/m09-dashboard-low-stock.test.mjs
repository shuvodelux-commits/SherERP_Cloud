import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDashboardLowStockCount} from '../src/modules/dashboard-low-stock-read.js';

const frozen=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const start=frozen.indexOf("const lowStockCount = activeRows_('PRODUCTS').reduce(");
const end=frozen.indexOf('}, 0);',start);
assert.ok(start>0 && end>start,'Frozen Dashboard low-stock expression missing');
const originalStatement=frozen.slice(start,end+6);
function sourceOracle(rows){
  return runInNewContext(originalStatement+'\nlowStockCount',{
    activeRows_:key=>{
      assert.equal(key,'PRODUCTS');
      return rows;
    }
  });
}
const product=(status,stock,min)=>({
  Status:status,'Current Stock':stock,'Minimum Stock':min
});
const snapshot=activeProducts=>({activeProducts});

test('source expression counts active stock at/below minimum but excludes exactly Inactive',()=>{
  const rows=[
    product('Active',0,0),product('Active',4,4),product('Active',3,4),
    product('Active',5,4),product('Inactive',0,2),
    product('inactive',0,2),product('',-1,0),
    {...product('Active',0,5),'Product Name':'তারের রোল'}
  ];
  const count=projectDashboardLowStockCount(snapshot(rows));
  assert.equal(count,sourceOracle(rows));
  assert.equal(count,6);
});
test('missing and nonnumeric source numeric cells match original Number comparison',()=>{
  const rows=[
    product('Active','',0),
    product('Active','0','0'),
    product('Active','not-a-number',5),
    product('Active',undefined,5),
    product('Active',null,''),
    product('Active',true,true),
    product('Active',2,undefined),
    product('Active',-4,-3),
    product('Inactive',-9,99)
  ];
  assert.equal(projectDashboardLowStockCount(snapshot(rows)),sourceOracle(rows));
  assert.equal(projectDashboardLowStockCount(snapshot(rows)),5);
});
test('empty, isolated, and frozen source rows do not mutate or leak request state',()=>{
  assert.equal(projectDashboardLowStockCount(snapshot([])),sourceOracle([]));
  const rows=Object.freeze([
    Object.freeze(product('Active','2.5',3)),
    Object.freeze(product('Active','7.2',3))
  ]);
  const input=Object.freeze(snapshot(rows));
  assert.equal(projectDashboardLowStockCount(input),sourceOracle(rows));
  assert.equal(projectDashboardLowStockCount(input),1);
  assert.equal(projectDashboardLowStockCount(snapshot([product('Inactive',0,99)])),0);
});
test('bad or client-forged snapshots fail closed before product arithmetic',()=>{
  for(const bad of [
    null,undefined,[],Promise.resolve({activeProducts:[]}),
    {activeProducts:null},{activeProducts:{}},
    {activeProducts:[],actor:'Administrator'},
    {activeProducts:[],permissions:{products:{edit:true}}},
    {activeProducts:[Promise.resolve(product('Active',0,1))]},
    {activeProducts:[{get Status(){throw Error('GETTER');},'Current Stock':0,'Minimum Stock':1}]},
    {activeProducts:[product('Active',{value:0},1)]},
    {activeProducts:[product('Active',0,Infinity)]},
    {activeProducts:[product('Active',Symbol('0'),1)]},
    {activeProducts:[new Date()]},
    Object.defineProperty({},'activeProducts',{get(){throw Error('GETTER');},enumerable:true})
  ])assert.throws(()=>projectDashboardLowStockCount(bad),/invalid|trusted|product|stock|snapshot|field|array/i);
});
test('no RPC, SQL, stock mutation, Party account or UI edits are introduced',()=>{
  const source=readFileSync(new URL('../src/modules/dashboard-low-stock-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:prepare|batch|fetch|exec)\s*\(/);
  assert.doesNotMatch(source,/\b(?:UPDATE|INSERT|DELETE)\s+(?:PRODUCTS|STOCK_LOTS)/i);
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  const v=projectDashboardLowStockCount(snapshot([product('Active',1,2)]));
  assert.equal(v,1);
  assert.equal(typeof v,'number');
});
