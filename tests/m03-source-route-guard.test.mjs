import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {resolveSourceNavigationRoute} from '../src/modules/source-nav-visibility.js';

const ui=readFileSync(new URL('../legacy/source/UI.gs',import.meta.url),'utf8');
const client=readFileSync(new URL('../legacy/source/javascript.html',import.meta.url),'utf8');
const begin=ui.indexOf('const NAV_ITEMS = [');
const finish=ui.indexOf('\n];',begin);
assert.ok(begin>=0&&finish>begin,'frozen UI.gs NAV_ITEMS declaration required');
const navDeclaration=ui.slice(begin,finish+3);

const names=[
  'hasSpecialEditPermission_','hasActionPermission_','actionPermAnyVisible_',
  'navItemVisible_','filterNavByRole_','subNavVisible_',
  'navGroupFor_','firstReachableKey_','moduleHeaderFor_'
];
function originalFunction(name){
  const match=client.match(new RegExp(
    '^  function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'
  ));
  assert.ok(match,'missing original browser '+name);
  return match[0];
}
const guardStart=client.indexOf('  function goToPage(key) {');
const guardEnd=client.indexOf('    currentPage = key;',guardStart);
assert.ok(guardStart>=0&&guardEnd>guardStart,'original goToPage guard required');
const goGuard=client.slice(guardStart,guardEnd+'    currentPage = key;'.length)+
  '\n    return currentPage;\n  }';
const oracleSource=[
  navDeclaration,...names.map(originalFunction),
  goGuard,'var navItems_ = NAV_ITEMS;',
  `const pageKey=goToPage(requestedKey);
   const group=navGroupFor_(pageKey);
   const header=moduleHeaderFor_(pageKey,group);
   const visibleTabs=group&&group.children
      ?group.children.filter(c=>subNavVisible_(c,group.key)):[];
   JSON.stringify({
     pageKey,
     runtimeKey:pageKey==='posv2'?'pos':pageKey,
     parentKey:group?group.key:pageKey,
     moduleHeader:header,
     subTabs:visibleTabs.length<2?[]:visibleTabs,
     posV2Active:pageKey==='posv2'
   });`
].join('\n');
const menu=()=>JSON.parse(runInNewContext(navDeclaration+'\nJSON.stringify(NAV_ITEMS)'));
const profile=(allowedModules,permissions={})=>({allowedModules,permissions});
function sourceOracle(p,requestedKey){
  return JSON.parse(runInNewContext(oracleSource,{
    allowedModules:p.allowedModules,userPermissions:p.permissions,requestedKey
  }));
}
const compare=(p,key)=>{
  const expected=sourceOracle(p,key);
  const actual=resolveSourceNavigationRoute(menu(),p,key);
  assert.deepEqual(actual,expected,`route parity: ${JSON.stringify(p)} -> ${key}`);
  return actual;
};

test('Administrator preserves original unrestricted routes, POS V2 runtime alias, nested header',()=>{
  const admin=profile(null,null);
  for(const key of ['dashboard','posv2','sales','returns','returnHistory',
    'invoiceDesign','users','roles','doesNotExist','noAccess']){
    compare(admin,key);
  }
  const pos=compare(admin,'posv2');
  assert.deepEqual({runtimeKey:pos.runtimeKey,parentKey:pos.parentKey,
    posV2Active:pos.posV2Active},{runtimeKey:'pos',parentKey:'pos',posV2Active:true});
  const child=compare(admin,'returns');
  assert.equal(child.parentKey,'sales');
  assert.equal(child.moduleHeader.title,'Sales');
  assert.equal(child.subTabs.length,4);
  assert.equal(compare(admin,'doesNotExist').pageKey,'doesNotExist',
    'original Administrator has no browser route guard');
});

test('cashier preserves authorized POS V2 but redirects unauthorized pages to Dashboard',()=>{
  const p=profile(['dashboard','pos','sales'],{pos:{add:true}});
  assert.equal(compare(p,'posv2').pageKey,'posv2');
  assert.equal(compare(p,'pos').pageKey,'pos', 'original POS parent route is allowed even without a matching child');
  assert.equal(compare(p,'returns').pageKey,'dashboard');
  assert.equal(compare(p,'notARealRoute').pageKey,'dashboard');
  const sales=compare(p,'sales');
  assert.deepEqual(sales.subTabs.map(item=>item.key),['sales','draftSales']);
});

test('Returns-only staff redirect Sales invoice to Returns and keep the Sales group header',()=>{
  const p=profile(['returns']);
  assert.equal(compare(p,'sales').pageKey,'returns');
  assert.equal(compare(p,'returnHistory').pageKey,'returnHistory');
  const tab=compare(p,'returnHistory');
  assert.deepEqual(tab.subTabs.map(item=>item.key),['returns','returnHistory']);
  assert.equal(tab.moduleHeader.title,'Sales');
  assert.equal(tab.parentKey,'sales');
});

test('Settings, Users and Roles staff grants preserve separate nested routes',()=>{
  for(const [allowed,good,denied] of [
    [['settings'],'invoiceDesign','users'],
    [['users'],'users','invoiceDesign'],
    [['roles'],'roles','settings']
  ]){
    const p=profile(allowed);
    assert.equal(compare(p,good).pageKey,good);
    assert.equal(compare(p,denied).pageKey,allowed[0]==='settings'?'settings':good);
  }
  const p=profile(['users']);
  const result=compare(p,'users');
  assert.equal(result.parentKey,'settings');
  assert.deepEqual(result.subTabs,[],'original subnav strip hidden with fewer than two tabs');
});

test('action-only Counter staff and no-access fallback retain original navigation rules',()=>{
  const counter=profile([],{customers:{edit:true}});
  assert.equal(compare(counter,'counter').pageKey,'counter');
  assert.equal(compare(counter,'products').pageKey,'counter');
  const none=profile([]);
  assert.equal(compare(none,'dashboard').pageKey,'noAccess');
  assert.equal(compare(none,'posv2').pageKey,'noAccess');
  assert.equal(compare(none,'noAccess').pageKey,'noAccess');
  assert.equal(compare(none,'noAccess').moduleHeader.title,'No Access');
});

test('source route projection returns fresh data and does not modify menu or profile',()=>{
  const nav=menu(),p=profile(['dashboard','sales'],{pos:{add:true}});
  const original=structuredClone(nav),savedProfile=structuredClone(p);
  const first=resolveSourceNavigationRoute(nav,p,'draftSales');
  first.moduleHeader.title='TAMPER';
  first.subTabs[0].label='TAMPER';
  const second=resolveSourceNavigationRoute(nav,p,'draftSales');
  assert.deepEqual(second,sourceOracle(p,'draftSales'));
  assert.deepEqual(nav,original);
  assert.deepEqual(p,savedProfile);
});

test('missing/malformed navigation or role metadata never defaults to Administrator',()=>{
  const nav=menu();
  for(const invalid of [undefined,null,{}, {permissions:{}},
    {allowedModules:undefined,permissions:{}},
    {allowedModules:'dashboard',permissions:{}}]){
    assert.throws(()=>resolveSourceNavigationRoute(nav,invalid,'dashboard'),/Invalid|role|profile/i);
  }
  assert.throws(()=>resolveSourceNavigationRoute({},profile(null,null),'dashboard'),/Invalid|navigation/i);
});
