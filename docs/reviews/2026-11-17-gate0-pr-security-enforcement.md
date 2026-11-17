# Gate-0 Run 1 — GitHub PR review/CI enforcement audit

**Observed:** 2026-11-17, `main@5290a06abda5a0e42192b8bfbcc2f83e59495647`; ruleset **27454206**, `SherERP Main Branch Protection`. **Evidence:** GitHub `GET /repos/shuvodelux-commits/SherERP_Cloud/rulesets/27454206`; issue #594; coordination #456. **Decision:** protected default branch with partial required-check coverage; *independent security-review enforcement NOT YET VERIFIED*. This report performs no administration write.

## Live ruleset observations

| Property | Verified observation | Implication |
|---|---|---|
| Ruleset | `active`, ref `~DEFAULT_BRANCH`, no bypass actors | Applies to default branch, not an unconditional all-workflow gate |
| PR review | One approving review; stale reviews dismissed on push; all review threads resolved | Basic review requirements exist; does not prove independent Super QA and a separate Super Review |
| Code owner review | `require_code_owner_review:false` | No owner-specific approval enforced for `src/db`, `migrations`, `src/rpc`, `src/auth`, financial paths |
| Last-push approval | `require_last_push_approval:false` | Review should be rechecked for latest final head; stale review dismissal offers partial defense |
| Required status checks | **3** named contexts: `m00-audit`, `Fast PR confidence`, `Verify source, Worker and safe preview configuration` | The other workflows may fail or remain pending without being directly required by this ruleset |
| Strict branch sync | `strict_required_status_checks_policy:false` | Head SHA must still be verified with current full CI before manual merge |
| History/deletion | Non-fast-forward and deletion rules present | Preserves history and deletion resistance |
| Full rule administration | GitHub connector can read ruleset but does **not** have authenticated administrative write access | A repository administrator must change the rule separately and provide evidence |

This is **not** a finding that production financial data was exposed. The public Worker is currently inert and D1-free. It **is** a process finding: #587 merged after 44/44 CI without recorded independent QA/Review at the time, per #594. Repeated 44-workflow success on a PR is not equivalent to enforceable gate completeness. A draft PR must stay unmerged regardless of checks. A head-changing push invalidates previous completion/review claims.

## Approved direction proposed for M11/administrator review

1. **One stable aggregate PR context** (e.g. `Full SherERP Acceptance Gate`) which rejects a missing, failed, cancelled, superseded or pending required member of the approved full-CI matrix on the **exact current head**. It must evaluate source preservation, Node tests, M02 mapping, M03 Workerd/D1, M04 authentication/security, M05–M09 ledger/contracts, M01 Chromium/mobile/print, and no-deploy preview safety. This is a *design proposal*, not an existing workflow. Prefer one well-reviewed CI orchestration to 44 check-context names in branch settings if behavior and false-positive resistance can be proven. Never allow the aggregate to pass using a stale head or its own status, or accept a mere success-count threshold if expected job names disappeared.
2. **M11 owns** any edit to `.github/workflows/**` / CODEOWNERS and coordinates risk-specific PR review with M03 and M04. Do not add this workflow blindly while other chats edit global CI.
3. Require that an auth/RPC/shared D1 change has an independent QA record plus a distinct Super Review and an authorized human reviewer decision, all pointing at the exact head. Review the possibility of path-aware CODEOWNERS enforcement, a second approval, or a required stable security-review status for high-risk paths. GitHub's current one-approval rule alone cannot attest two independent review roles.
4. Change the active ruleset **only through the repository administrator**, following a tested non-production ruleset/PR scenario. Required checks must be stable and sourced from the expected GitHub Actions integration. Keep `non_fast_forward`, deletion protection, thread resolution and stale-review dismissal.
5. Re-audit any scheduled merge automation. Disable unauthorized auto-merge for M03/M04/shared financial paths; it may select only final reviewer-approved, non-draft PRs with all current-head CI green and clean mergeability. Avoid bypass permissions or secret-bearing CI.

## Required synthetic acceptance experiments (not executed by this review)

- An intentionally **failed member check** on a test PR must prevent merging even when the three original protected contexts pass; verify the new aggregate is a *required* ruleset context, not decorative.
- A member workflow **pending/never triggered/missing** must prevent merging, not be interpreted as passing.
- An **unresolved review conversation** must prevent merging.
- A **new head after review** must invalidate stale approval and old run results.
- A **draft PR** or missing independent security review must remain blocked.
- Cross-workstream unrelated PRs continue to pass after the gate without skipping source/D1 or UI tests.

## Run 1 security decision record

- [x] Read current GitHub main ruleset and live open PR ownership; identify gaps in enforced checks and independent review.
- [x] Record the proposed stable aggregator/owner and required negative acceptance scenarios.
- [ ] **M11** produces reviewable aggregator implementation/spec via its own branch, with test-first proof and full CI.
- [ ] **Administrator** updates active `main` ruleset and supplies verified readback of checks and approval settings.
- [ ] **Independent QA and Super Review** record head-pinned evidence for protected/auth PRs; reviewers sign off.
- [ ] **Issue #594** is closed only after demonstrated rejection of failed/pending/draft/stale/unapproved PRs.

**NO-GO carried forward:** This document is not admin enforcement, not a new workflow, not an authorization to enable financial RPC or cloud D1. Do not merge an implementation PR solely because this document exists.
