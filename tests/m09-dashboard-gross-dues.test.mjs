import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectDashboardGrossDues} from '../src/modules/dashboard-gross-dues-read.js';

const dashboard=readFileSync(new URL('../legacy/source/Dashboard.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
function sourceFunction(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen Utils function not found: '+name);
  const end=source.indexOf('\n}\n',start);
  assert.ok(end>start,'Cannot find frozen Utils function end');
  return source.slice(start,end+3);
}
function sourceReduce(sheet,name){
  const begin=dashboard.indexOf('const '+name+" = activeRows_('"+sheet+"').reduce(");
  assert.ok(begin>=0,'Frozen Dashboard reduce missing: '+name);
  const end=dashboard.indexOf('}, 0);',begin);
  assert.ok(end>begin,'Frozen Dashboard reduce end missing: '+name);
  return dashboard.slice(begin,end+'}, 0);'.length);
}
const source=[
  sourceFunction(utils,'roundMoney_'),
  sourceReduce('CUSTOMERS','dueReceivable'),
  sourceReduce('SUPPLIERS','supplierPayable')
].join('\n');
const oracle=(input)=>JSON.parse(JSON.stringify(runInNewContext(source+`
  ({dueReceivable:roundMoney_(dueReceivable),
    supplierPayable:roundMoney_(supplierPayable)})`,{
    activeRows_:group=>{
      if(group==='CUSTOMERS')return input.activeCustomers;
      if(group==='SUPPLIERS')return input.activeSuppliers;
      throw Error('Source group not allowed: '+group);
    }
  })));
const record=(id,currentDue)=>({'Customer ID':id,'Supplier ID':id,'Current Due':currentDue});
const input=(customers=[],suppliers=[])=>({activeCustomers:customers,activeSuppliers:suppliers});

test('frozen source keeps Customer AR and Supplier AP as two independent gross Dashboard totals',()=>{
  const sample=input(
    [record('CUS-1',110.125),record('CUS-2',-70),record('CUS-3',9.875)],
    [record('SUP-1',-1000),record('SUP-2',25.125),record('SUP-3',44.875)]
  );
  assert.deepEqual(projectDashboardGrossDues(sample),oracle(sample));
  assert.deepEqual(projectDashboardGrossDues(sample),{
    dueReceivable:120,supplierPayable:70
  });
});
test('identical names and mixed Party roles NEVER produce a cross-role net or join',()=>{
  const sample=input(
    [{...record('CUS-15','100'),'Name':'Same Party'}],
    [{...record('SUP-29','250'),'Name':'Same Party'}]
  );
  assert.deepEqual(projectDashboardGrossDues(sample),oracle(sample));
  assert.deepEqual(projectDashboardGrossDues(sample),{
    dueReceivable:100,supplierPayable:250
  });
  assert.deepEqual(Object.keys(projectDashboardGrossDues(sample)),[
    'dueReceivable','supplierPayable'
  ]);
});
test('source numeric coercion for blank, null, missing, NaN and negative due is preserved',()=>{
  const sample=input([
    record('A',''),record('B',null),record('C',undefined),record('D','not-number'),
    record('E',-100),record('F',true),record('G',NaN)
  ],[
    record('A','2.50'),record('B',false),record('C','not-number'),
    record('D',-12),record('E',undefined)
  ]);
  assert.deepEqual(projectDashboardGrossDues(sample),oracle(sample));
  assert.deepEqual(projectDashboardGrossDues(sample),{dueReceivable:1,supplierPayable:2.5});
});
test('roundMoney is source-applied only once after summing unrounded positive entries',()=>{
  const sample=input([record('A',0.004),record('B',0.004),record('C',0.004)],
    [record('D',10.125),record('E',0.125)]);
  assert.deepEqual(projectDashboardGrossDues(sample),oracle(sample));
  assert.equal(projectDashboardGrossDues(sample).dueReceivable,0.01);
});
test('empty, isolated and immutable source lists do not mutate input or leak totals across calls',()=>{
  assert.deepEqual(projectDashboardGrossDues(input()),oracle(input()));
  const sample=Object.freeze({
    activeCustomers:Object.freeze([Object.freeze(record('C',21))]),
    activeSuppliers:Object.freeze([Object.freeze(record('S',11))])
  });
  assert.deepEqual(projectDashboardGrossDues(sample),oracle(sample));
  assert.equal(projectDashboardGrossDues(input()).supplierPayable,0);
});
test('unsafe caller-supplied context or malformed rows fail before any aggregation',()=>{
  for(const broken of [
    null,undefined,[],Promise.resolve(input()),{activeCustomers:[]},
    {...input(),actor:'Administrator'},{...input(),tenantId:'other-business'},
    {...input(),permissions:{dashboard:{view:true}}},
    {activeCustomers:[Promise.resolve(record('C',5))],activeSuppliers:[]},
    {activeCustomers:[record('C',{number:5})],activeSuppliers:[]},
    {activeCustomers:[],activeSuppliers:[record('S',Infinity)]},
    {activeCustomers:[],activeSuppliers:[record('S',Symbol('5'))]},
    {activeCustomers:[new Date()],activeSuppliers:[]},
    {activeCustomers:[Object.defineProperty(record('C',5),'Current Due',{
      get(){throw Error('GOT ACCESSOR');},enumerable:true})],activeSuppliers:[]},
    Object.defineProperty({},'activeCustomers',{get(){throw Error('GETTER');},enumerable:true}),
    {activeCustomers:new Array(1),activeSuppliers:[]},
  ])assert.throws(()=>projectDashboardGrossDues(broken),/invalid|trusted|snapshot|row|amount|array|field/i);
});
test('pure M09 projection introduces no public RPC, D1 read/write or Party netting',()=>{
  const implementation=readFileSync(new URL('../src/modules/dashboard-gross-dues-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(implementation,/\b(?:prepare|batch|fetch|exec)\s*\(/);
  assert.doesNotMatch(implementation,/\b(?:INSERT|UPDATE|DELETE)\s+/i);
  assert.match(dashboard,/requirePermission_\(token, 'dashboard', 'view'\)/);
  const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(Object.hasOwn(projectDashboardGrossDues(input()),'netPartyBalance'),false);
});
