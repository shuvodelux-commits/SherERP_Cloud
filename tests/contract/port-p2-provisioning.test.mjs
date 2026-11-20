import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const installer = await import('../../scripts/port-p2-provisioning.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.url?.endsWith('/scripts/port-p2-provisioning.mjs')) throw error;
  return {};
});

const intent = {
  formatVersion: 1,
  operationId: '11111111-1111-4111-8111-111111111111',
  accountId: '1234567890abcdef1234567890abcdef',
  workersSubdomain: 'disposable-account',
  workers: { admin: 'port-admin', owner: 'port-owner' },
  releaseSha: 'a'.repeat(40),
  shopIds: ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']
};
const initial = {
  accountId: intent.accountId, workersSubdomain: intent.workersSubdomain,
  complete: true, privateDeployOwner: 'installer', availableD1Slots: 3,
  workers: [], databases: []
};

async function harness(t) {
  assert.equal(typeof installer.planProvisioning, 'function', 'offline provisioning planner is missing');
  const journalDirectory = await mkdtemp(join(tmpdir(), 'shererp-port-journal-'));
  t.after(() => rm(journalDirectory, { recursive: true, force: true }));
  const snapshot = structuredClone(initial);
  const creates = [];
  const receipts = new Map();
  const provider = {
    async inspect() { return structuredClone(snapshot); },
    async createDatabase(action) {
      creates.push(action);
      const id = `44444444-4444-4444-8444-${String(creates.length).padStart(12, '0')}`;
      const receipt = { ...action, id, evidenceRef: `fixture-${creates.length}` };
      snapshot.databases.push({ name: action.name, id });
      snapshot.availableD1Slots--;
      receipts.set(action.attemptId, receipt);
      return receipt;
    },
    async findCreation(action) { return receipts.get(action.attemptId); }
  };
  const plan = installer.planProvisioning(intent, initial);
  const options = {
    journalDirectory, provider, approval: { digest: plan.digest, reference: 'fixture-approval' }
  };
  return {
    plan, provider, snapshot, creates, journalDirectory,
    apply: (override = {}, candidate = plan) =>
      installer.applyProvisioning(candidate, { ...options, ...override })
  };
}

test('plans three distinct D1 creates and persists a no-op replay across invocations', async t => {
  const h = await harness(t);
  assert.deepEqual(h.plan, installer.planProvisioning(structuredClone(intent), initial));
  assert.deepEqual(h.plan.actions.map(action => action.role), ['control', 'shop-a', 'shop-b']);
  assert.equal(new Set(h.plan.actions.map(action => action.name)).size, 3);
  const result = await h.apply();
  assert.equal(result.status, 'complete');
  assert.equal(result.receipts.length, 3);
  assert.deepEqual(h.creates, h.plan.actions);
  assert.deepEqual(await h.apply(), result);
  assert.equal(h.creates.length, 3);
});

test('checks approval, target, inventory and quota before a create', async t => {
  const h = await harness(t);
  assert.throws(() => installer.planProvisioning(intent, { ...initial, complete: false }), /TARGET_MISMATCH/);
  const tampered = structuredClone(h.plan);
  tampered.actions[0].name = 'foreign';
  await assert.rejects(h.apply({}, tampered), /INVALID_PLAN/);
  await assert.rejects(h.apply({ approval: { digest: 'bad', reference: 'fixture' } }), /APPROVAL_REQUIRED/);
  for (const [key, value] of Object.entries({
    accountId: '9'.repeat(32), workersSubdomain: 'wrong', complete: false,
    privateDeployOwner: 'workers-builds', availableD1Slots: 2,
    workers: ['port-owner'], databases: [{ name: h.plan.actions[0].name,
      id: '99999999-9999-4999-8999-999999999999' }]
  })) {
    h.snapshot[key] = value;
    await assert.rejects(h.apply(), /TARGET_MISMATCH/);
    h.snapshot[key] = structuredClone(initial[key]);
  }
  assert.equal(h.creates.length, 0);
});

test('records pending before create and resumes only an attributed lost response', async t => {
  const h = await harness(t);
  const create = h.provider.createDatabase;
  const find = h.provider.findCreation;
  h.provider.createDatabase = async action => {
    const pending = JSON.parse(await readFile(join(h.journalDirectory, 'control.pending.json'), 'utf8'));
    assert.deepEqual(pending, action);
    await create(action);
    throw new Error('untrusted provider diagnostics');
  };
  await assert.rejects(h.apply(), { message: 'CREATE_OUTCOME_UNKNOWN' });
  h.provider.createDatabase = create;
  h.provider.findCreation = async action => ({ ...await find(action), attemptId: 'another-attempt' });
  await assert.rejects(h.apply(), /CREATE_OUTCOME_UNKNOWN/);
  assert.equal(h.creates.length, 1);

  h.provider.findCreation = find;
  assert.equal((await h.apply()).status, 'complete');
  assert.equal(h.creates.filter(action => action.role === 'control').length, 1);
  assert.equal(h.creates.length, 3);
});

test('blocks a duplicate invocation while the original outcome is unresolved', async t => {
  const h = await harness(t);
  const create = h.provider.createDatabase;
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  h.provider.createDatabase = async action => {
    if (action.role === 'control') {
      entered.resolve();
      await release.promise;
    }
    return create(action);
  };
  const running = h.apply();
  await Promise.race([entered.promise, running]);
  try {
    await assert.rejects(h.apply(), /CREATE_OUTCOME_UNKNOWN/);
    assert.equal(h.creates.length, 0);
  } finally {
    release.resolve();
    await running;
  }
  assert.equal(h.creates.length, 3);
});

test('refuses a different approved intent and detects drift after completion', async t => {
  const h = await harness(t);
  await h.apply();
  const other = installer.planProvisioning({ ...intent, releaseSha: 'b'.repeat(40) }, initial);
  await assert.rejects(h.apply({
    approval: { digest: other.digest, reference: 'second-approval' }
  }, other), /JOURNAL_CONFLICT/);
  h.snapshot.databases[0].id = '55555555-5555-4555-8555-555555555555';
  await assert.rejects(h.apply(), /TARGET_MISMATCH/);
  assert.equal(h.creates.length, 3);
});
