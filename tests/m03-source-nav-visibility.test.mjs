import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectSourceNavigation} from '../src/modules/source-nav-visibility.js';

const ui=readFileSync(new URL('../legacy/source/UI.gs',import.meta.url),'utf8');
const browser=readFileSync(new URL('../legacy/source/javascript.html',import.meta.url),'utf8');
const functions=[
  'hasSpecialEditPermission_',
  'hasActionPermission_',
  'actionPermAnyVisible_',
  'navItemVisible_',
  'filterNavByRole_',
  'subNavVisible_',
  'navLandingKey_',
  'firstReachableKey_'
];

function sourceStatement(){
  const start=ui.indexOf('const NAV_ITEMS = [');
  const end=ui.indexOf('\n];',start);
  assert.ok(start>=0 && end>start,'frozen UI.gs nav literal required');
  return ui.slice(start,end+3);
}

function sourceFunction(name){
  const match=browser.match(new RegExp(
    '^  function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}', 'm'
  ));
  assert.ok(match,'frozen browser function '+name+' required');
  return match[0];
}

const sourceProgram=[
  sourceStatement(), ...functions.map(sourceFunction),
  'const groups=filterNavByRole_(NAV_ITEMS);',
  `JSON.stringify({
    sidebarItems:groups,
    groupTabs:groups.filter(g=>Array.isArray(g.children)).map(g=>({
      groupKey:g.key,children:g.children.filter(c=>subNavVisible_(c,g.key))
    })),
    sidebarLandings:groups.map(g=>({groupKey:g.key,pageKey:navLandingKey_(g)})),
    firstPageKey:firstReachableKey_(groups)
  });`
].join('\n');

function oracle(profile){
  return JSON.parse(runInNewContext(sourceProgram,{
    allowedModules:profile.allowedModules,
    userPermissions:profile.permissions
  }));
}
const sourceNav=()=>JSON.parse(runInNewContext(sourceStatement()+'\nJSON.stringify(NAV_ITEMS)'));
const profile=(allowedModules,permissions={})=>({allowedModules,permissions});
const names=items=>items.map(item=>item.key);

test('Administrator sees exact frozen sidebar, all source tabs and POS V2 landing',()=>{
  const admin=profile(null,null);
  const nav=sourceNav();
  const result=projectSourceNavigation(nav,admin);
  assert.deepEqual(result,oracle(admin));
  assert.deepEqual(names(result.sidebarItems),names(nav));
  assert.equal(result.sidebarLandings.find(x=>x.groupKey==='pos').pageKey,'posv2');
  assert.deepEqual(names(result.groupTabs.find(x=>x.groupKey==='sales').children),[
    'sales','draftSales','returns','returnHistory'
  ]);
});

test('cashier source visibility preserves POS V2, draft action and separate refund rights',()=>{
  const cashier=profile(['dashboard','pos','sales'],{
    pos:{add:true},sales:{edit:false}
  });
  const result=projectSourceNavigation(sourceNav(),cashier);
  assert.deepEqual(result,oracle(cashier));
  assert.deepEqual(names(result.sidebarItems),['dashboard','pos','sales']);
  assert.deepEqual(names(result.groupTabs.find(x=>x.groupKey==='sales').children),[
    'sales','draftSales'
  ]);
  assert.equal(result.firstPageKey,'dashboard');
  assert.equal(result.sidebarLandings.find(x=>x.groupKey==='pos').pageKey,'posv2');
});

test('returns-only staff land on Returns rather than Sales invoice',()=>{
  const p=profile(['returns']);
  const result=projectSourceNavigation(sourceNav(),p);
  assert.deepEqual(result,oracle(p));
  assert.deepEqual(names(result.sidebarItems),['sales']);
  assert.deepEqual(names(result.groupTabs[0].children),['returns','returnHistory']);
  assert.equal(result.sidebarLandings[0].pageKey,'returns');
  assert.equal(result.firstPageKey,'returns');
});

test('Settings, Users and Roles tabs retain distinct legacy display permissions',()=>{
  for(const [modules,tabKeys,first] of [
    [['settings'],['settings','invoiceDesign'],'settings'],
    [['users'],['users'],'users'],
    [['roles'],['roles'],'roles']
  ]){
    const p=profile(modules);
    const result=projectSourceNavigation(sourceNav(),p);
    assert.deepEqual(result,oracle(p));
    assert.deepEqual(names(result.sidebarItems),['settings']);
    assert.deepEqual(names(result.groupTabs[0].children),tabKeys);
    assert.equal(result.firstPageKey,first);
  }
});

test('Counter action grant appears without an ordinary view-module grant',()=>{
  const p=profile([],{customers:{edit:true}});
  const result=projectSourceNavigation(sourceNav(),p);
  assert.deepEqual(result,oracle(p));
  assert.deepEqual(names(result.sidebarItems),['counter']);
  assert.equal(result.firstPageKey,'counter');
});

test('no-access role has no sidebar and a predictable noAccess first page',()=>{
  const p=profile([]);
  const result=projectSourceNavigation(sourceNav(),p);
  assert.deepEqual(result,oracle(p));
  assert.deepEqual(result,{
    sidebarItems:[],groupTabs:[],sidebarLandings:[],firstPageKey:'noAccess'
  });
});

test('projection never mutates original source navigation or returns shared nested data',()=>{
  const nav=sourceNav();
  const snapshot=structuredClone(nav);
  const p=profile(['dashboard','sales','returns']);
  const before=structuredClone(p);
  const first=projectSourceNavigation(nav,p);
  first.sidebarItems[0].label='TAMPER';
  first.groupTabs.find(x=>x.groupKey==='sales').children[0].label='TAMPER';
  const second=projectSourceNavigation(nav,p);
  assert.deepEqual(second,oracle(p));
  assert.deepEqual(nav,snapshot);
  assert.deepEqual(p,before);
});

test('missing or malformed role data never defaults to Administrator visibility',()=>{
  const nav=sourceNav();
  for(const invalid of [
    undefined,null,{}, {permissions:null},
    {allowedModules:undefined,permissions:null},
    {allowedModules:'dashboard',permissions:null},
    {allowedModules:[null],permissions:{}},
    {allowedModules:null,permissions:[]}
  ]){
    assert.throws(()=>projectSourceNavigation(nav,invalid),/Invalid|role|profile/i);
  }
  assert.throws(()=>projectSourceNavigation({},profile(null,null)),/Invalid|navigation/i);
});
