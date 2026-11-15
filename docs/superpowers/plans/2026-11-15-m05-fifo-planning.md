# M05 FIFO planning port — TDD plan

1. [x] Pin original six functions plus Utils date/number/rounding helpers from immutable source; extract AST spans and verify body equality.
2. [x] Write standalone pure source oracle tests first for purchase-date FIFO, mixed supplier lots, pricing ladder and rounding, oversold, vendor net-owned guard, nonmutation and missing context. Observe RED against absent port.
3. [x] Copy selected original GAS function bodies byte-for-byte with minimal explicit-context-only helper; export internal methods.
4. [x] Run fresh Node unit suite, existing Workerd/D1, fixed source manifest, M03 caller and M00 dynamic RPC audit, frontend build and git diff.
5. [ ] Push scoped PR. Require all GitHub workflow checks green and exact-head Cloudflare Preview successful /api/health HTTP 200 DB-free before squash merge.
