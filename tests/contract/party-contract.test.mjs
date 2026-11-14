import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { partyLegacyContracts, rolesForLegacyRow, validatePartyContracts } from '../../src/party/legacy-contracts.js';

const inventory=JSON.parse(readFileSync(new URL('../fixtures/party-inventory.synthetic.json', import.meta.url), 'utf8'));

test('all five original party master identities and required legacy headers are mapped exactly', () => {
  assert.deepEqual(Object.keys(partyLegacyContracts).sort(),[
    'CUSTOMERS','EXPENSE_PAYEES','FINANCE_PERSONS','SUPPLIERS','VENDORS'
  ]);
  assert.equal(validatePartyContracts(inventory), true);
  for(const [group, desc] of Object.entries(partyLegacyContracts)) {
    const table=inventory.tables.find(t=>t.sheetKey===group);
    assert.ok(table.columns.includes(desc.idColumn),group+' ID missing');
    assert.ok(table.columns.includes(desc.nameColumn),group+' name missing');
    assert.ok(table.columns.includes(desc.phoneColumn),group+' phone missing');
  }
});

test('finance roles combine Owner, Lender, Borrower; legacy Person Type fallback is retained',()=>{
  assert.deepEqual(rolesForLegacyRow('FINANCE_PERSONS',{'Roles':'Borrower,Owner,Lender','Person Type':'Lender'}),['Owner','Lender','Borrower']);
  assert.deepEqual(rolesForLegacyRow('FINANCE_PERSONS',{'Person Type':'Borrower'}),['Borrower']);
  assert.deepEqual(rolesForLegacyRow('FINANCE_PERSONS',{}),['Owner']);
  assert.deepEqual(rolesForLegacyRow('CUSTOMERS',{}),['Customer']);
  assert.deepEqual(rolesForLegacyRow('EXPENSE_PAYEES',{}),['Payee']);
});

test('schema drift or missing original headers fails closed',()=>{
  const changed=structuredClone(inventory);
  const customer=changed.tables.find(x=>x.sheetKey==='CUSTOMERS');
  customer.columns=customer.columns.filter(x=>x!=='Customer ID');
  assert.throws(()=>validatePartyContracts(changed),/CUSTOMERS.*Customer ID/);
});
