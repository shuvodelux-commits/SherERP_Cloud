# M00 — Pinned literal browser RPC session boundary (2026-11-15)

## Original source and approved scope
- Authority: `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md`, M00 RPC inventory; source `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`.
- Existing `scripts/audit-m00-rpc.mjs` records **172 literal browser serverCall sites**, **129 unique names**, **four dynamic method sites**, but does not verify the token argument boundary on *literal* calls. PR #138 covers only the four dynamic sites.
- No owner of the M00 source-audit files appears in the current open PR list.

## Design
New `scripts/audit-m00-literal-rpc-session.mjs` is a pure, source-only Acorn AST contract audit; it operates on frozen 37 HTML and 47 GAS files and the checked-in literal inventory. It must:
1. Recompute `auditM00RpcContracts` and optionally assert the existing immutable snapshot. Traverse inline `<script>` blocks. Count only actual `serverCall('method', ...)` AST calls (not comments/strings, and never count the helper declaration). The AST literal count must match the lexical original inventory exactly. For each, require exactly one known GAS top-level function definition in the recorded source file; reject missing/duplicate target definitions, unsupported spreads, or malformed source.
2. For all normal authenticated literal methods, enforce browser `authToken` in **first positional input** and original GAS declaration `token` as its **first formal**. This is **only source argument placement**, not proof of authentication.
3. Enforce four **explicit source-reviewed exceptions only in `javascript.html`**:
   - `getAppShellData()`: no arguments on either side (pre-session inert shell bootstrap).
   - `login(mobile,password)`: original browser inputs `mobile, password` and original backend formals `mobile,password`.
   - `validateSession(saved)`: original browser `saved` and backend formal `token`.
   - `logout(token)`: original browser `token` and backend formal `token`; logout is not pre-session.
   Any extra uses or changed order of exception methods must fail closed. No other method is granted an exception.
4. Output a deliberately **compact reviewable snapshot** `docs/baseline/m00-literal-rpc-session.json`: SHA, methodology caveat, total literal/authenticated/exception call counts, distinct method count, four exception site/formal records only. Check via `--check`, regenerate only via explicit `--write`. Original 84 source files remain byte-for-byte unchanged.
5. Test tampering with normal browser `authToken`, original backend formal, login argument order, duplicated pre-session call, and source snapshot tampering; verify real frozen source counts and CLI.

## Files and security gates
- New script `scripts/audit-m00-literal-rpc-session.mjs`, test `tests/m00-literal-rpc-session.test.mjs`, compact inventory `docs/baseline/m00-literal-rpc-session.json`, spec and plan only.
- No Worker RPC registration, M03 shared DB SQL/schema, M04 session implementation, original GAS/HTML, UI design, financial posting, Cloudflare deployment or real D1 data changes.
- Correct argument names are not cryptographic token verification, authorization, input validation, rate limiting, or a complete functional RPC port. `PARALLEL-MODULE-READY` remains false; Worker RPC registry remains empty pending approved M04 gate.

## Audited discrepancy (actual CI evidence)

The original HTML/GAS AST audit finds **204 actual literal browser callsites and 155 distinct method names**. The earlier lexical scanner reported only **172 and 129** respectively, missing **32 individual callsites** (including `getBankAccountsBootstrap` in `bank.html:195`). The old M00 inventory is therefore NOT complete and must not be used as the only endpoint set for RPC allowlisting or migration acceptance. The new source-only audit checks all 204 source AST calls and pins the exact 32 missed callsites as a separate `coverageGaps` inventory. This finding requires a follow-up owner-reviewed reconciliation of the older scanner and all downstream inventories; do not quietly expand a public method allowlist. No live RPC auth or method activation is authorized here.
