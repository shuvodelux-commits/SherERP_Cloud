import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {projectSourceNavigationLayout}
  from '../src/modules/source-nav-visibility.js';

const ui=readFileSync(new URL('../legacy/source/UI.gs',import.meta.url),'utf8');
const client=readFileSync(new URL('../legacy/source/javascript.html',import.meta.url),'utf8');
const names=[
  'hasSpecialEditPermission_','hasActionPermission_','actionPermAnyVisible_',
  'navItemVisible_','filterNavByRole_','subNavVisible_',
  'sidebarItemsInOrder_','navLandingKey_','navGroupFor_'
];
const extractFunction=name=>{
  const m=client.match(new RegExp(
    '^  function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}','m'
  ));
  assert.ok(m,'original javascript.html function '+name+' must exist');
  return m[0];
};
const start=ui.indexOf('const NAV_ITEMS = [');
const end=ui.indexOf('\n];',start);
assert.ok(start!==-1&&end>start,'frozen UI.gs NAV_ITEMS');
const sourceMenu=ui.slice(start,end+3);
const primaryMatch=client.match(/var MOBILE_PRIMARY_KEYS_ = \[[^\n]+\];/);
assert.ok(primaryMatch,'frozen mobile primary keys');

const oracleProgram=[
  sourceMenu,
  primaryMatch[0],
  ...names.map(extractFunction),
  'var navItems_ = NAV_ITEMS;',
  `
  const visible=filterNavByRole_(NAV_ITEMS);
  const sorted=sidebarItemsInOrder_(visible);
  let group=null;
  const desktop=sorted.map(item=>{
    const next=Number(item.sidebarGroup);
    const dividerBefore=group!==null&&next!==group;
    group=next;
    return {key:item.key,landingKey:navLandingKey_(item),dividerBefore};
  });
  const primaryVisibleKeys=MOBILE_PRIMARY_KEYS_.filter(key=>
    visible.some(item=>item.key===key));
  const more=visible.filter(item=>
    MOBILE_PRIMARY_KEYS_.indexOf(item.key)===-1).map(item=>({
      key:item.key,landingKey:navLandingKey_(item)
    }));
  const activeGroup=navGroupFor_(currentPage);
  const parentKey=activeGroup?activeGroup.key:currentPage;
  const activeKey=MOBILE_PRIMARY_KEYS_.indexOf(parentKey)!==-1
    ?parentKey:'more';
  const activeMore=more.find(item=>{
    const target=navGroupFor_(item.landingKey);
    return target&&activeGroup&&target.key===activeGroup.key;
  });
  JSON.stringify({desktop,mobile:{
    primaryVisibleKeys,more,activeKey,
    activeMoreKey:activeMore?activeMore.key:null
  }});
  `
].join('\n');
const menu=()=>JSON.parse(runInNewContext(sourceMenu+'\nJSON.stringify(NAV_ITEMS)'));
const profile=(allowedModules,permissions={})=>({allowedModules,permissions});
const original=(p,currentPage)=>JSON.parse(runInNewContext(oracleProgram,{
  allowedModules:p.allowedModules,userPermissions:p.permissions,currentPage
}));
const projection=(p,page)=>projectSourceNavigationLayout(menu(),p,page);
const keys=items=>items.map(item=>item.key);

test('Administrator desktop source-order sort differs from unsorted mobile More order',()=>{
  const p=profile(null,null);
  const expected=original(p,'dashboard');
  const result=projection(p,'dashboard');
  assert.deepEqual(result,expected);
  assert.deepEqual(result.mobile.primaryVisibleKeys,
    ['dashboard','pos','sales','products']);
  assert.ok(keys(result.desktop).indexOf('customers')<
    keys(result.desktop).indexOf('products'),
    'desktop orders Customers(40) before Products(45)');
  assert.ok(keys(result.mobile.more).indexOf('suppliers')<
    keys(result.mobile.more).indexOf('customers'),
    'mobile More keeps original NAV_ITEMS order');
  assert.equal(result.desktop[0].dividerBefore,false);
  assert.ok(result.desktop.some(item=>item.dividerBefore));
});

test('cashier POS V2 active mobile POS with source dividers and drafts',()=>{
  const p=profile(['dashboard','pos','sales'],{pos:{add:true}});
  const result=projection(p,'posv2');
  assert.deepEqual(result,original(p,'posv2'));
  assert.deepEqual(result.mobile.primaryVisibleKeys,['dashboard','pos','sales']);
  assert.deepEqual(result.mobile.more,[]);
  assert.equal(result.mobile.activeKey,'pos');
  assert.equal(result.mobile.activeMoreKey,null);
  assert.equal(result.desktop.find(item=>item.key==='pos').landingKey,'posv2');
});

test('returns-only staff keeps Sales mobile bottom active and Returns desktop target',()=>{
  const p=profile(['returns']);
  const result=projection(p,'returnHistory');
  assert.deepEqual(result,original(p,'returnHistory'));
  assert.deepEqual(result.mobile.primaryVisibleKeys,['sales']);
  assert.deepEqual(result.mobile.more,[]);
  assert.equal(result.mobile.activeKey,'sales');
  assert.equal(result.desktop[0].landingKey,'returns');
});

test('Settings group and nested Invoice Design highlight mobile More',()=>{
  const p=profile(['settings']);
  const result=projection(p,'invoiceDesign');
  assert.deepEqual(result,original(p,'invoiceDesign'));
  assert.deepEqual(result.mobile.primaryVisibleKeys,[]);
  assert.deepEqual(keys(result.mobile.more),['settings']);
  assert.equal(result.mobile.more[0].landingKey,'settings');
  assert.equal(result.mobile.activeKey,'more');
  assert.equal(result.mobile.activeMoreKey,'settings');
});

test('Counter action-only staff expose Counter in mobile More without ordinary view',()=>{
  const p=profile([],{bank:{add:true}});
  const result=projection(p,'counter');
  assert.deepEqual(result,original(p,'counter'));
  assert.deepEqual(keys(result.mobile.more),['counter']);
  assert.equal(result.mobile.activeKey,'more');
  assert.equal(result.mobile.activeMoreKey,'counter');
});

test('no-access and unknown-route active states reproduce original mobile fallback',()=>{
  const p=profile([]);
  for(const page of ['noAccess','bogus']){
    const result=projection(p,page);
    assert.deepEqual(result,original(p,page));
    assert.deepEqual(result,{desktop:[],mobile:{
      primaryVisibleKeys:[],more:[],activeKey:'more',activeMoreKey:null
    }});
  }
});

test('layout projection rejects malformed role/navigation input and never mutates data',()=>{
  const source=menu(), snapshot=structuredClone(source);
  const p=profile(['dashboard','settings']);
  const before=structuredClone(p);
  const one=projectSourceNavigationLayout(source,p,'settings');
  one.mobile.more[0].key='TAMPER';
  one.desktop[0].landingKey='TAMPER';
  const two=projectSourceNavigationLayout(source,p,'settings');
  assert.deepEqual(two,original(p,'settings'));
  assert.deepEqual(source,snapshot);
  assert.deepEqual(p,before);
  assert.throws(()=>projectSourceNavigationLayout(source,{},'dashboard'),/Invalid/i);
  assert.throws(()=>projectSourceNavigationLayout({},p,'dashboard'),/Invalid/i);
});
