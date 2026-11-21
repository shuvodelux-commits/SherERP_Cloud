import assert from 'node:assert/strict';
import {readdir} from 'node:fs/promises';
import {test} from 'node:test';

test('Shop Owner write migrations have unique numbered order',async()=>{
  const filenames=(await readdir('staging-migrations/shop-owner-write'))
    .filter(name=>/^\d{4}_.*\.sql$/.test(name));
  const prefixes=filenames.map(name=>name.slice(0,4));
  assert.equal(new Set(prefixes).size,prefixes.length,
    'two distinct Shop migrations cannot share a version');
  assert.ok(filenames.includes('0012_owner_first_day_cash_opening.sql'));
  assert.ok(filenames.includes('0013_support_product_permit.sql'));
});
