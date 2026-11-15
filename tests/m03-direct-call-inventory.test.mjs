import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {summarizeLegacyCallers} from '../scripts/audit-m03-callers.mjs';

test('deterministically identifies direct read/write helper calls and direct Sheet access',()=>{
  const files={
    'Z.gs': [
      'function getAllRows_(sheetKey) { return []; }',
      'function business() {',
      '  getAllRows_("PRODUCTS"); getAllRows_("PRODUCT_UNITS");',
      '  appendRow_("PRODUCTS", {});',
      '  getSheet_("PRODUCTS").getRange(1, 1).getValues();',
      '  SpreadsheetApp.getActiveSpreadsheet();',
      '}',
      '// appendRows_("SECRET", []);',
      '/* deleteRow_("SECRET", 3); */'
    ].join('\n'),
    'A.gs':'function read() { return findRow_("PRODUCTS", "Product ID", "1"); }'
  };
  const snapshot=JSON.stringify(files);
  const result=summarizeLegacyCallers(files);
  assert.equal(JSON.stringify(files),snapshot);
  assert.deepEqual(result.modules.map(m=>m.file),['A.gs','Z.gs']);
  assert.equal(result.sourceFiles,2);
  assert.equal(result.totals.readCalls,3);
  assert.equal(result.totals.writeCalls,1);
  assert.equal(result.totals.directRangeCalls,3);
  assert.equal(result.totals.gasServiceCalls,1);
  assert.deepEqual(result.modules[1].readHelpers,{getAllRows_:2});
  assert.deepEqual(result.modules[1].writeHelpers,{appendRow_:1});
  assert.deepEqual(result.modules[1].directRange,{getSheet_:1,getRange:1,getValues:1});
  assert.deepEqual(result.modules[1].gasServices,{SpreadsheetApp:1});
});

test('emits no module for plain source and never treats declarations as usage',()=>{
  const result=summarizeLegacyCallers({
    'None.gs':'const value=1; // SpreadsheetApp and deleteRow_(...)',
    'Definition.gs':'function updateRowFields_(key, row, fields) { return fields; }',
  });
  assert.deepEqual(result.modules,[]);
  assert.equal(result.totals.writeCalls,0);
  assert.equal(result.sourceFiles,2);
});

test('rejects malformed input and maintains filename-only output',()=>{
  assert.throws(()=>summarizeLegacyCallers(null),/files/i);
  assert.throws(()=>summarizeLegacyCallers({'Bad.gs':null}),/source text/i);
  const result=summarizeLegacyCallers({'Phone.gs':'const token="never-leak"; getAllRows_("SETTINGS");'});
  assert.equal(JSON.stringify(result).includes('never-leak'),false);
  assert.equal(JSON.stringify(result).includes('SETTINGS'),false);
});

test('checked baseline matches latest pinned legacy source',()=>{
  const path=fileURLToPath(new URL('../scripts/audit-m03-callers.mjs',import.meta.url));
  const result=spawnSync(process.execPath,[path,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/M03 direct-call inventory matches baseline/);
  const baseline=JSON.parse(readFileSync(fileURLToPath(new URL('../docs/baseline/m03-direct-call-inventory.json',import.meta.url)),'utf8'));
  assert.ok(baseline.sourceFiles>=40);
  assert.ok(baseline.modules.some(m=>m.file==='Auth.gs'&&m.writeHelpers.appendRow_>=1));
});

test('fingerprints original source bytes even when lexical call counts are unchanged',()=>{
  const first=summarizeLegacyCallers({'A.gs':'getAllRows_("PRODUCTS");'});
  const changed=summarizeLegacyCallers({'A.gs':'getAllRows_("SETTINGS");'});
  assert.deepEqual(first.modules,changed.modules);
  assert.match(first.sourceDigestSha256,/^[a-f0-9]{64}$/);
  assert.notEqual(first.sourceDigestSha256,changed.sourceDigestSha256);
});
