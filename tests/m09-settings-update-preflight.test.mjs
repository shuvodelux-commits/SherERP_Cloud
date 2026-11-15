import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const settings=readFileSync(new URL('../legacy/source/Settings.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const html=readFileSync(new URL('../legacy/source/settings.html',import.meta.url),'utf8');
const invoiceHtml=readFileSync(new URL('../legacy/source/invoiceDesign.html',import.meta.url),'utf8');
const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
const json=x=>JSON.parse(JSON.stringify(x));
function native(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Missing frozen source function '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Unterminated frozen function '+name);
  return source.slice(start,end+2);
}
function frozenConst(name){
  const start=settings.indexOf('const '+name+' = [');
  const end=settings.indexOf('\n];',start);
  assert.ok(start>=0 && end>start,'Missing pinned Settings whitelist '+name);
  return settings.slice(start,end+3);
}
const keys=JSON.parse('['+settings.slice(
  settings.indexOf('const SETTINGS_EDITABLE_KEYS = [')+'const SETTINGS_EDITABLE_KEYS = ['.length,
  settings.indexOf('\n];',settings.indexOf('const SETTINGS_EDITABLE_KEYS = ['))).replace(/,\s*$/, '')+']');
const original=[
  frozenConst('SETTINGS_EDITABLE_KEYS'),
  frozenConst('SETTINGS_NUMERIC_KEYS'),
  frozenConst('SETTINGS_BOOLEAN_KEYS'),
  native(utils,'sanitizeInput_'),
  native(utils,'isValidNonNegativeNumber_'),
  native(settings,'updateSettings')
].join('\n');
const banks=()=>[
  {'Bank Account ID':'B1','Account Name':'Cash Account','Status':'Active'},
  {'Bank Account ID':'B2','Account Name':'Inactive Account','Status':'Inactive'}
];
function oracle(payload,accounts=banks()){
  const writes=[];
  let locks=0,unlocks=0;
  const context={
    payload,accounts,
    CONFIG:{LOCK_TIMEOUT_MS:30000},
    LockService:{getScriptLock:()=>({
      waitLock:ms=>{assert.equal(ms,30000);locks++;},
      releaseLock:()=>{unlocks++;}
    })},
    requirePermission_:(token,module,action)=>{
      assert.equal(token,'authorized-fixture');
      assert.equal(module,'settings');assert.equal(action,'edit');
    },
    getAllRows_:table=>{
      assert.equal(table,'BANK_ACCOUNTS');
      return accounts;
    },
    setSetting_:(key,value)=>{writes.push({key,value});},
    ok_:data=>({success:true,data}),
    fail_:error=>({success:false,error}),
    logError_:()=>{}
  };
  const response=json(runInNewContext(
    original+'\nupdateSettings("authorized-fixture",payload)',context
  ));
  assert.equal(locks,1);assert.equal(unlocks,1);
  return {response,writes:json(writes)};
}
const impl=await import('../src/modules/settings-update-preflight.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
function project(payload,accounts){
  assert.equal(typeof impl?.planSettingsUpdate,'function',
    'M09 Settings update preflight not implemented');
  return impl.planSettingsUpdate(payload,
    arguments.length<2?undefined:accounts);
}
function parity(payload,accounts=banks()){
  const expected=oracle(payload,accounts);
  const got=project(payload,accounts);
  assert.deepEqual(got,{...expected.response,writes:expected.writes});
  return got;
}

test('complete original Settings whitelist preserves exactly 30 editable keys and source order',()=>{
  assert.equal(keys.length,30);
  const payload=Object.fromEntries(keys.map(key=>[key,'value '+key]));
  for(const key of ['Tax Percent','Default Discount','Low Stock Threshold',
    'Day Book Editable Days','Invoice Payment Terms Days'])payload[key]='5';
  for(const key of ['Invoice Payment Methods','Invoice Terms'])payload[key]='[]';
  payload['Default Bank Account']='B1';
  payload['Invoice Show Bismillah']=true;
  payload['Invoice Show Signature']='true';
  payload['POS Show Purchase Price']=false;
  const result=parity(payload);
  assert.equal(result.success,true);
  assert.equal(result.data,'Settings saved.');
  assert.deepEqual(result.writes.map(w=>w.key),keys);
  assert.equal(result.writes.length,30);
});

test('partial update writes only provided keys in Settings.gs whitelist order',()=>{
  const result=parity({
    'Invoice Footer':'  ধন্যবাদ  ','Shop Name':'  দোকান ',
    'Currency Symbol':' ৳ ','Noneditable Ledger Due':'999',
    'Invoice Show Signature':true
  });
  assert.deepEqual(result.writes,[
    {key:'Shop Name',value:'দোকান'},
    {key:'Currency Symbol',value:'৳'},
    {key:'Invoice Footer',value:'ধন্যবাদ'},
    {key:'Invoice Show Signature',value:'true'}
  ]);
  assert.equal(result.success,true);
  assert.deepEqual(parity({},banks()).writes,[]);
});

test('numeric keys share source Number conversion including blank and whitespace zero',()=>{
  const values=[
    {'Tax Percent':''},
    {'Default Discount':'   '},
    {'Low Stock Threshold':'1e2'},
    {'Day Book Editable Days':null},
    {'Invoice Payment Terms Days':true}
  ];
  for(const input of values){
    const result=parity(input);
    assert.equal(result.success,true);
    assert.equal(typeof result.writes[0].value,'number');
  }
  assert.equal(parity({'Default Discount':''}).writes[0].value,0);
  assert.equal(parity({'Low Stock Threshold':'1e2'}).writes[0].value,100);
});

test('negative, nonnumeric and infinite numeric settings reject with exact first source error and zero writes',()=>{
  for(const payload of [
    {'Tax Percent':'-0.01'},
    {'Default Discount':'NaN'},
    {'Low Stock Threshold':'Infinity'},
    {'Day Book Editable Days':'1,000'},
    {'Invoice Payment Terms Days':'-1'}
  ]){
    const got=parity(payload);
    assert.equal(got.success,false);
    assert.match(got.error,/must be a valid non-negative number/);
    assert.deepEqual(got.writes,[]);
  }
  const first=parity({'Tax Percent':-1,'Default Discount':'oops'});
  assert.match(first.error,/"Tax Percent"/);
});

test('only literal true and boolean true persist as source string true; other scalars are false',()=>{
  for(const value of [true,'true',false,'TRUE','on',1,0,'false','']){
    const input={'Invoice Show Bismillah':value,'Invoice Show Signature':value,
      'POS Show Purchase Price':value};
    const result=parity(input);
    const expected=value===true||value==='true'?'true':'false';
    assert.deepEqual(result.writes.map(x=>x.value),[expected,expected,expected]);
  }
});

test('Shop Name supplied blank or all spaces fails before any Settings write',()=>{
  for(const value of ['','   ',null]){
    const result=parity({'Shop Name':value,'Currency Symbol':'৳'});
    assert.equal(result.success,false);
    assert.equal(result.error,'Shop Name is required.');
    assert.deepEqual(result.writes,[]);
  }
  assert.equal(parity({'Shop Name':' দোকান '}).writes[0].value,'দোকান');
});

test('source default Bank Account existence checks all original rows, including inactive, by exact ID',()=>{
  assert.deepEqual(parity({'Default Bank Account':'B2'}).writes,
    [{key:'Default Bank Account',value:'B2'}]);
  const missing=parity({'Default Bank Account':'b2'});
  assert.equal(missing.success,false);
  assert.equal(missing.error,'Selected default bank account no longer exists.');
  assert.deepEqual(missing.writes,[]);
  assert.equal(parity({'Default Bank Account':''}).writes[0].value,'');
});

test('invoice payment methods and invoice terms must be JSON arrays when nonblank',()=>{
  const valid=parity({'Invoice Payment Methods':'  [{"label":"বিকাশ","value":"017"}]  ',
    'Invoice Terms':'  []  '});
  assert.deepEqual(valid.writes,[
    {key:'Invoice Payment Methods',value:'[{"label":"বিকাশ","value":"017"}]'},
    {key:'Invoice Terms',value:'[]'}
  ]);
  for(const key of ['Invoice Payment Methods','Invoice Terms']){
    for(const bad of ['{}','"text"','null','{"a":1}','bad-json']){
      const got=parity({[key]:bad});
      assert.equal(got.success,false);
      assert.match(got.error,/must be valid JSON \(an array\)/);
      assert.deepEqual(got.writes,[]);
    }
    assert.equal(parity({[key]:' '}).writes[0].value,'');
  }
});

test('bank validation precedes JSON validation, and numeric validation precedes bank validation',()=>{
  assert.equal(parity({'Default Bank Account':'NOT-FOUND','Invoice Terms':'not-json'}).error,
    'Selected default bank account no longer exists.');
  assert.match(parity({'Tax Percent':'nope','Default Bank Account':'NOT-FOUND'}).error,
    /"Tax Percent"/);
});

test('null payload preserves frozen source error; ordinary unknown keys remain ignored',()=>{
  assert.deepEqual(parity(null),{
    success:false,error:'No settings data received.',writes:[]
  });
  const got=parity({'Unknown String':'Hello','Shop Name':undefined});
  assert.equal(got.success,true);
  assert.deepEqual(got.writes,[]);
});

test('bad Settings payloads fail closed before coercion, getters, or any proposal',()=>{
  for(const invalid of [
    [],Promise.resolve({}),new Map(),
    Object.create({'Shop Name':'inherited'}),
    {'Shop Name':{}},
    {'Invoice Payment Methods':['[]']},
    {'Default Bank Account':{id:'B1'}},
    {'Tax Percent':Infinity}
  ])assert.throws(()=>project(invalid,banks()),/trusted|invalid|payload|scalar|object|number|finite/i);
  const getter={get 'Shop Name'(){throw Error('getter invoked');}};
  assert.throws(()=>project(getter,banks()),/accessor|trusted|payload/i);
  const proto={};
  Object.defineProperty(proto,'__proto__',{enumerable:true,value:'evil'});
  assert.throws(()=>project(proto,banks()),/unsafe|payload|key/i);
  assert.throws(()=>project({'Default Bank Account':'B1'}),/trusted|bank|source|snapshot/i);
  assert.throws(()=>project({'Default Bank Account':'B1'},Promise.resolve([])),
    /trusted|bank|snapshot|array/i);
  assert.throws(()=>project({'Default Bank Account':'B1'},[null]),
    /trusted|bank|row/i);
});

test('preflight is deterministic/read-only, with original Settings UI and public RPC unchanged',()=>{
  const payload={'Shop Name':' দোকান ','Invoice Terms':'[]','Tax Percent':'2'};
  const input=json(payload),before=json(banks());
  const result=parity(payload,banks());
  result.writes[0].value='TAMPER';
  assert.deepEqual(payload,input);
  assert.deepEqual(banks(),before);
  assert.equal(parity(payload,banks()).writes[0].value,'দোকান');
  assert.match(html,/serverCall\('updateSettings', authToken, payload\)/);
  assert.match(invoiceHtml,/serverCall\('updateSettings', authToken, ivCollectPayload_\(\)\)/);
  assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
  const code=readFileSync(new URL('../src/modules/settings-update-preflight.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:fetch|prepare|batch|exec|setSetting_)\s*\(/);
  assert.doesNotMatch(code,/function\s+updateSettings\s*\(/);
});
