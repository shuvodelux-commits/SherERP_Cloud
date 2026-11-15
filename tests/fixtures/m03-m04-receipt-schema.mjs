/**
 * Future immutable operation receipt schema, TEST-ONLY.
 * Complements the exact M04 auth migration fixture, never deployed.
 */
export const M04_RECEIPT_DDL=Object.freeze([
  `CREATE TABLE operation_receipts (
    tenant_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
    result_ref TEXT NOT NULL CHECK(length(trim(result_ref))>0),
    committed_at TEXT NOT NULL CHECK(length(trim(committed_at))>0),
    PRIMARY KEY(tenant_id,operation_id)
  ) STRICT`,
  `CREATE TRIGGER m04_receipt_no_update
    BEFORE UPDATE ON operation_receipts
    BEGIN SELECT RAISE(ABORT,'M04 receipt immutable'); END`,
  `CREATE TRIGGER m04_receipt_no_delete
    BEFORE DELETE ON operation_receipts
    BEGIN SELECT RAISE(ABORT,'M04 receipt immutable'); END`
]);

export const M04_RECEIPT_CLOCK=1_800_000_000_000;
export const M04_RECEIPT_TOKEN_A='a'.repeat(64);
export const M04_RECEIPT_TOKEN_B='b'.repeat(64);
export const M04_RECEIPT_TOKEN_C='c'.repeat(64);
export const M04_RECEIPT_PAYLOAD=Object.freeze({
  items:Object.freeze([Object.freeze({sku:'PIPE',units:'1.000'})]),
  total:'120.00'
});
export const M04_RECEIPT_INTENT=Object.freeze({
  token:M04_RECEIPT_TOKEN_A,
  nowMs:M04_RECEIPT_CLOCK,
  operationId:'OP-1',
  operationType:'sales.post',
  payload:M04_RECEIPT_PAYLOAD
});
