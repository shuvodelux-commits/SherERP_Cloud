import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {patchOwnerHisabiqSettings} from '../scripts/patch-owner-hisabiq-settings.mjs';

const html='<html><head></head><body><main><section id="page-settings" data-page="settings"></section><section id="page-invoiceDesign" data-page="invoiceDesign"></section><section id="page-users" data-page="users"></section><section id="page-roles" data-page="roles"></section></main></body></html>';

test('injects isolated HisabIQ settings assets without modifying legacy forms or routes', async () => {
  const css=await readFile(new URL('../src/ui/hisabiq/settings-workspace.css',import.meta.url),'utf8');
  const js=await readFile(new URL('../src/ui/hisabiq/settings-workspace.mjs',import.meta.url),'utf8');
  const bridge=await readFile(new URL('../src/ui/hisabiq/invoice-profile-bridge.mjs',import.meta.url),'utf8');
  const compiled=patchOwnerHisabiqSettings(html,{css,js,bridge});
  assert.match(compiled,/id="hisabiq-settings-styles"/);
  assert.match(compiled,/id="hisabiq-settings-controller"/);
  assert.match(compiled,/id="hisabiq-invoice-profile-client"/);
  assert.match(compiled,/id="page-invoiceDesign"/);
  assert.match(compiled,/id="page-users"/);
  assert.match(compiled,/id="page-roles"/);
  assert.throws(()=>patchOwnerHisabiqSettings(compiled,{css,js,bridge}),/already installed/);
  assert.throws(()=>patchOwnerHisabiqSettings(html.replace('page-users','other'),{css,js,bridge}),/boundary/);
});

test('preview cannot masquerade as a persisted invoice design', async () => {
  const js=await readFile(new URL('../src/ui/hisabiq/settings-workspace.mjs',import.meta.url),'utf8');
  assert.match(js,/Preview only/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|POST \/api|fetch\(/);
  assert.match(js,/invoices.*printing/i);
  assert.match(js,/aria-current/);
});

test('optional Owner invoice client is strictly scoped and nonbinding without private route',async()=>{
  const bridge=await readFile(new URL('../src/ui/hisabiq/invoice-profile-bridge.mjs',import.meta.url),'utf8');
  assert.match(bridge,/api\/owner\/invoice-profile/);
  assert.match(bridge,/status===404/);
  assert.match(bridge,/status===409/);
  assert.match(bridge,/api\/owner\/auth\/session/);
  assert.doesNotMatch(bridge,/localStorage|sessionStorage|api\/rpc/);
});
