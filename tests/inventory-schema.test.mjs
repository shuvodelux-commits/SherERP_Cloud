import test from 'node:test';
import assert from 'node:assert/strict';
import { inventorySchema } from '../scripts/inventory-schema.mjs';
import { spawnSync } from 'node:child_process';

const config = [
  'const CONFIG = {',
  '  SHEETS: {',
  '    PRODUCTS: "Products",',
  '    LEDGER: "Ledger", // GHOST: "Not Real",',
  '  },',
  '  HEADERS: {',
  '    // FAKE: ["Fake ID"],',
  '    PRODUCTS: ["Product ID", "নাম", "Phone"],',
  '    LEDGER: ["Entry ID", "Amount", /* decoy */ "Source"],',
  '  },',
  '};',
].join('\n');

test('maps sheet names and literal header arrays in source order', () => {
  const result=inventorySchema(config);
  assert.deepEqual(result, {formatVersion:1,tables:[
    {sheetKey:'PRODUCTS',sheetName:'Products',columns:['Product ID','নাম','Phone']},
    {sheetKey:'LEDGER',sheetName:'Ledger',columns:['Entry ID','Amount','Source']},
  ]});
});

test('rejects mismatched group names, duplicate columns and malformed arrays', () => {
  assert.throws(()=>inventorySchema(config.replace('LEDGER: ["Entry ID", "Amount", /* decoy */ "Source"]', 'MISSING: ["Entry ID"]')),/mismatch|missing/i);
  assert.throws(()=>inventorySchema(config.replace('"Product ID", "নাম", "Phone"','"Product ID", "নাম", "Product ID"')),/duplicate/i);
  assert.throws(()=>inventorySchema(config.replace('PRODUCTS: ["Product ID", "নাম", "Phone"]','PRODUCTS: [notValid]')),/invalid|literal/i);
});

test('does not strip double slashes within quoted source literals', () => {
  assert.equal(inventorySchema(config.replace('"Products"','"http://sample.invalid/Products"')).tables[0].sheetName,'http://sample.invalid/Products');
});

test('CLI rejects a missing Config.gs path', () => {
  const path=new URL('../scripts/inventory-schema.mjs',import.meta.url).pathname;
  const result=spawnSync(process.execPath,[path,'/missing-m00-config.gs'],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/ENOENT|missing/i);
});
