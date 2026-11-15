import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const reports=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
const config=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../legacy/source/reports.html',import.meta.url),'utf8');
const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');

const appNameMatch=config.match(/\bAPP_NAME:\s*("(?:[^"\\]|\\.)*")/);
assert.ok(appNameMatch,'Pinned Config.gs APP_NAME missing');
const appName=JSON.parse(appNameMatch[1]);
function native(name){
  const start=reports.indexOf('function '+name+'(');
  assert.ok(start>=0,'Pinned Reports.gs missing '+name);
  const end=reports.indexOf('\n}',start);
  assert.ok(end>start,'Unable to read frozen '+name);
  return reports.slice(start,end+2);
}
const typesStart=reports.indexOf('const REPORT_TYPES = [');
const typesEnd=reports.indexOf('\n];',typesStart);
assert.ok(typesStart>=0 && typesEnd>typesStart,'Pinned REPORT_TYPES missing');
const sourceCode=reports.slice(typesStart,typesEnd+3)+'\n'+native('getReportsBootstrap');
const json=x=>JSON.parse(JSON.stringify(x));
function oracle(settings,today='2026-11-15'){
  const ctx={
    token:'authorized-reports-bootstrap',
    requirePermission_:(token,section,action)=>{
      assert.equal(token,'authorized-reports-bootstrap');
      assert.equal(section,'reports');
      assert.equal(action,'view');
    },
    getSettingsMap_:()=>settings,
    formatDate_:()=>today,
    CONFIG:{APP_NAME:appName},
    ok_:x=>x,
    fail_:message=>{throw Error('Frozen GAS bootstrap failed: '+message);},
    logError_:()=>{}
  };
  return json(runInNewContext(
    sourceCode+'\ngetReportsBootstrap(token)',ctx
  ));
}
const impl=await import('../src/modules/reports-bootstrap-read.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function project(settings,today){
  assert.equal(typeof impl?.projectReportsBootstrap,'function',
    'M09 Reports bootstrap read projection not implemented');
  return impl.projectReportsBootstrap(settings,arguments.length<2?'2026-11-15':today);
}
function parity(settings,today='2026-11-15'){
  const result=json(project(settings,today));
  const original=oracle(settings,today);
  assert.deepEqual(result,original);
  assert.deepEqual(Object.keys(result),Object.keys(original));
  return result;
}

test('original full report bootstrap response uses exactly six ordered Report Types and shop defaults',()=>{
  const result=parity({});
  assert.deepEqual(result,{
    reportTypes:[
      {key:'sales',label:'Sales'},
      {key:'purchase',label:'Purchase'},
      {key:'stock',label:'Stock & Valuation'},
      {key:'cashbank',label:'Cash & Bank'},
      {key:'profit',label:'Profit'},
      {key:'balancesheet',label:'Balance Sheet'}
    ],
    currencySymbol:'',
    shopName:appName,
    defaultFrom:'2026-11-01',
    defaultTo:'2026-11-15'
  });
});

test('original Currency Symbol and Shop Name are preserved without trimming or translation',()=>{
  const settings={'Currency Symbol':'৳','Shop Name':'মেসার্স রশিদ হার্ডওয়্যার'};
  const result=parity(settings);
  assert.equal(result.currencySymbol,'৳');
  assert.equal(result.shopName,'মেসার্স রশিদ হার্ডওয়্যার');
  const withSpaces=parity({'Currency Symbol':' BDT ','Shop Name':' Shop  '});
  assert.equal(withSpaces.currencySymbol,' BDT ');
  assert.equal(withSpaces.shopName,' Shop  ');
});

test('source falsey settings fallback separately; truthy primitive sheet values retain their original type',()=>{
  for(const empty of [undefined,null,'',0,false,NaN]){
    const settings={'Currency Symbol':empty,'Shop Name':empty};
    const result=parity(settings);
    assert.equal(result.currencySymbol,'');
    assert.equal(result.shopName,appName);
  }
  const result=parity({'Currency Symbol':123,'Shop Name':true});
  assert.equal(result.currencySymbol,123);
  assert.equal(result.shopName,true);
});

