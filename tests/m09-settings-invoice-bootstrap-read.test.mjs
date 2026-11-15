import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const frozen=readFileSync(new URL('../legacy/source/Settings.gs',import.meta.url),'utf8');
const settingsUi=readFileSync(new URL('../legacy/source/settings.html',import.meta.url),'utf8');
const invoiceUi=readFileSync(new URL('../legacy/source/invoiceDesign.html',import.meta.url),'utf8');
const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function sourceFn(name){
  const a=frozen.indexOf('function '+name+'(');
  assert.ok(a>=0,'Missing frozen original '+name);
  const b=frozen.indexOf('\n}',a);
  assert.ok(b>a,'Could not extract '+name);
  return frozen.slice(a,b+2);
}
const source=sourceFn('getSettingsBootstrap')+'\n'+sourceFn('getInvoiceDesignBootstrap');
function oracle(kind,settings,bankAccounts=[],logoDataUri=''){
  const ctx={
    token:'authorized-settings-reader',
    requirePermission_:(token,section,action)=>{
      assert.equal(token,'authorized-settings-reader');
      assert.equal(section,'settings');
      assert.equal(action,'view');
    },
    getAllRows_:name=>{
      assert.equal(name,'BANK_ACCOUNTS');
      return bankAccounts;
    },
    getSettingsMap_:()=>settings,
    resolveInvoiceLogoDataUri_:()=>logoDataUri,
    ok_:data=>data,
    fail_:message=>{throw Error('Frozen GAS failed: '+message);},
    logError_:()=>{}
  };
  const method=kind==='settings'?'getSettingsBootstrap':'getInvoiceDesignBootstrap';
  return clone(runInNewContext(source+'\n'+method+'(token)',ctx));
}
const impl=await import('../src/modules/settings-invoice-bootstrap-read.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function projectSettings(map,banks){
  assert.equal(typeof impl?.projectSettingsBootstrap,'function',
    'M09 Settings bootstrap read projection not implemented');
  return impl.projectSettingsBootstrap(map,banks);
}
function projectInvoice(map,logo){
  assert.equal(typeof impl?.projectInvoiceDesignBootstrap,'function',
    'M09 Invoice Design bootstrap read projection not implemented');
  return impl.projectInvoiceDesignBootstrap(map,logo);
}
function settingsParity(map,banks=[]){
  const out=clone(projectSettings(map,banks));
  const expected=oracle('settings',map,banks);
  assert.deepEqual(out,expected);
  assert.deepEqual(Object.keys(out),Object.keys(expected));
  return out;
}
function invoiceParity(map,logo=''){
  const out=clone(projectInvoice(map,logo));
  const expected=oracle('invoice',map,[],logo);
  assert.deepEqual(out,expected);
  assert.deepEqual(Object.keys(out),Object.keys(expected));
  return out;
}
const banks=()=>[
  {'Bank Account ID':'BA-01','Account Name':'Current','Status':'Active',
    'Account Number':'PRIVATE123','Current Balance':3000,'Account Type':'Bank'},
  {'Bank Account ID':'BA-02','Account Name':'bKash দোকান','Status':'active',
    'Current Balance':4000,'Account Type':'Mobile Banking'},
  {'Bank Account ID':'BA-OLD','Account Name':'Old','Status':'Inactive',
    'Current Balance':9000},
  {'Bank Account ID':'BA-03','Account Name':'Dormant','Status':''},
];

test('full native Settings bootstrap: source Settings map and active Bank Account dropdown only',()=>{
  const settings={
    'Shop Name':'রহিম হার্ডওয়্যার','Currency Symbol':'৳',
    'Tax Percent':5,'POS Show Purchase Price':false,'Invoice Terms':'[]'
  };
  const result=settingsParity(settings,banks());
  assert.deepEqual(result.settings,settings);
  assert.deepEqual(result.bankAccounts,[
    {id:'BA-01',name:'Current'},
    {id:'BA-02',name:'bKash দোকান'},
    {id:'BA-03',name:'Dormant'}
  ]);
  assert.deepEqual(Object.keys(result),['settings','bankAccounts']);
});

test('Bank source Status exact Inactive only; order stays source, not sorted; duplicate names allowed',()=>{
  const sample=banks();
  sample[1]['Account Name']='Current';
  sample[1].Status='inactive'; // Lower case remains visible in frozen GAS.
  const result=settingsParity({},sample);
  assert.deepEqual(result.bankAccounts.map(x=>x.id),['BA-01','BA-02','BA-03']);
  assert.equal(result.bankAccounts[1].name,'Current');
  assert.equal(result.bankAccounts[2].name,'Dormant');
});

test('bank dropdown never exposes stored balances, account numbers, or bank posting rows',()=>{
  const result=settingsParity({'Shop Name':'Store'},banks());
  for(const account of result.bankAccounts){
    assert.deepEqual(Object.keys(account),['id','name']);
    assert.equal(Object.hasOwn(account,'Current Balance'),false);
    assert.equal(Object.hasOwn(account,'Account Number'),false);
  }
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE123|3000|4000|9000/);
});

test('Settings map preserves original source booleans, numeric entries, empty strings and unicode',()=>{
  const settings={
    'Shop Name':' দোকান ','Tax Percent':0,'Invoice Show Signature':true,
    'Invoice Show Bismillah':false,
    'Invoice Proprietor Name':'বাংলা',
    'Default Bank Account':'',
    'Timezone':'Asia/Dhaka'
  };
  const result=settingsParity(settings);
  assert.deepEqual(result.settings,settings);
  assert.equal(result.settings['Shop Name'],' দোকান ');
  assert.equal(typeof result.settings['Tax Percent'],'number');
  assert.equal(typeof result.settings['Invoice Show Signature'],'boolean');
});

