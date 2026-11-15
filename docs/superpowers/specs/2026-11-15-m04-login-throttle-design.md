# M04 Login Throttle Transitions — Isolated Design (2026-11-15)

**Status:** Internal, pure security-policy preparation only. No public login, rate-limiting deployment, D1 schema, token or identity lookup.

## Problem and source
The pinned `legacy/source/Auth.gs` applies a per-normalized-mobile throttle: five failed attempts trigger a 15-minute lockout, with state held for one hour in GAS CacheService. `login` checks under LockService; a blocked caller does not enter credential verification; expired locks get cleared. This cannot be ported by using Worker instance memory or an unaudited cache: future D1 must perform atomic read/check/record under a single trusted concurrency boundary.

Immutable source provenance: `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; `Auth.gs` Git blob `f1c0895e33eb89430337b752692d0023797b7d21`.

## Implementation approaches
1. **Chosen:** pure, replayable throttle state machine, preserving the source 5/15m/60m policy in fully synthetic tests, with no account or database side effects. Reviewable without shared D1 ownership.
2. Add `login_throttle` SQL or public RPC now. Deferred: M03 exclusive schema owner, D1 concurrency and M04 session/login gates incomplete.
3. Worker-global `Map`/Cache API as authoritative throttle. Rejected: fail-open across isolates, regions and restarts.

## Interface
`transitionLoginThrottle(prior, event, nowMs)` in `src/auth/login-throttle-policy.js`:
- `prior`: exactly `null` (confirmed absent from a **successfully queried** future durable store) or a server-owned plain record with own non-accessor integer `failureCount` (1..5), `lockedUntilMs` (0 until count reaches 5), `lastFailureAtMs`, and `resetAtMs`. Undefined/malformed/inherited or accessor fields, invalid time or records from the future throw; **never treat read errors as null**.
- `event`: strict `'inspect'`, `'failure'` or `'success'`. Unknown event throws.
- `nowMs`: trusted server-owned nonnegative safe-integer epoch time; no `Date.now()`, IP/phone lookup, user-actor input, floating timestamps or time coercion.
- Return `{blocked:boolean,state:record|null}` without mutating input. On inspection of a still-active lock, `blocked=true` and state retained; after lock expiry or one-hour state TTL, state resets to null and `blocked=false`.
- On failure of an unlocked state, increment the count; failure 5 starts `lockedUntilMs=now+15m`, all failures refresh `resetAtMs=now+60m`. Threshold-reaching failure reports `blocked=true`. Further failures during lock **cannot extend** lock or counter.
- Success while unlocked clears the counter. A reported success while locked must not clear it. Inspection never advances counter. At exactly lock boundary, reset before recording another failure.
- Reject overflowing timestamps and contradictory record structure. No arbitrary production TTL selected: constants exactly match pinned GAS source.

## Security boundaries
- This reducer is **not a live limiter**. Every future caller must first validate rate-limit record storage availability and perform inspection, credential proof and failure/success writes with D1 concurrency-safe atomic semantics. Simultaneous requests must not race five failures into one counted event.
- A caller must normalize phone per the pinned source under a separately reviewed identity policy; this module never keys or logs phone numbers, passwords, account IDs or IP addresses. Avoid user enumeration in eventual error responses.
- No `src/db`, migrations, `src/rpc`, `src/index.js`, `src/auth/legacy-password.js`, `src/auth/session-token.js` (open PR #34), `src/auth/session-validity.js` (open PR #35), permission-policy PR #30, source snapshot, frontend or Cloudflare config edits.
- No staging/production D1 operations or Party, inventory, cash, ledger, finance effects.

## Acceptance
Test-first RED→GREEN; source limit parity, first-four/fifth-failure behavior, exact 15-minute boundary, one-hour reset, successful clear, malformed/inherited record denial, time overflow and no Worker/RPC binding. Full `npm test`, source manifest, frontend build, syntax and diff checks. Draft PR only; M04 and PARALLEL-MODULE-READY remain incomplete.
