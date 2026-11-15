import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const sourceRoot=new URL('../legacy/source/',import.meta.url);
const sourceFiles=['Settings.gs','Invoice.gs','settings.html','invoiceDesign.html'];
const sourceCommit='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const sources=()=>Object.fromEntries(sourceFiles.map(path=>[
  path,readFileSync(new URL(path,sourceRoot),'utf8')
]));
const modulePath='../scripts/audit-m09-settings-invoice.mjs';
const auditModule=await import(modulePath).catch(error=>{
  if(error?.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});
const audit=(input=sources(),sha=sourceCommit)=>{
  assert.equal(typeof auditModule?.auditM09SettingsInvoiceContracts,'function','M09 settings scanner not implemented');
  return auditModule.auditM09SettingsInvoiceContracts({sources:input,sourceCommit:sha});
};
const endpoint=(snapshot,name)=>snapshot.settings.endpoints.find(e=>e.name===name);
const page=(snapshot,name)=>snapshot.pages.find(e=>e.sourceFile===name);

test('five original Settings RPC endpoints preserve view and edit permissions and bank reads',()=>{
  const x=audit();
  assert.equal(x.formatVersion,1);
  assert.equal(x.sourceCommit,sourceCommit);
  assert.deepEqual(x.settings.endpoints.map(e=>e.name),[
    'getSettingsBootstrap','updateSettings','getInvoiceDesignBootstrap',
    'uploadInvoiceLogo','removeInvoiceLogo'
  ]);
  assert.equal(endpoint(x,'getSettingsBootstrap').permission,'settings:view');
  assert.equal(endpoint(x,'getInvoiceDesignBootstrap').permission,'settings:view');
  for(const name of ['updateSettings','uploadInvoiceLogo','removeInvoiceLogo'])
    assert.equal(endpoint(x,name).permission,'settings:edit');
  assert.deepEqual(endpoint(x,'getSettingsBootstrap').directReads,['getAllRows_:BANK_ACCOUNTS']);
  assert.deepEqual(endpoint(x,'updateSettings').directReads,['getAllRows_:BANK_ACCOUNTS']);
});

test('settings allowlists and logo size/MIME restrictions remain visible to review',()=>{
  const x=audit();
  assert.equal(x.settings.editableKeys.length,30);
  assert.equal(x.settings.numericKeys.length,5);
  assert.deepEqual(x.settings.booleanKeys,[
    'Invoice Show Bismillah','Invoice Show Signature','POS Show Purchase Price'
  ]);
  for(const key of ['Default Bank Account','Invoice Footer','Receipt Size','Invoice Payment Terms Days'])
    assert.ok(x.settings.editableKeys.includes(key),key);
  assert.equal(x.settings.logo.maxBytes,1572864);
  assert.deepEqual(x.settings.logo.allowedMime,[
    'image/png','image/jpeg','image/webp','image/gif'
  ]);
});

test('original HTML RPC, DOM and invoice renderer contracts are captured without redesign',()=>{
  const x=audit();
  assert.deepEqual(x.pages.map(p=>p.sourceFile),['settings.html','invoiceDesign.html']);
  assert.deepEqual(page(x,'settings.html').rpcCalls,['getSettingsBootstrap','updateSettings']);
  assert.deepEqual(page(x,'invoiceDesign.html').rpcCalls,[
    'getInvoiceDesignBootstrap','removeInvoiceLogo','updateSettings','uploadInvoiceLogo'
  ]);
  assert.ok(page(x,'settings.html').elementIds.includes('setSaveBtn'));
  assert.ok(page(x,'invoiceDesign.html').elementIds.includes('ivPreviewBtn'));
  for(const key of ['Invoice Footer','Invoice Payment Terms Days','Receipt Size',
    'Invoice Show Bismillah','Invoice Show Signature'])
    assert.ok(x.invoiceRendererSettings.includes(key),key);
});

test('scanner rejects removed endpoints and missing or commented-out authorization',()=>{
  const renamed=sources();
  renamed['Settings.gs']=renamed['Settings.gs'].replace(
    'function removeInvoiceLogo(', 'function missingRemoveInvoiceLogo('
  );
  assert.throws(()=>audit(renamed),/missing.*removeInvoiceLogo/i);
  const unsecured=sources();
  unsecured['Settings.gs']=unsecured['Settings.gs'].replace(
    "requirePermission_(token, 'settings', 'view');",
    "// requirePermission_(token, 'settings', 'view');"
  );
  assert.throws(()=>audit(unsecured),/permission.*getSettingsBootstrap/i);
});

test('commented UI RPC is ignored, but a real new call changes the snapshot',()=>{
  const original=audit();
  const comment=sources();
  comment['settings.html']+="\n<!-- serverCall('ghostRPC') -->\n";
  assert.deepEqual(audit(comment),original);
  const changed=sources();
  changed['settings.html']+="\n<script>serverCall('newSettingsCall',function(){});</script>\n";
  assert.ok(page(audit(changed),'settings.html').rpcCalls.includes('newSettingsCall'));
  assert.notDeepEqual(audit(changed),original);
});

test('editable-key and logo-limit changes cannot match the original snapshot',()=>{
  const original=audit();
  const keyDrift=sources();
  keyDrift['Settings.gs']=keyDrift['Settings.gs'].replace(
    '"POS Show Purchase Price"\n];','"POS Show Cost Price"\n];'
  );
  assert.notDeepEqual(audit(keyDrift),original);
  const sizeDrift=sources();
  sizeDrift['Settings.gs']=sizeDrift['Settings.gs'].replace(
    '1.5 * 1024 * 1024','2 * 1024 * 1024'
  );
  assert.equal(audit(sizeDrift).settings.logo.maxBytes,2097152);
});

test('missing source, invalid SHA and stale JSON fail closed',()=>{
  const data=audit();
  assert.throws(()=>audit(sources(),'not-a-sha'),/source|sha/i);
  const missing=sources();
  delete missing['Invoice.gs'];
  assert.throws(()=>audit(missing),/missing.*Invoice\.gs/i);
  assert.equal(typeof auditModule?.assertM09SettingsInvoiceSnapshot,'function');
  assert.doesNotThrow(()=>auditModule.assertM09SettingsInvoiceSnapshot(data,structuredClone(data)));
  const old=structuredClone(data);
  old.settings.editableKeys.pop();
  assert.throws(()=>auditModule.assertM09SettingsInvoiceSnapshot(data,old),/drift|mismatch/i);
});

test('CLI explicitly verifies the committed source-pinned inventory',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const file=fileURLToPath(new URL(modulePath,import.meta.url));
  const res=spawnSync(process.execPath,[file,'--check'],{cwd:root,encoding:'utf8'});
  assert.equal(res.status,0,res.stderr);
  assert.match(res.stdout,/M09 settings.*verified/i);
  const bad=spawnSync(process.execPath,[file,'--oops'],{cwd:root,encoding:'utf8'});
  assert.equal(bad.status,1);
});
