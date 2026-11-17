import {test} from 'node:test';
import assert from 'node:assert/strict';
import {M02_ID_FAMILIES} from '../scripts/dry-run-id-floor.mjs';
import {
  SOURCE_ID_PREFIXES,originalSourceIdPrefix
} from '../src/db/m03-source-id-families.js';

test('Run 3 original prefix contract matches all 38 M02 pinned source families',()=>{
  const frozen=Object.fromEntries(M02_ID_FAMILIES.map(
    family=>[family.sourceGroup,family.prefix]
  ));
  assert.equal(M02_ID_FAMILIES.length,38);
  assert.deepEqual({...SOURCE_ID_PREFIXES},frozen);
  assert.equal(Object.isFrozen(SOURCE_ID_PREFIXES),true);
  for(const [group,prefix] of Object.entries(frozen)){
    assert.equal(originalSourceIdPrefix(group),prefix,group);
  }
  assert.equal(originalSourceIdPrefix('SALES'),'INV');
  assert.equal(originalSourceIdPrefix('PURCHASES'),'PUR');
  assert.equal(originalSourceIdPrefix('SALES_RETURN'),'SRT');
  assert.equal(originalSourceIdPrefix('PURCHASE_RETURN'),'PRT');
});
test('nonsequential or attacker-named source groups cannot request a sequence',()=>{
  for(const invalid of [
    'SESSIONS','SALE_POSTING_JOURNAL','SETTINGS','SALE_ITEMS',
    '__proto__','constructor','toString','PRODUCT_CATEGORIES;DROP',
    '',null,undefined,{},Symbol('SALES')
  ])assert.equal(originalSourceIdPrefix(invalid),null);
});