test('empty source Settings and Bank rows return empty map/list, not invented default settings',()=>{
  const result=settingsParity({},[]);
  assert.deepEqual(result,{settings:{},bankAccounts:[]});
  const noLogo=invoiceParity({});
  assert.deepEqual(noLogo,{settings:{},logoDataUri:''});
});

test('native Invoice Design bootstrap preserves exact settings and pre-resolved logo data URI',()=>{
  const settings={'Invoice Logo':'file-id','Shop Name':'শাহজাহান মার্কেট',
    'Invoice Show Bismillah':true,'Invoice Footer':'ধন্যবাদ'};
  const logo='data:image/png;base64,AAECAw==';
  const result=invoiceParity(settings,logo);
  assert.deepEqual(result,{settings,logoDataUri:logo});
  assert.equal(result.settings['Invoice Logo'],'file-id');
  assert.deepEqual(Object.keys(result),['settings','logoDataUri']);
});

test('original invoice has no logo when trusted resolver returns empty and never fetches Drive here',()=>{
  const settings={'Invoice Logo':'missing-old-id'};
  const result=invoiceParity(settings,'');
  assert.equal(result.logoDataUri,'');
  assert.equal(result.settings['Invoice Logo'],'missing-old-id');
});

test('return values are read-only snapshots: no mutation of caller map, bank rows or later requests',()=>{
  const settings={'Shop Name':'Original','Invoice Footer':'Thank you'};
  const rows=banks(),a=clone(settings),b=clone(rows);
  const first=settingsParity(settings,rows);
  first.settings['Shop Name']='changed';
  first.bankAccounts[0].name='tampered';
  const second=settingsParity(settings,rows);
  assert.equal(second.settings['Shop Name'],'Original');
  assert.equal(second.bankAccounts[0].name,'Current');
  const firstInvoice=invoiceParity(settings,'');
  firstInvoice.settings['Shop Name']='changed';
  assert.equal(invoiceParity(settings,'').settings['Shop Name'],'Original');
  assert.deepEqual(settings,a);
  assert.deepEqual(rows,b);
});

test('reject missing, promise, accessors, inherited/unsafe source records, ambiguous bank IDs',()=>{
  for(const bad of [
    undefined,null,[],42,Promise.resolve({}),
    Object.create({'Shop Name':'not own'}),
    {'Shop Name':{value:'not a sheet scalar'}},
    {'Shop Name':Promise.resolve('not loaded')},
    {'__proto__':'bad',constructor:'bad'},
    {'Tax Percent':Infinity}
  ])assert.throws(()=>projectSettings(bad,[]),/trusted|settings|object|scalar|finite|unsafe|accessor/i);
  const getter={get 'Shop Name'(){throw Error('getter should not run');}};
  assert.throws(()=>projectSettings(getter,[]),/trusted|settings|accessor/i);
  for(const source of [null,undefined,Promise.resolve([]),{},[null],
    [Object.create({'Bank Account ID':'INHERITED','Account Name':'No'})],
    [{'Bank Account ID':'','Account Name':'No'}],
    [{'Bank Account ID':'BA','Account Name':Promise.resolve('No')}],
    [{'Bank Account ID':'BA',get 'Account Name'(){throw Error('getter');}}]
  ])assert.throws(()=>projectSettings({},source),/trusted|bank|array|row|account|accessor|id|name/i);
  const duplicate=banks();
  duplicate.push({...duplicate[0]});
  assert.throws(()=>projectSettings({},duplicate),/duplicate bank account id/i);
  // Duplicates among inactive rows do not get into original dropdown.
  duplicate.pop();
  duplicate.push({...duplicate[2]});
  settingsParity({},duplicate);
});

test('reject forged Invoice logo URLs, invalid data URI, unsafe MIME and oversized upload',()=>{
  for(const logo of [undefined,null,'https://example.invalid/image.png',
    'javascript:alert(1)','data:text/html;base64,QQ==',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,??','data:image/png;base64,QQ=',
    Promise.resolve('data:image/png;base64,QQ==')]){
    assert.throws(()=>projectInvoice({},logo),/logo|image|URI|trusted|base64|invalid/i);
  }
  assert.throws(()=>projectInvoice({},'data:image/png;base64,'+'A'.repeat(2_100_000)),
    /logo|size|large|limit/i);
  assert.equal(invoiceParity({},'data:image/jpeg;base64,AA==').logoDataUri,
    'data:image/jpeg;base64,AA==');
});

test('original Settings and Invoice Design UI serverCall contracts remain untouched',()=>{
  assert.match(settingsUi,/serverCall\('getSettingsBootstrap', authToken\)/);
  assert.match(settingsUi,/serverCall\('updateSettings', authToken, payload\)/);
  assert.match(invoiceUi,/serverCall\('getInvoiceDesignBootstrap', authToken\)/);
  assert.match(invoiceUi,/serverCall\('uploadInvoiceLogo', authToken, base64, file\.type\)/);
  assert.match(invoiceUi,/serverCall\('removeInvoiceLogo', authToken\)/);
  assert.match(frozen,/requirePermission_\(token, 'settings', 'view'\)/);
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
});

test('module never adds RPC, D1 queries, logo writes, or mutates original source files',()=>{
  const file=readFileSync(new URL('../src/modules/settings-invoice-bootstrap-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(file,/\b(?:fetch|prepare|batch|exec|createFile|setSetting_|DriveApp)\s*\(/);
  assert.doesNotMatch(file,/function\s+getSettingsBootstrap\s*\(/);
  assert.doesNotMatch(file,/function\s+getInvoiceDesignBootstrap\s*\(/);
  assert.equal(typeof impl.projectSettingsBootstrap,'function');
  assert.equal(typeof impl.projectInvoiceDesignBootstrap,'function');
});
