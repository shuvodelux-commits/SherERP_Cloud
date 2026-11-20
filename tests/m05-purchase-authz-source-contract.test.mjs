/**
 * M05 M03-cross-owner source-parity RED gate.
 * The real Workerd/D1 behavioral acceptance lives in
 * tests/integration/m05-source-purchase-permission-sql-parity.spec.mjs;
 * M03 must add that suite to its existing local-only workflow when fixing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const original=readFileSync(new URL('../legacy/source/Purchase.gs',import.meta.url),'utf8');
const candidate=readFileSync(new URL('../tests/fixtures/m03-first-purchase-atomic-local.mjs',import.meta.url),'utf8');
const sourcePermission=/requirePermission_\s*\(\s*token\s*,\s*'purchase'\s*,\s*'add'\s*\)\s*;\s*requireActiveCashSession_\s*\(\s*\)/u;

test('M03 local purchase SQL must use the frozen source purchase.add grant, never POS sales grant',()=>{
  assert.match(original,sourcePermission,
    'Original createPurchase source contract changed: do not infer grant from M03 synthetic POS tests');
  assert.match(candidate,/const\s+CURRENT_AUTH\s*=\s*`[\s\S]*?\$\.purchase\.add[\s\S]*?`;/u,
    'M03 first-purchase SQL-current auth must check source purchase.add (not pos.add)');
  assert.doesNotMatch(candidate,/json_type\(role\.permissions_json,\s*'\$\.pos\.add'\)/u,
    'POS sales permission must not authorize purchase supplier or stock write');
});
