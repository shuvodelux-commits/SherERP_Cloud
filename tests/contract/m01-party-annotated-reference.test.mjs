import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const ui=await readFile(new URL('../../src/ui/hisabiq/party-workspace.mjs',import.meta.url),'utf8');
const css=await readFile(new URL('../../src/ui/hisabiq/party-workspace.css',import.meta.url),'utf8');

test('annotated source Party layout has its six core controls and bilingual reference fields',()=>{
  for(const id of [
    'hparty-more','hparty-action-receive','hparty-action-note',
    'hparty-ledger-query','hparty-ledger-type','hparty-ledger-page-size',
    'hparty-source-preview','hparty-payment-modal','hparty-editor-role-grid',
    'hparty-editor-openings','hparty-supplier-name','hparty-supplier-name-bn',
    'hparty-supplier-phone','hparty-supplier-address'
  ])assert.ok(ui.includes(id),'Missing source-locked Party control '+id);
  for(const label of ['Particulars','Debit','Credit','Running','Actions',
    'Payment sources','Invoice / bill allocation','In words · কথায়',
    'Opening balances (optional)','Relationship','Amount received/paid',
    'Refund credit','New invoice','Add note'])assert.ok(ui.includes(label),
    'Missing annotated label '+label);
});

test('source preview and ledger action menu can view, but never post edits or reversals',()=>{
  for(const label of ['View','Edit','Print','Delete / reverse'])
    assert.ok(ui.includes(label),'Source action omitted '+label);
  assert.match(ui,/No bank transfer or real accounting posting occurs/);
  assert.match(ui,/The original ledger is read-only/);
  assert.doesNotMatch(ui,/localStorage\.setItem\([^)]*ledger|dispatchPartyPreview/,
    'No HisabIQ demo financial posting or local fake persistence');
  assert.match(ui,/fetch\('\/api\/owner\/suppliers'/);
});

test('role opening editor keeps independently labelled gross balances and rejects unsupported writes',()=>{
  assert.match(ui,/type="checkbox"[^>]+name="hparty-role"/);
  assert.match(ui,/hparty-opening-amount/);
  assert.match(ui,/hparty-opening-side/);
  assert.match(ui,/hparty-opening-date/);
  assert.match(ui,/Supplier/);
  assert.match(ui,/sourceSupplierCreatePayload/);
  assert.match(ui,/nonzero/i);
});

test('mobile, tablet, desktop and modal use source HisabIQ scoped dimensions',()=>{
  for(const marker of ['.hparty-editor-role-grid','.hparty-ledger-toolbar',
    '.hparty-source-preview','.hparty-payment-modal','.hparty-action-bar'])
    assert.ok(css.includes(marker),'Missing scoped reference style '+marker);
  assert.match(css,/@media \(max-width:767px\)/);
  assert.match(css,/@media \(min-width:768px\)/);
  assert.match(css,/@media \(min-width:1024px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('source-aligned Bangla amount in words supports zero, taka and paisa',async()=>{
  const {amountInWordsBn}=await import('../../src/ui/hisabiq/party-workspace.mjs');
  assert.equal(amountInWordsBn(0),'শূন্য টাকা মাত্র');
  assert.equal(amountInWordsBn(1200.55),'এক হাজার দুইশত টাকা পঞ্চান্ন পয়সা মাত্র');
  assert.equal(amountInWordsBn(48650),'আটচল্লিশ হাজার ছয়শত পঞ্চাশ টাকা মাত্র');
  assert.equal(amountInWordsBn(Infinity),'');
});
