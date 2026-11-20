/** PORT-00 P2 disposable D1 create contract. The provider is injected.
 * This module has no CLI or Cloudflare client. The caller supplies a verified
 * approval and the protected journal directory shared by every retry.
 */
import { createHash } from 'node:crypto';
import { lstat, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { reconcileCreateAttempt, validatedReceipt } from '../src/auth/port-p2-create-attempt.js';

const accountPattern = /^(?!0{32}$)[a-f0-9]{32}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const slugPattern = /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const referencePattern = /^[a-zA-Z0-9._:-]{1,128}$/;
const roles = ['control', 'shop-a', 'shop-b'];

function exactKeys(value, keys) {
  return value != null && typeof value === 'object' &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function matches(pattern, value) {
  return typeof value === 'string' && pattern.test(value);
}

function buildPlan(input) {
  const keys = ['formatVersion', 'operationId', 'accountId', 'workersSubdomain', 'workers', 'releaseSha', 'shopIds'];
  if (!exactKeys(input, keys)) throw new Error('INVALID_PLAN');
  const { formatVersion, operationId, accountId, workersSubdomain, workers, releaseSha, shopIds } = input;
  if (formatVersion !== 1 || !matches(uuidPattern, operationId) || !matches(accountPattern, accountId) ||
      !matches(slugPattern, workersSubdomain) || !matches(/^[a-f0-9]{40}$/, releaseSha) ||
      !exactKeys(workers, ['admin', 'owner']) || !matches(slugPattern, workers.admin) ||
      !matches(slugPattern, workers.owner) || workers.admin === workers.owner ||
      [workers.admin, workers.owner].includes('hisabiq') ||
      !Array.isArray(shopIds) || shopIds.length !== 2 ||
      !matches(uuidPattern, shopIds[0]) || !matches(uuidPattern, shopIds[1]) ||
      new Set([operationId, ...shopIds]).size !== 3) {
    throw new Error('INVALID_PLAN');
  }

  const intent = {
    formatVersion, operationId, accountId, workersSubdomain,
    workers: { admin: workers.admin, owner: workers.owner }, releaseSha, shopIds: [...shopIds]
  };
  const actions = roles.map(role => ({
    role, accountId, name: `port-${operationId.replaceAll('-', '')}-${role}`,
    attemptId: `${operationId}:${role}`
  }));
  const digest = createHash('sha256').update(JSON.stringify({ intent, actions })).digest('hex');
  return { intent, actions, digest };
}

function assertTarget(snapshot, plan, receipts, pending) {
  const { intent, actions } = plan;
  if (snapshot?.complete !== true || snapshot.accountId !== intent.accountId ||
      snapshot.workersSubdomain !== intent.workersSubdomain || snapshot.privateDeployOwner !== 'installer' ||
      !Array.isArray(snapshot.workers) || snapshot.workers.length !== 0 ||
      !Array.isArray(snapshot.databases) || !Number.isSafeInteger(snapshot.availableD1Slots) ||
      snapshot.availableD1Slots < actions.length - snapshot.databases.length) {
    throw new Error('TARGET_MISMATCH');
  }

  const known = new Map(receipts.map(row => [row.name, row.id]));
  const ids = new Set();
  for (const row of snapshot.databases) {
    if (!matches(uuidPattern, row?.id) || ids.has(row.id)) throw new Error('TARGET_MISMATCH');
    ids.add(row.id);
    if (known.get(row.name) === row.id) {
      known.delete(row.name);
    } else if (row.name === pending?.name) {
      pending = undefined;
    } else {
      throw new Error('TARGET_MISMATCH');
    }
  }
  if (known.size !== 0) throw new Error('TARGET_MISMATCH');
}

export function planProvisioning(intent, snapshot) {
  const plan = buildPlan(intent);
  assertTarget(snapshot, plan, []);
  return plan;
}

async function readRecord(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error('JOURNAL_UNAVAILABLE');
  }
}

// A durable exclusive claim precedes the external call. An interrupted
// claim write remains a stop condition, so it cannot reopen the create.
async function writeRecord(directory, name, value) {
  let handle;
  try {
    handle = await open(join(directory, name), 'wx', 0o600);
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    const folder = await open(directory, 'r');
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
    return true;
  } catch (error) {
    if (!handle && error.code === 'EEXIST') return false;
    throw new Error('JOURNAL_UNAVAILABLE');
  } finally {
    await handle?.close();
  }
}

async function inspect(provider) {
  try {
    return await provider.inspect();
  } catch {
    throw new Error('TARGET_MISMATCH');
  }
}

/** Calling again with the same plan and journal is the resume operation.
 * findCreation must return independently attributed attempt evidence. An
 * inventory name match alone cannot establish ownership.
 */
export async function applyProvisioning(candidate, { journalDirectory, provider, approval } = {}) {
  const plan = buildPlan(candidate?.intent);
  if (!isDeepStrictEqual(plan, candidate)) throw new Error('INVALID_PLAN');
  if (approval?.digest !== plan.digest || !matches(referencePattern, approval.reference)) {
    throw new Error('APPROVAL_REQUIRED');
  }
  const directory = await lstat(journalDirectory).catch(() => null);
  if (!directory?.isDirectory() || (directory.mode & 0o077) !== 0) {
    throw new Error('JOURNAL_UNAVAILABLE');
  }

  const { digest, intent, actions } = plan;
  const operation = { digest, operationId: intent.operationId, approvalReference: approval.reference };
  if (!await writeRecord(journalDirectory, 'operation.json', operation)) {
    const saved = await readRecord(join(journalDirectory, 'operation.json'));
    if (!isDeepStrictEqual(saved, operation)) throw new Error('JOURNAL_CONFLICT');
  }

  const receipts = [];
  for (const action of actions) {
    const claimName = action.role + '.pending.json';
    const resultName = action.role + '.done.json';
    const existing = await readRecord(join(journalDirectory, resultName));
    const pending = await readRecord(join(journalDirectory, claimName));
    if (pending !== undefined && !isDeepStrictEqual(pending, action)) throw new Error('JOURNAL_CONFLICT');
    if (existing !== undefined) {
      if (pending === undefined) throw new Error('JOURNAL_CONFLICT');
      receipts.push(validatedReceipt(existing, action));
      continue;
    }

    assertTarget(await inspect(provider), plan, receipts, pending);
    if (pending === undefined && !await writeRecord(journalDirectory, claimName, action)) {
      throw new Error('CREATE_OUTCOME_UNKNOWN');
    }

    const receipt = validatedReceipt(await reconcileCreateAttempt(provider, action, pending !== undefined), action);
    receipts.push(receipt);
    assertTarget(await inspect(provider), plan, receipts);
    if (!await writeRecord(journalDirectory, resultName, receipt)) {
      const saved = await readRecord(join(journalDirectory, resultName));
      if (!isDeepStrictEqual(saved, receipt)) throw new Error('JOURNAL_CONFLICT');
    }
  }
  assertTarget(await inspect(provider), plan, receipts);
  return { status: 'complete', operationId: intent.operationId, receipts };
}
