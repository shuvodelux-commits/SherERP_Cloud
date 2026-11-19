/** M03 legacy all-in-one test aggregator; unchanged complete suite for direct callers. */
import './m04-auth-http-workerd.spec.mjs'; // M04 server-opt-in original RPC envelope against actual isolated D1.
import './m03-settings-workerd.spec.mjs'; // M03 Settings Key/Value and restricted shell projection; local D1 only.
import './m03-m04-settings-workerd.spec.mjs'; // M04 D1 sessions authorize source-shaped Settings CAS inside one SQL mutation.
import './m03-m04-settings-view-workerd.spec.mjs'; // M04 session + settings.view authorized safe shell reads; actual isolated D1.
import './m04-reports-bootstrap-workerd.spec.mjs'; // M04 session + reports.view one-statement bootstrap, local D1 only.
import './m04-atomic-authority-workerd.spec.mjs'; // M04 synthetic same-statement session/RBAC authority; local D1 only.
import './m04-session-workerd.spec.mjs'; // M04 test-only source-shaped session authority via real local D1.
import './m03-transaction-contract-workerd.spec.mjs'; // Separate synthetic atomic/idempotency D1 contract; local-only.
import './m03-intent-fingerprint-workerd.spec.mjs'; // Canonical SHA-256 intent and synthetic D1 replay proof.
import './m03-receipt-workerd.spec.mjs'; // Read-only immutable receipt reconciliation against synthetic local D1.
import './m03-reversal-workerd.spec.mjs'; // Source-guarded exactly-once synthetic reversal in local D1.
import './m03-authorized-receipt-workerd.spec.mjs'; // Session-derived actor and tenant-scoped receipt readback.
import './m03-m04-receipt-workerd.spec.mjs'; // Actual proposed M04 session schema + single-business immutable receipt readback.
import './m03-authorized-post-workerd.spec.mjs'; // Synthetic M04 authority checked inside atomic D1 receipt/post claim.
import './m03-catalog-append-workerd.spec.mjs'; // Existing isolated catalog writer suite.
import './m02-product-unit-import-workerd.spec.mjs'; // M02 frozen Product Units source import / real D1 rollback, local-only.
import './m02-product-category-import-workerd.spec.mjs'; // M02 frozen Product Categories source import / real D1 rollback, local-only.
import './m03-catalog-update-workerd.spec.mjs'; // M03 guarded update with separate local D1 fixture.
import './m03-product-status-workerd.spec.mjs'; // M03 frozen ProductSettings status orchestration, fixed local D1 only.
import './m03-master-atomic-workerd.spec.mjs'; // M03 source PCAT/PUNT, one-statement local D1 creation receipt/cleanup proof.
import './m03-m04-authorized-master-workerd.spec.mjs'; // Current M04 products.add session in the same atomic local D1 master INSERT.
import './m03-catalog-tail-delete-workerd.spec.mjs'; // Tail-only guarded deletes, isolated D1.
import './m03-exactly-one-workerd.spec.mjs'; // Internal atomic write guard on synthetic local D1.
import './m03-id-issuer-workerd.spec.mjs'; // M03 source IDs: isolated D1 receipt+counter trigger, replay and concurrency.
import './m03-id-post-workerd.spec.mjs'; // M03 source INV ID + synthetic stock/journal in same D1 trigger transaction.
import './m05-purchase-posting-workerd.spec.mjs'; // M05 test-only atomic supplier purchase posting; local D1 only.
import './m06-sale-posting-workerd.spec.mjs'; // M06 isolated synthetic sale/tender/Customer due atomic D1 proof.
import './m07-cash-return-workerd.spec.mjs'; // M07 single-invoice Cash return exact-once/rollback proof on M06 source.
import './m07-cash-delete-workerd.spec.mjs'; // M07 test-only original Cash Return deletion, exact-once stock/Cash undo with audit.
import './m07-store-credit-workerd.spec.mjs'; // M07 signed Customer credit with no Cash/Bank and cross-method replay guard.
import './m07-credit-delete-workerd.spec.mjs'; // M07 test-only source-bound signed Customer Store Credit reversal and audit.
import './m07-cash-batch-workerd.spec.mjs'; // M07 2–20 original-invoice Cash batch all-or-nothing local D1.
import './m07-store-credit-batch-workerd.spec.mjs'; // M07 ordered signed Store Credit batch exact-once/rollback local D1.
import './m07-purchase-cash-return-workerd.spec.mjs'; // M07 source-linked purchase Cash refund original-lot local D1 proof.
import './m07-purchase-cash-delete-workerd.spec.mjs'; // M07 source-specific Purchase Cash Return reversal, local D1 only.
import './m07-purchase-supplier-credit-workerd.spec.mjs'; // M07 signed Supplier Credit original-lot D1 ledger/reversal proof.
import './m07-purchase-credit-delete-workerd.spec.mjs'; // M07 Supplier Credit Purchase Return source-bound deletion, local D1 only.
import './m07-return-edit-read-workerd.spec.mjs'; // M07 source-shaped getReturnForEdit read-only, local D1.
import './m07-cash-price-edit-workerd.spec.mjs'; // M07 price-only Cash Return correction / local D1 audit, no RPC.
import './m07-credit-price-edit-workerd.spec.mjs'; // M07 signed Store Credit price-only correction, local D1 only.
import './m07-quantity-preflight-workerd.spec.mjs'; // M07 Cash / Store Credit quantity-readiness local D1, no mutation.
import './m07-purchase-multilot-cash-workerd.spec.mjs'; // M07-B4A isolated multi-lot Cash receipt real Workerd/D1 atomic proof.
import './m08-reconciliation-atomic-workerd.spec.mjs'; // M08 single closing-entry atomicity, local D1 only; no public writer.
import './m03-delete-log-audit-read-workerd.spec.mjs'; // M03 private frozen DELETE_LOG M02 import-to-read Workerd/D1 parity.
import './m03-workerd-core.spec.mjs'; // Ten original root tests, same local-D1 fixture.
import './m03-oversold-atomic-workerd.spec.mjs'; // Test-only tenant-authorized oversold lot settlement SQL; local D1 only.
