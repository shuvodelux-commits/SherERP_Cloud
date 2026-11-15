import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {createSettingsReadAdapter} from '../../src/db/settings-read.js';
import {createGuardedShellSettingsUpdateAdapter} from '../../src/db/settings-update.js';

const harness=createTestHarness({workers:[{configPath:'./wrangler.m03-settings-test.jsonc'}]});
const worker=harness.getWorker('shererp-m03-settings-local-test');
let DB;
before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
});
beforeEach(async()=>{await DB.prepare('DELETE FROM settings').run();});
after(async()=>{await harness.close();});
const reader=()=>createSettingsReadAdapter({DB});
const insert=async(key,value,legacyRow=null)=>
  DB.prepare('INSERT INTO settings(key,value,legacy_sheet_row) VALUES(?,?,?)').bind(key,value,legacyRow).run();
const records=async()=> (await DB.prepare('SELECT key,value,legacy_sheet_row FROM settings ORDER BY row_id').all()).results.map(x=>({...x}));

test('empty D1 settings map stays empty, never silently seeds defaults; shell matches source fallback',async()=>{
  const map=await reader().getSettingsMap_();
  assert.equal(Object.getPrototypeOf(map),null);
  assert.deepEqual({...map},{});
  assert.deepEqual(await reader().getAppShellSettings_(),
    {shopName:'Hardware Store ERP',currencySymbol:''});
});

test('actual D1 Settings Key/Value read preserves unicode, phone zeros and explicit boolean text',async()=>{
  await insert('Shop Name','নবাবী হার্ডওয়্যার',2);
  await insert('Phone 1','01700001234',3);
  await insert('POS Show Purchase Price','false',4);
  await insert('Tax Percent','0.50',5);
  await insert('Invoice Payment Methods','[]',6);
  const map=await reader().getSettingsMap_();
  assert.equal(Object.getPrototypeOf(map),null);
  assert.deepEqual({...map},{
    'Shop Name':'নবাবী হার্ডওয়্যার','Phone 1':'01700001234',
    'POS Show Purchase Price':'false','Tax Percent':'0.50',
    'Invoice Payment Methods':'[]'
  });
  assert.deepEqual(await reader().getAppShellSettings_(),
    {shopName:'নবাবী হার্ডওয়্যার',currencySymbol:''});
  assert.deepEqual(await records(),[
    {key:'Shop Name',value:'নবাবী হার্ডওয়্যার',legacy_sheet_row:2},
    {key:'Phone 1',value:'01700001234',legacy_sheet_row:3},
    {key:'POS Show Purchase Price',value:'false',legacy_sheet_row:4},
    {key:'Tax Percent',value:'0.50',legacy_sheet_row:5},
    {key:'Invoice Payment Methods',value:'[]',legacy_sheet_row:6}
  ]);
});

test('safe shell projects only source-approved keys, never contacts, passwords, logos or arbitrary settings',async()=>{
  await insert('Shop Name','Shop A');
  await insert('Currency Symbol','৳');
  await insert('Phone 1','01712345678');
  await insert('Email','private@example.com');
  await insert('Invoice Logo','data:image/png;base64,TOP_SECRET');
  await insert('Delete Confirmation Key','NEVER_EXPOSE');
  const shell=await reader().getAppShellSettings_();
  assert.deepEqual(shell,{shopName:'Shop A',currencySymbol:'৳'});
  assert.deepEqual(Object.keys(shell),['shopName','currencySymbol']);
  assert.equal(JSON.stringify(shell).includes('private@example.com'),false);
  assert.equal(JSON.stringify(shell).includes('TOP_SECRET'),false);
  assert.equal(JSON.stringify(shell).includes('NEVER_EXPOSE'),false);
});

test('empty Shop Name and Currency Symbol retain exact original shell fallback semantics',async()=>{
  await insert('Shop Name','');
  await insert('Currency Symbol','');
  assert.deepEqual(await reader().getAppShellSettings_(),
    {shopName:'Hardware Store ERP',currencySymbol:''});
  await DB.prepare("UPDATE settings SET value='   ' WHERE key='Shop Name'").run();
  assert.deepEqual(await reader().getAppShellSettings_(),
    {shopName:'   ',currencySymbol:''});
});

test('Settings reads do not cache stale results after D1 update or delete',async()=>{
  await insert('Shop Name','Version One');
  const adapter=reader();
  assert.equal((await adapter.getSettingsMap_())['Shop Name'],'Version One');
  await DB.prepare("UPDATE settings SET value='Version Two' WHERE key='Shop Name'").run();
  assert.equal((await adapter.getSettingsMap_())['Shop Name'],'Version Two');
  assert.equal((await adapter.getAppShellSettings_()).shopName,'Version Two');
  await DB.prepare("DELETE FROM settings WHERE key='Shop Name'").run();
  assert.equal(Object.hasOwn(await adapter.getSettingsMap_(),'Shop Name'),false);
  assert.equal((await adapter.getAppShellSettings_()).shopName,'Hardware Store ERP');
});

test('hostile special Settings keys fail closed rather than mutating JS object prototype',async()=>{
  for(const bad of ['__proto__','constructor','prototype']){
    await insert(bad,'attacker');
    await assert.rejects(()=>reader().getSettingsMap_(),/invalid|unsafe|key|forbid/i);
    await DB.prepare('DELETE FROM settings WHERE key=?').bind(bad).run();
  }
  assert.equal(Object.prototype.attacker,undefined);
});

