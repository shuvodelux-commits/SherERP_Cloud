# M00 Dynamic RPC first-session-token contract (2026-11-15)

## Sources, purpose, constraints
Read `AGENTS.md`, `docs/WORKSTREAMS.md`, `docs/MIGRATION_PLAN.md` and ADR-007. Pinned original `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`; original source cannot be changed. The merged M00 contract audit `scripts/audit-m00-dynamic-rpc-arity.mjs` establishes exactly **4** dynamic HTML `serverCall` sites with **16** static possible target handlers and correct positional arity, but does not assert the **session token occupies the first positional RPC argument** on both sides.

## Small source-only change
- New `scripts/audit-m00-dynamic-rpc-session.mjs` (read-only Acorn AST; no Worker route).
- New `tests/m00-dynamic-rpc-session.test.mjs`.
- New deterministic checked-in `docs/baseline/m00-dynamic-rpc-session.json`.
- This spec + a Superpowers execution plan. No dependencies, no `src/db`, SQL, `src/rpc`, M03/M04 shared kernel, GAS/HTML files or GitHub deployment workflows.

## Verification contract
- First recompute merged M00 dynamic RPC arity from all pinned browser/GAS source files, checking the exact existing lexical, dynamic closure and arity snapshots. Never treat the candidate target list as a public allowlist.
- For each of the four known dynamic client callsites, locate precisely one Acorn `serverCall` with the exact reviewed `frontendFile`, line and selector, and require `arguments[1]` to be an AST `Identifier` named `authToken`. This is the original *variable* form, not proof of actual token validity.
- For every corresponding one of 16 original `FunctionDeclaration` GAS method targets, require the first formal parameter to be an `Identifier` named `token`. Reject missing, duplicate, ambiguous or changed method signatures.
- Produce only source method/file/line/formal names, counts `dynamicCallsites=4`, `checkedTargets=16`, and source SHA. `--check` compares a frozen JSON snapshot; `--write` explicitly regenerates it for review. Fail closed on source drift and unsupported modes.
- Test client first token replaced by plain user ID, wrong argument order (same arity), and one backend handler with altered first formal, while snapshots for method names/arity remain stable. Also test no changes to source map.
- Run real GitHub RED test before implementation (expected import missing), then GREEN implementation and 8 GitHub workflows. No auth, permissions, D1, financial ledger, or posting is altered.

## Security limits
Correct token *position* in the frozen GAS/browser source is not identity authentication, token verification, server-side authorization, input validation or a functioning M04 RPC. The public Worker registry stays fail-closed, and `PARALLEL-MODULE-READY` stays false. No production/staging writes, secrets or customer records.
