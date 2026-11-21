import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/m03-owner-redemption-worker.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/ui/hisabiq/invoice-profile-bridge.mjs',import.meta.url),'utf8');

test('M03 private Owner Worker installs M09 Invoice Studio once, using current Control+Shop session',()=>{
  assert.match(source,/import\s*\{registerOwnerInvoiceProfileRoutes\}\s*from\s*['"]\.\/modules\/m09-owner-invoice-profile-routes\.js['"]/);
  assert.equal((source.match(/registerOwnerInvoiceProfileRoutes\(app,/g)||[]).length,1);
  assert.match(source,/currentOwnerContext:\s*c\s*=>\s*verifiedOwnerPurchaseContext\(c,true\)/);
  assert.match(source,/protectLogin,\s*limitBody,/);
  const integration=source.slice(source.indexOf('registerOwnerInvoiceProfileRoutes(app,'),source.indexOf('function purchaseError(c,status)'));
  assert.doesNotMatch(integration,/c\.req\.(?:json|query|param)\(/);
});

test('Invoice preview bridge updates the notice after a verified Shop-specific read',()=>{
  assert.match(ui,/Invoice printing is unchanged/);
  assert.match(ui,/invoice-profile-save/);
  assert.match(ui,/setAttribute\('role','status'\)/);
  assert.match(ui,/Invoice printing remains unchanged/);
});
