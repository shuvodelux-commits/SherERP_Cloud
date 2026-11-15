import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import worker from '../src/index.js';
import {createSourceShapedAppShellReader} from '../src/modules/source-app-shell-reader.js';

const source=readFileSync(new URL('../legacy/source/UI.gs',import.meta.url),'utf8');
const compiled=readFileSync(new URL('../src/modules/source-app-shell-reader.js',import.meta.url),'utf8');
const statement=()=>{
  const start=source.indexOf('const NAV_ITEMS = [');
  assert.notEqual(start,-1,'pinned source UI.gs must expose NAV_ITEMS');
  const end=source.indexOf('\n];',start);
  assert.notEqual(end,-1);
  return source.slice(start,end+3);
};
const oracle=()=>JSON.parse(JSON.stringify(runInNewContext(statement()+'\nNAV_ITEMS;')));
function fakeD1(rows=[]){
  const seen=[];
  return {
    seen,
    env:{DB:{prepare(sql){
      seen.push(sql);
      return {bind(limit){
        seen.push(['limit',limit]);
        return {all:async()=>({success:true,results:rows.map(x=>({...x}))})};
      }};
    }}},
  };
}
test('NAV_ITEMS literal copied byte-for-byte from frozen UI.gs and preserves all hierarchy',async()=>{
  assert.ok(compiled.includes(statement()),'source list must be copied exactly, not approximated');
  const {env}=fakeD1();
  const result=await createSourceShapedAppShellReader(env).getAppShellData();
  assert.deepEqual(result,{success:true,data:{
    shopName:'Hardware Store ERP',currencySymbol:'',navItems:oracle()
  }});
  assert.ok(result.data.navItems.some(x=>x.key==='pos'&&x.landingKey==='posv2'&&
    x.children?.some(y=>y.key==='posv2')));
  assert.ok(result.data.navItems.some(x=>x.key==='sales'&&
    x.children?.some(y=>y.key==='returns')));
  assert.ok(result.data.navItems.some(x=>x.key==='settings'&&
    x.children?.some(y=>y.key==='users')&&x.children?.some(y=>y.key==='roles')));
});

test('shop header reads only two allowlisted SQL keys; private settings stay unqueried',async()=>{
  const {env,seen}=fakeD1([
    {key:'Shop Name',value:'নবাবী হার্ডওয়্যার'},
    {key:'Currency Symbol',value:'৳'},
  ]);
  const result=await createSourceShapedAppShellReader(env).getAppShellData();
  assert.deepEqual(Object.keys(result),['success','data']);
  assert.deepEqual(Object.keys(result.data),['shopName','currencySymbol','navItems']);
  assert.equal(result.data.shopName,'নবাবী হার্ডওয়্যার');
  assert.equal(result.data.currencySymbol,'৳');
  assert.equal(seen.filter(x=>typeof x==='string').length,1);
  assert.match(seen[0],/key IN \('Shop Name','Currency Symbol'\)/);
  assert.equal(/Phone 1|Email|Invoice Logo|Delete Confirmation Key|password|auth_users/i.test(seen[0]),false);
  assert.deepEqual(seen[1],['limit',3]);
});

test('reader returns fresh navigation copies, including nested children and permission descriptors',async()=>{
  const reader=createSourceShapedAppShellReader(fakeD1().env);
  const first=await reader.getAppShellData();
  const second=await reader.getAppShellData();
  assert.notEqual(first,second);
  assert.notEqual(first.data.navItems,second.data.navItems);
  first.data.navItems[0].label='TAMPER';
  const sales=first.data.navItems.find(x=>x.key==='sales');
  sales.children[0].label='TAMPER CHILD';
  const draft=sales.children.find(x=>x.key==='draftSales');
  draft.actionPermAny[0].action='TAMPER ACTION';
  const next=await reader.getAppShellData();
  assert.deepEqual(next.data.navItems,oracle());
  assert.deepEqual(second.data.navItems,oracle());
});

test('success requires actual D1 binding and valid settings; never returns a forged fallback',async()=>{
  assert.throws(()=>createSourceShapedAppShellReader({}),/D1|binding/i);
  const fail={DB:{prepare(){return {bind(){return {all:async()=>({success:false,results:[]})}}}}}};
  await assert.rejects(()=>createSourceShapedAppShellReader(fail).getAppShellData(),/Settings|D1|invalid/i);
  const wrong={DB:{prepare(){return {bind(){return {all:async()=>({success:true,results:[
    {key:'Phone 1',value:'01710000000'}
  ]})}}}}}};
  await assert.rejects(()=>createSourceShapedAppShellReader(wrong).getAppShellData(),/invalid|unsafe|key/i);
});

test('public getAppShellData stays 501 without private D1 or RPC registry activation',async()=>{
  const origin='https://shererp-shell.invalid';
  const result=await worker.fetch(new Request(origin+'/api/rpc',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getAppShellData',args:[]}),
  }),{});
  assert.equal(result.status,501);
  assert.deepEqual(await result.json(),{success:false,message:'RPC method not migrated'});
});
