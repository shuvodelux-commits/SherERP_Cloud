// Compare reviewed application schema separately from the local receipt
// table and its bookkeeping. The result is private schema metadata.
export const PORT_P2_SHOP_SCHEMA = `(
  SELECT json_group_array(json_array(type,name,tbl_name,sql)) FROM (
    SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT GLOB 'sqlite_*' AND tbl_name<>'port_p2_shop_migrations'
    ORDER BY type,name
  )
)`;

export async function readPortP2ShopCheckpoint(db) {
  const [ledger, schema] = await db.batch([
    db.prepare('SELECT position,name,checksum,schema_snapshot AS schema FROM port_p2_shop_migrations ORDER BY position'),
    db.prepare(`SELECT ${PORT_P2_SHOP_SCHEMA} AS schema`)
  ]);
  if (!ledger.success || !schema.success) throw new Error('Shop schema evidence unavailable');
  return { receipts: ledger.results, schema: schema.results[0].schema };
}

export function matchesPortP2MigrationPrefix(receipts, plan) {
  return Array.isArray(plan) && receipts.length <= plan.length && receipts.every((row, index) =>
    row.position === index + 1 && row.name === plan[index]?.name && row.checksum === plan[index].checksum
  );
}
