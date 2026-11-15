import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {prepareCatalogImport} from '../src/db/catalog-import.js';
import {planPartyImport} from '../src/party/party-import-plan.js';
import {verifyM02OfflineReconciliation} from '../scripts/check-m02-offline.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const inventory = fixtureFromBaseline();
function fixtureFromBaseline() {
  return JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
}
const catalog = () => fixture('catalog-synthetic.json');
const party = () => fixture('party-import.synthetic.json');
const approved = () => fixture('party-approved.synthetic.json');
const plans = (c,p,a=[]) => ({
  catalogPlan: prepareCatalogImport(inventory,c),
  partyPlan: planPartyImport(p,a)
});
const verify = (c,p,a=[],overrides={}) => {
  const prepared = plans(c,p,a);
  return verifyM02OfflineReconciliation({
    catalogSource:c,partySource:p,approvedGroups:a,
    ...prepared,...overrides
  });
};

test('reconciles independent catalogs and Party identities without revealing private values', () => {
  const result=verify(catalog(),party());
  assert.deepEqual(result,{
    catalogRows:4,partyRows:5,legacyLinks:5,quarantinedRows:0,proposedParties:5,
    approvedGroups:0
  });
  assert.doesNotMatch(JSON.stringify(result),/Rahim|01700000000|Vendor A|Phone 1/);
});

test('allows explicitly reviewed Party pair but no implicit auto-merge', () => {
  const c=catalog(), p=party();
  assert.equal(verify(c,p,approved()).proposedParties,4);
  const plan=plans(c,p);
  plan.partyPlan.links[1].partyId=plan.partyPlan.links[0].partyId;
  assert.throws(() => verify(c,p,[],{partyPlan:plan.partyPlan}),/unreviewed|merge|identity/i);
});

test('rejects quarantined Party row even when the planner reports a count', () => {
  const p=party();
  p.CUSTOMERS.push({'Customer ID':'','Customer Name':'Unknown','Phone':'01799998888','_rowIndex':3});
  assert.throws(()=>verify(catalog(),p),/quarantine|unmapped|missing id/i);
});

test('rejects lost Party provenance, duplicate row, and source position mutation', () => {
  const c=catalog(), p=party(), plan=plans(c,p);
  plan.partyPlan.links.pop();
  assert.throws(()=>verify(c,p,[],{partyPlan:plan.partyPlan}),/link|unmapped|count/i);
  const plan2=plans(c,p);
  plan2.partyPlan.links[0].legacySheetRow=999;
  assert.throws(()=>verify(c,p,[],{partyPlan:plan2.partyPlan}),/position|row/i);
  const duplicate=party();
  duplicate.SUPPLIERS.push({...duplicate.SUPPLIERS[0],_rowIndex:3});
  assert.throws(()=>verify(c,duplicate),/quarantine|unmapped/i);
});

test('rejects altered catalog IDs or dropped transformed catalog rows', () => {
  const c=catalog(), p=party(), plan=plans(c,p);
  plan.catalogPlan.tables.PRODUCT_UNITS[0].unit_id='FORGED-0001';
  assert.throws(()=>verify(c,p,[],{catalogPlan:plan.catalogPlan}),/catalog|identifier|source/i);
  const plan2=plans(c,p);
  plan2.catalogPlan.tables.SETTINGS.pop();
  assert.throws(()=>verify(c,p,[],{catalogPlan:plan2.catalogPlan}),/catalog|count/i);
});

test('CLI is offline, emits only reconciled counters and redacts rejection details', () => {
  const script=new URL('../scripts/check-m02-offline.mjs',import.meta.url).pathname;
  const c=new URL('./fixtures/catalog-synthetic.json',import.meta.url).pathname;
  const p=new URL('./fixtures/party-import.synthetic.json',import.meta.url).pathname;
  const a=new URL('./fixtures/party-approved.synthetic.json',import.meta.url).pathname;
  const good=spawnSync(process.execPath,[script,c,p,a],{encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);
  const summary=JSON.parse(good.stdout);
  assert.equal(summary.proposedParties,4);
  assert.doesNotMatch(good.stdout,/Rahim|01700000000|Vendor A/);
  const bad=spawnSync(process.execPath,[script,c],{encoding:'utf8'});
  assert.equal(bad.status,1);
  assert.match(bad.stderr,/rejected/i);
  assert.doesNotMatch(bad.stderr,/Rahim|01700000000|Vendor A/);
});