test('shop-local default dates cover year boundary and leap-year month without UTC inference',()=>{
  for(const day of ['2026-01-01','2026-12-31','2024-02-29','2026-11-15']){
    const r=parity({},day);
    assert.equal(r.defaultTo,day);
    assert.equal(r.defaultFrom,day.slice(0,8)+'01');
  }
});

test('bootstrap does not expose financial account balances, Parties, or unauthorized settings fields',()=>{
  const settings={
    'Currency Symbol':'৳','Shop Name':'Sample',
    'JWT_SECRET':'DO-NOT-LEAK',
    'Bank Account':'private data',
    'Admin Phone':'private phone'
  };
  const result=parity(settings);
  assert.deepEqual(Object.keys(result),[
    'reportTypes','currencySymbol','shopName','defaultFrom','defaultTo'
  ]);
  assert.doesNotMatch(JSON.stringify(result),/DO-NOT-LEAK|private data|private phone/);
});

test('each read is isolated: returned reportTypes cannot mutate later requests or Settings map',()=>{
  const settings={'Currency Symbol':'৳','Shop Name':'Hardware'};
  const before=json(settings);
  const first=parity(settings),second=parity(settings);
  assert.notStrictEqual(first.reportTypes,second.reportTypes);
  first.reportTypes[0].label='MALICIOUS';
  first.reportTypes.push({key:'rogue',label:'Rogue'});
  const next=parity(settings);
  assert.equal(next.reportTypes.length,6);
  assert.equal(next.reportTypes[0].label,'Sales');
  assert.deepEqual(settings,before);
});

test('reject malformed, Promise, inherited, proxy-like and accessor Settings map instead of reading unsafe data',()=>{
  for(const settings of [
    null,undefined,[],Promise.resolve({}),new Map(),42,
    Object.create({'Shop Name':'inherited'}),
    {'Currency Symbol':{value:'৳'}},
    {'Currency Symbol':Promise.resolve('৳')},
    {'Shop Name':['not','a','scalar']},
    {'Shop Name':Infinity}
  ])assert.throws(()=>project(settings),/settings|trusted|object|accessor|scalar|invalid|finite/i);
  const getter={get 'Shop Name'(){throw Error('DO NOT EXECUTE GETTER');}};
  assert.throws(()=>project(getter),/settings|accessor|trusted/i);
  const inherited=Object.create(null);
  inherited['Currency Symbol']='৳';
  assert.deepEqual(parity(inherited).currencySymbol,'৳');
});

test('invalid shop-local today fails closed rather than giving incorrect report date ranges',()=>{
  for(const day of [null,undefined,123,'2026-02-30','2025-02-29','2026-11-15T10:00:00+06:00','2026-00-15']){
    assert.throws(()=>project({},day),/today|date|trusted/i);
  }
});

test('UI source bootstrap contract retains exactly one getReportsBootstrap call and six matching report RPC calls',()=>{
  const sourceCalls=[...ui.matchAll(/serverCall\('(?<method>get(?:ReportsBootstrap|SalesReport|PurchaseReport|StockReport|CashBankReport|ProfitReport|BalanceSheetReport))',\s*authToken/g)]
    .map(x=>x.groups.method);
  assert.deepEqual(sourceCalls,[
    'getSalesReport','getPurchaseReport','getStockReport',
    'getCashBankReport','getProfitReport','getBalanceSheetReport','getReportsBootstrap'
  ]);
  const result=parity({});
  assert.deepEqual(result.reportTypes.map(x=>x.key),
    ['sales','purchase','stock','cashbank','profit','balancesheet']);
  assert.match(ui,/id="rptPrintShop"/);
  assert.match(ui,/rptState\.currency = d\.currencySymbol \|\| ''/);
});

test('read projection never enables the public RPC, touches D1, or mutates original GAS/HTML',()=>{
  const source=readFileSync(new URL('../src/modules/reports-bootstrap-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(source,/function\s+getReportsBootstrap\s*\(/);
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.match(reports,/function getReportsBootstrap\(token\)/);
  const settings={'Shop Name':'Unique','Currency Symbol':'৳'};
  parity(settings);
  assert.deepEqual(settings,{'Shop Name':'Unique','Currency Symbol':'৳'});
});
