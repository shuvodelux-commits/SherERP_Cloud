import test from 'node:test';
import assert from 'node:assert/strict';
import {INVOICE_PROFILE_KEY,normalizeInvoiceProfile,defaultInvoiceProfile}
  from '../src/modules/m09-owner-invoice-profile.js';

test('normalize only the supported preview fields, without adding print authority',()=>{
  const x=defaultInvoiceProfile();
  assert.equal(INVOICE_PROFILE_KEY,'HisabIQ Invoice Studio v1');
  assert.deepEqual(Object.keys(x),['template','paper','language','checks']);
  assert.equal(x.paper,'A4');
  assert.deepEqual(normalizeInvoiceProfile(x),x);
  const modified={...x,template:'Compact',paper:'58 mm',language:'Bangla',
    checks:{...x.checks,signature:false}};
  assert.deepEqual(normalizeInvoiceProfile(modified),modified);
  assert.equal(Object.prototype.saved,undefined);
});

test('reject unsupported preview design, unknown fields, forged prototypes, nonbooleans and accessors',()=>{
  const base=defaultInvoiceProfile();
  const invalid=[
    {...base,template:'Modern'},{...base,paper:'A3'},
    {...base,language:'Français'}, {...base,checks:{...base.checks,due:'false'}},
    {...base,checks:{...base.checks,secret:true}},
    {...base,role:'Owner'},Object.create({template:'Standard'}),
    Object.defineProperty({...base},'paper',{get(){throw Error('must not execute accessor')}})
  ];
  for(const profile of invalid)assert.throws(()=>normalizeInvoiceProfile(profile),/Invalid|unsupported/i);
});
