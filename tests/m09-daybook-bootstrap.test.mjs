import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../legacy/source/daybook.html',import.meta.url),'utf8');
const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
const start=source.indexOf('const DAY_BOOK_MODULES = [');
const stop=source.indexOf('\n];',start);
assert.ok(start>=0 && stop>start,'Pinned DAY_BOOK_MODULES unavailable');
const begin=source.indexOf('function getDayBookBootstrap(token) {');
const end=source.indexOf('\n}',begin);
assert.ok(begin>=0 && end>begin,'Pinned Day Book bootstrap unavailable');
const native=source.slice(start,stop+3)+'\n'+source.slice(begin,end+2);
const json=value=>JSON.parse(JSON.stringify(value));
function oracle(settings,actor){
  const ctx={
    token:'authorized-daybook',
    requirePermission_:(token,module,action)=>{
      assert.equal(token,'authorized-daybook');
      assert.equal(module,'daybook');
      assert.equal(action,'view');
      return actor;
    },
    getSettingsMap_:()=>settings,
    ok_:x=>x,
    fail_:message=>{throw Error('Frozen Day Book error: '+message);},
    logError_:()=>{}
  };
  return json(runInNewContext(native+'\ngetDayBookBootstrap(token)',ctx));
}
const impl=await import('../src/modules/daybook-bootstrap-read.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(settings,actor){
  assert.equal(typeof impl?.projectDayBookBootstrap,'function',
    'M09 Day Book bootstrap projection not implemented');
  return impl.projectDayBookBootstrap(settings,actor);
}
function parity(settings,actor){
  const actual=json(project(settings,actor));
  const expected=oracle(settings,actor);
  assert.deepEqual(actual,expected);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
  return actual;
}
const admin={Role:'Administrator'},staff={Role:'Cashier'};
const MODULES=[
  'Sales','Sales Return','Purchase','Purchase Return',
  'Customer Payment','Customer Advance Refund','Supplier Payment','Expense','Finance',
  'Bank','Bank Transfer','Stock Adjustment'
];

test('source-parity four fields and exact 12 Day Book module labels',()=>{
  const result=parity({},admin);
  assert.deepEqual(result,{
    currencySymbol:'',editableDays:0,modules:MODULES,isAdmin:true
  });
  assert.deepEqual(Object.keys(result),['currencySymbol','editableDays','modules','isAdmin']);
});
test('staff and Administrator projection uses trusted authenticated role, never navigation metadata',()=>{
  for(const role of ['Cashier','Reporter','administrator','Admin','']){
    assert.equal(parity({'Currency Symbol':'৳'}, {Role:role}).isAdmin,false);
  }
  assert.equal(parity({'Currency Symbol':'৳'},admin).isAdmin,true);
  assert.equal(parity({'Currency Symbol':'৳'},staff).currencySymbol,'৳');
});
test('editableDays follows Number(setting) || 0 on trusted scalars',()=>{
  for(const value of [undefined,null,'',0,'0','3',3,2.5,'-2','not-a-number',false,true]){
    const settings={'Day Book Editable Days':value};
    assert.equal(parity(settings,staff).editableDays,Number(value)||0,String(value));
  }
  assert.equal(parity({'Currency Symbol':' BDT ','Day Book Editable Days':'7'},staff).currencySymbol,' BDT ');
});
test('private settings do not leak; original read metadata and mutable module array are isolated',()=>{
  const settings=Object.freeze({'Currency Symbol':'৳','JWT_SECRET':'PRIVATE','Phone 1':'SENSITIVE'});
  const first=parity(settings,admin),second=parity(settings,admin);
  assert.doesNotMatch(JSON.stringify(first),/PRIVATE|SENSITIVE/);
  assert.notStrictEqual(project(settings,admin).modules,project(settings,admin).modules);
  first.modules.push('Injected');
  assert.deepEqual(parity(settings,admin).modules,MODULES);
  assert.equal(second.modules.length,12);
});
test('untrusted Settings maps and actor shapes fail closed rather than executing getters',()=>{
  for(const value of [null,undefined,[],Promise.resolve({}),42,
    Object.create({'Currency Symbol':'inherited'}),
    {'Currency Symbol':[]},{'Day Book Editable Days':{}},
    {'Day Book Editable Days':Infinity}]){
    assert.throws(()=>project(value,staff),/trusted|invalid|settings|scalar|object|finite/i);
  }
  for(const actor of [null,undefined,[],{Role:{name:'Administrator'}},Promise.resolve(admin),
    Object.create({Role:'Administrator'}),{get Role(){throw Error('getter ran');}}]){
    assert.throws(()=>project({},actor),/trusted|invalid|actor|role|accessor/i);
  }
  assert.throws(()=>project({get 'Currency Symbol'(){throw Error('getter ran');}},staff),/trusted|invalid|settings|accessor/i);
});
test('original Day Book UI continues its own calls and public RPC stays fail-closed',()=>{
  assert.match(ui,/serverCall\('getDayBookBootstrap', authToken\)/);
  assert.match(ui,/serverCall\('getDayBookTransactions', authToken, filters\)/);
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.match(source,/requirePermission_\(token, 'daybook', 'view'\)/);
  assert.equal(typeof impl?.projectDayBookBootstrap,'function',
    'M09 Day Book bootstrap projection not implemented');
  const code=readFileSync(new URL('../src/modules/daybook-bootstrap-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(code,/function\s+getDayBookBootstrap\s*\(/);
});
