import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import worker from '../src/index.js';
import {createM04AuthorizedAppShellReader}
  from '../src/modules/m04-authorized-app-shell-reader.js';

const TOKEN='a'.repeat(64);
const NOW=1_800_000_000_000;
const request=patch=>({token:TOKEN,nowMs:NOW,...patch});
const original=readFileSync(new URL('../legacy/source/UI.gs',import.meta.url),'utf8');
function sourceNav(){
  const start=original.indexOf('const NAV_ITEMS = [');
  const end=original.indexOf('\n];',start);
  assert.ok(start>=0 && end>start);
  return JSON.parse(JSON.stringify(runInNewContext(
    original.slice(start,end+3)+'\nNAV_ITEMS;'
  )));
}
function fakeDb(results){
  const statements=[];
  const bindings=[];
  const env={DB:{prepare(sql){
    statements.push(sql);
    return {bind(...args){
      bindings.push(args);
      return {all:async()=>({success:true,results:results()})};
    }};
  }}};
  return {env,statements,bindings};
}

test('authorized application shell matches original frozen navigation and safe two-key payload',async()=>{
  const db=fakeDb(()=>[
    {key:'Shop Name',value:'নবাবী হার্ডওয়্যার'},
    {key:'Currency Symbol',value:'৳'}
  ]);
  const result=await createM04AuthorizedAppShellReader(db.env).getAppShellData(request());
  assert.deepEqual(result,{success:true,data:{
    shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳',navItems:sourceNav()
  }});
  assert.deepEqual(Object.keys(result.data),['shopName','currencySymbol','navItems']);
  assert.equal(db.statements.length,1,'no unprotected second read is allowed');
  assert.match(db.statements[0],/FROM auth_sessions/);
  assert.match(db.statements[0],/settings\.view/);
  assert.match(db.statements[0],/Shop Name/);
  assert.match(db.statements[0],/Currency Symbol/);
  assert.doesNotMatch(db.statements[0],/Invoice Logo|Phone 1|Delete Confirmation Key/);
  assert.equal(db.bindings.length,1);
  assert.equal(db.bindings[0][0],createHash('sha256')
    .update(Buffer.from(TOKEN,'hex')).digest('hex'));
});

test('authorized shell returns fresh settings and mutation-isolated nested menu on every call',async()=>{
  let name='Shop 1';
  const db=fakeDb(()=>[{key:'Shop Name',value:name}]);
  const read=createM04AuthorizedAppShellReader(db.env);
  const first=await read.getAppShellData(request());
  first.data.navItems[0].label='TAMPER';
  const sales=first.data.navItems.find(item=>item.key==='sales');
  sales.children[0].label='TAMPER';
  const draft=sales.children.find(item=>item.key==='draftSales');
  draft.actionPermAny[0].action='TAMPER';
  name='নতুন দোকান';
  const next=await read.getAppShellData(request());
  assert.equal(next.data.shopName,'নতুন দোকান');
  assert.equal(next.data.currencySymbol,'');
  assert.deepEqual(next.data.navItems,sourceNav());
  assert.equal(db.statements.length,2,'each call must revalidate current authority and settings');
});

test('invalid and unapproved bearer inputs fail before reading or returning navigation',async()=>{
  const db=fakeDb(()=>[]);
  const reader=createM04AuthorizedAppShellReader(db.env);
  await assert.rejects(()=>reader.getAppShellData(request({token:'bad'})),/Invalid/i);
  await assert.rejects(()=>reader.getAppShellData(request({actor:'ADMIN'})),/Invalid/i);
  assert.equal(db.statements.length,0);
  await assert.rejects(()=>reader.getAppShellData(request()),/Denied/i);
  assert.equal(db.statements.length,1);
});

test('public RPC stays disabled without private M04 binding or auth activation',async()=>{
  const origin='https://shererp-shell.invalid';
  const response=await worker.fetch(new Request(origin+'/api/rpc',{
    method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getAppShellData',args:[TOKEN]})
  }),{});
  assert.equal(response.status,501);
  assert.deepEqual(await response.json(),{
    success:false,message:'RPC method not migrated'
  });
});