test('bounded Settings scan refuses 257 rows rather than returning truncated settings map',async()=>{
  const prepared=DB.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
  await DB.batch(Array.from({length:257},(_,i)=>prepared.bind('Synthetic Test Key '+i,'value')));
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM settings').first()).n,257);
  await assert.rejects(()=>reader().getSettingsMap_(),/limit|too many|exceed/i);
  assert.deepEqual(await reader().getAppShellSettings_(),{shopName:'Hardware Store ERP',currencySymbol:''});
});

test('invalid D1 map/shell results or non-string cells never get silently coerced',async()=>{
  assert.throws(()=>createSettingsReadAdapter({}),/D1|binding/i);
  const broken=(result)=>({
    DB:{prepare(){return {bind(){return {all:async()=>result}}}}}
  });
  for(const invalid of [
    null,{}, {success:false,results:[]}, {success:true,results:null},
    {success:true,results:[{key:'Shop Name',value:33}]},
    {success:true,results:[null]},
    {success:true,results:[{key:'',value:'x'}]},
    {success:true,results:[{key:'Shop Name',value:'x'},{key:'Shop Name',value:'y'}]}
  ]){
    await assert.rejects(()=>createSettingsReadAdapter(broken(invalid)).getSettingsMap_(),/invalid|unsafe|duplicate|result|key/i);
  }
  const shellBroken={success:true,results:[{key:'Shop Name',value:'x'},{key:'Phone 1',value:'sensitive'}]};
  await assert.rejects(()=>createSettingsReadAdapter(broken(shellBroken)).getAppShellSettings_(),/invalid|unsupported|key|unsafe/i);
});

test('synthetic Settings Worker never exposes settings, contact data or RPC routes',async()=>{
  const cfg=JSON.parse(readFileSync(new URL('../../wrangler.m03-settings-test.jsonc',import.meta.url),'utf8'));
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.main,'tests/fixtures/m03-settings-worker.mjs');
  assert.deepEqual(cfg.d1_databases.map(x=>x.database_id),
    ['00000000-0000-0000-0000-000000000007']);
  for(const url of ['/api/rpc','/__m03_test__/settings','/settings','/api/health']){
    const reply=await worker.fetch('http://settings.local'+url,{method:'POST'});
    assert.equal(reply.status,404);
  }
  const production=readFileSync(new URL('../../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(production.includes('settings-read'),false);
});

test('real Workerd/D1 guarded Settings update trims Shop Name and keeps physical source identity',async()=>{
  await insert('Shop Name','Original Shop',2);
  await insert('Currency Symbol','৳',3);
  await insert('Phone 1','01712345678',4);
  const before=await records();
  const adapter=createGuardedShellSettingsUpdateAdapter({DB});
  assert.deepEqual(await adapter.updateExisting_('Shop Name','  নবাবী হার্ডওয়্যার  ','Original Shop'),{updated:true});
  const after=await records();
  assert.deepEqual(after[0],{...before[0],value:'নবাবী হার্ডওয়্যার'});
  assert.deepEqual(after.slice(1),before.slice(1));
  assert.deepEqual(await reader().getAppShellSettings_(),{shopName:'নবাবী হার্ডওয়্যার',currencySymbol:'৳'});
});

test('real Workerd/D1 concurrent CAS updates cannot both overwrite the same preimage',async()=>{
  await insert('Shop Name','Initial',2);
  const adapter=createGuardedShellSettingsUpdateAdapter({DB});
  const results=await Promise.allSettled([
    adapter.updateExisting_('Shop Name','First','Initial'),
    adapter.updateExisting_('Shop Name','Second','Initial')
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.equal((await records())[0].value,results[0].status==='fulfilled'?'First':'Second');
  assert.equal((await records()).length,1);
});

test('real Workerd/D1 stale preimage and absent key reject rather than upsert',async()=>{
  const adapter=createGuardedShellSettingsUpdateAdapter({DB});
  await insert('Shop Name','Initial',2);
  await DB.prepare("UPDATE settings SET value='Newer' WHERE key='Shop Name'").run();
  const prior=await records();
  await assert.rejects(()=>adapter.updateExisting_('Shop Name','Stale','Initial'),/stale|missing|conflict/i);
  await assert.rejects(()=>adapter.updateExisting_('Currency Symbol','৳',''),/stale|missing|conflict/i);
  assert.deepEqual(await records(),prior);
});

test('real Workerd/D1 Currency Symbol can be cleared without exposing private settings',async()=>{
  await insert('Currency Symbol','৳',2);
  await insert('Delete Confirmation Key','SUPER_SECRET',3);
  await insert('Phone 1','01712345678',4);
  const adapter=createGuardedShellSettingsUpdateAdapter({DB});
  assert.deepEqual(await adapter.updateExisting_('Currency Symbol','   ','৳'),{updated:true});
  await assert.rejects(()=>adapter.updateExisting_('Delete Confirmation Key','attacker','SUPER_SECRET'),
    /invalid|unsupported|key/i);
  assert.equal((await records()).find(x=>x.key==='Delete Confirmation Key').value,'SUPER_SECRET');
  assert.equal((await records()).find(x=>x.key==='Phone 1').value,'01712345678');
  assert.equal((await reader().getAppShellSettings_()).currencySymbol,'');
  assert.equal((await worker.fetch('http://settings.local/__m03_settings_update__',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({key:'Shop Name',value:'FORGED'})
  })).status,404);
});
