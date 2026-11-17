import test from 'node:test';
import assert from 'node:assert/strict';
import {patchPosV2HiddenVisibility} from '../scripts/patch-posv2-visibility.mjs';

// Minimal compiled HTML fixture. Never patch source/legacy files in place.
const html=String.raw`<html><head><style>
  body.pos-v2-active #page-pos #v2AddProductBtn {
    background: var(--pos-v2-primary);
  }
  body.pos-v2-active #page-pos #v2AddProductBtn:hover {
    filter: brightness(.97);
  }
</style></head><body><button id="v2AddProductBtn" class="btn" hidden>Add Product</button></body></html>`;

test('compiled POS V2 hidden CSS guard is unique, idempotent and source-preserving',()=>{
  const patched=patchPosV2HiddenVisibility(html);
  const guard='body.pos-v2-active #page-pos #v2AddProductBtn[hidden]';
  assert.equal(patched.split(guard).length-1,1);
  assert.match(patched,/#v2AddProductBtn\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
  assert.equal(patchPosV2HiddenVisibility(patched),patched);
  assert.ok(patched.includes('background: var(--pos-v2-primary);'));
  assert.ok(patched.includes('<button id="v2AddProductBtn" class="btn" hidden>'));
});

test('compiled visibility patch refuses source drift or duplicate selector boundaries',()=>{
  assert.throws(()=>patchPosV2HiddenVisibility('<html><style>.btn{display:flex}</style></html>'),
    /original POS V2/i);
  assert.throws(()=>patchPosV2HiddenVisibility(html+html),/duplicate|multiple|ambiguous/i);
});
