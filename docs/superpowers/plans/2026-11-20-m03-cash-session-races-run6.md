# M03 Run 6 — Cash Session real-D1 race and source permission hardening

**Repository:** shuvodelux-commits/SherERP_Cloud · **M03** #22 · **M04** #23 · **M08** #66 · **M11** #306 · coordination #456.
**Frozen source:** `Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2`, CashSession.gs and Auth.gs unchanged.
**Starting main:** `e23c80a17d34bd9d1633ee28ba019ae0819f0911` after verified merged #752.
**Other PRs at task claim:** M03 #758 purchase and #759 Control Center, M05 #756; no shared edits.
**Exclusive paths:** this new plan, append-only `tests/integration/m03-local-cash-session-workerd.spec.mjs`, new `tests/fixtures/m03-local-cash-interleaving-driver.mjs`.
**No shared source edits:** `src/db/**`, `migrations/**`, `src/rpc/**`, `src/index.js`, actual Cash Session module, existing M03 purchase/Control Center tests, original UI/source, Worker config, Cloudflare bindings, production/staging D1 or workflows.

## Twelve-sentence implementation overview

1. Merged #752 already proves persisted Starting/Open/Closing/Closed state transitions and SQL-current M04 POS permissions with synthetic Cash Session tables in real local Workerd/D1.
2. A new finite set of racing clients is required to ensure two different Start Day requests cannot both claim an unfinished session.
3. Two independent Close Day IDs racing the same Open session must create exactly one Closed transition and one zero-valued marker.
4. Two repeated immutable Cash intent IDs with the same actor and amount must make only one synthetic receipt and journal entry.
5. Replaying another actor's ID or changing its session or amount must not return the original receipt.
6. To test time-of-check/time-of-use, a local D1 wrapper will delegate all calls to the real binding but inject a real role revocation immediately before the actual SQLite insert.
7. The same fixture will close the session just before cash intent insertion, checking that a stale preflight Open state cannot authorize a late write.
8. It will also toggle the Cash Session ON/OFF policy just before the SQL insert and assert either transition fails closed for a now-wrong session value.
9. Original historical opening rows and zero-valued Start/Close boundary markers must remain unchanged by all failed intents.
10. These are disposable local tests of source permissions and SQL atomicity, not an operational Cash Book, POS, bank, Party ledger or production transaction.
11. Superpowers TDD adds the regression first and observes its RED failure in the existing M03 local Workerd GitHub Actions workflow before introducing the minimal D1 interleaving test driver.
12. The GREEN head must pass real Workerd/D1, full GitHub CI and independent M03/M04/M08/M11 QA/review before the user explicitly authorizes a merge.

## Safety and go/no-go

- Use the merged #752 nondeployable module unchanged. A code correction is justified only by an observed failing acceptance test, and must remain in M03-owned files.
- Auth is server-owned opaque token, SQL-current user/role/credential epoch, original `pos.add` action. No browser caller can supply the trusted clock or actor.
- One local D1 per Shop was the earlier prototype model; source Supplier identity, full historical Cash Book, Bank/AR and purchase/return transactions remain separate release blockers.
- Never infer productive cash balance from zero markers, historical opening rows or fabricated journal receipts.
- M08's new-shop HALF_UP/integer-paisa design policy is approved, but money maxima, overflow caps, source identity and verified recovery are not. **No live financial writer, public RPC, remote D1 or Cloudflare deploy.**
- New tests run through existing `.github/workflows/m03-local-cash-session-workerd.yml` without editing M11-owned CI.
