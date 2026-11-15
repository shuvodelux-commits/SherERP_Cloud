# M03 — Versioned canonical operation-intent fingerprint (internal only)

**Scope:** Metadata prerequisite for a future authenticated D1 operation-ID/receipt kernel. This change does **not** implement sales, purchase, inventory, finance, stock posting, payment, idempotency execution, authentication or public RPC.

## Why this contract matters
The preserved source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2` must ultimately preserve original financial and inventory behavior without reusing GAS `LockService` or unsafe JavaScript state. Merged M03 PR #49 introduces a **test-only** Workerd/D1 atomic replay fixture with a `payload_hash` column and status `COMMITTED` / `REPLAY` / `CONFLICT` / `DECLINED`. It does not specify how business intent bytes should be serialized. A hash of an ordinary `JSON.stringify` result would vary with object insertion order, while IEEE 754 amounts and coercions could silently change or alias intent.

## Internal API and exact digest bytes
```js
import {hashCanonicalOperationIntent} from './src/db/operation-intent-fingerprint.js';
const payloadHash=await hashCanonicalOperationIntent({
  tenantId:'tenant-1',   // verified on the server
  actorId:'staff-1',     // verified authenticated actor, NOT a request field
  operationType:'sales.post', // reviewed server-side operation class
  payload:{items:[{sku:'PIPE',quantity:'1.000'}],total:'120.00'}
});
```

Output: 64 lowercase hexadecimal SHA-256 characters. Digest input (UTF-8) is exactly:

```text
SherERP:operation-intent:v1
{"actorId":"staff-1","operationType":"sales.post","payload":{"items":[{"quantity":"1.000","sku":"PIPE"}],"total":"120.00"},"tenantId":"tenant-1"}
```

The prefix includes **one LF byte** before the JSON, with no trailing newline. Nested object keys are sorted lexicographically by JavaScript string comparison; array element ordering remains significant. Strings are encoded by standard JSON quoting and UTF-8; no case, whitespace, Unicode or locale normalization is performed. Different Unicode codepoints represent different intents even when visually similar. This is a documented **application-specific** canonical JSON subset, **not** a claim of full RFC 8785 (JCS) conformance.

### Input rules and threat model
- Exact four-key record `{tenantId,actorId,operationType,payload}` only, with no unknown/context-injected keys or accessors.
- Tenant and actor IDs must be nonblank opaque identifiers matching `[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}`. Operation class must be lowercase `[a-z][a-z0-9._-]{1,63}`. Neither identity nor module permission comes from the caller's untrusted payload. The helper is not an authorization mechanism.
- `payload` must be a plain JSON-like object; recursively support only plain own-data objects, dense plain arrays, `null`, booleans, well-formed Unicode strings and safe **integer** numbers excluding `-0`.
- **Decimal money or fractional quantities must be strings** chosen and validated by the future business module. Floating points, `NaN`, infinities, unsafe integers, `Date`, `BigInt`, `undefined`, functions, symbols, custom prototypes, sparse/decorated arrays, getters, invalid surrogate code units and prototype-pollution keys fail closed rather than being omitted or coerced.
- Max encoding is **32,768 UTF-8 bytes including prefix**, max graph depth **16**, node limit **4,096**; cycles are refused. Inputs remain untouched. Crypto comes from Web Crypto SHA-256, and missing crypto fails closed.
- This hashes an in-memory parsed object; it cannot detect duplicate keys previously collapsed by an untrusted JSON parser. Future authenticated RPC must validate raw request schema, fields, exact decimal representation, operation scope and permission **before** invoking this helper. Do not pass client-provided hashes straight into a receipt.
- There is no app-level mutable cache or claim that SHA-256 is a signature. A digest only distinguishes intended inputs within a DB-enforced operation-ID/tenant namespace.

## Real local D1 proof
`tests/m03-operation-intent-fingerprint.test.mjs` compares the real Node/WebCrypto digest to an **independently hand-authored** sorted JSON string hashed using `node:crypto`, and covers ordering, changed context, UTF-8, type coercion and malformed input.

`tests/integration/m03-intent-fingerprint-workerd.spec.mjs` launches an independent nondeployable Worker configured by `wrangler.m03-intent-fingerprint-test.jsonc` with a dummy D1 binding UUID. The fixture computes the digest **inside Cloudflare Workerd** and passes it to the **existing merged test-only** `createSyntheticD1PostingContract` (PR #49). Its synthetic D1 tables are created only in local tests. Observed cases: one COMMITTED synthetic movement, REPLAY for reordered nested keys, CONFLICT for modified total, tenant, actor or operation type, and rejection of malformed payload without any D1 posting. All Worker test routes use hard-coded values; HTTP body cannot choose SQL, identity, amount or scope.

## Ownership, impact and recovery
- **New:** `src/db/operation-intent-fingerprint.js`, Node test, local-only Workerd test and fixture, fake Wrangler D1 config, this design and execution plan.
- **Modified:** `tests/integration/m03-workerd.spec.mjs` adds one import; the existing GitHub PR-only validation job uses it without workflow changes.
- **Unchanged:** schema and migrations, existing `src/db` SQL adapters, public `src/index.js`, `src/rpc/**`, original frontend and GAS source, Cloudflare deployment and D1 staging/production bindings, real stock, invoices, Party roles, ledgers, Cash and Bank. No real data import or write. Recovery is reverting this isolated PR commit.

**Remaining gates:** Approved canonicalization for each source-compatible module, persisted receipts with per-tenant operation ID uniqueness, authenticated M04 actor/permissions, M02 import, M03 full async port, audited exactly-once reversal and full ledger/stock atomicity. `PARALLEL-MODULE-READY` remains **false** until those gates are independently evidenced.
