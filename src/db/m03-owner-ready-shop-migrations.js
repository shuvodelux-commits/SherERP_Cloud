// Review-only, local Workerd/D1 Owner-ready shop schema profile.
// Each checksum pins exact pre-reviewed source SQL bytes. No IO, credentials,
// Cloudflare provisioning or schema execution is performed by this module.
export const OWNER_READY_SHOP_MIGRATION_PLAN=Object.freeze([
  ['staging-migrations/shop-identity/0001_shop_identity.sql','d053ae0d59ca85e2b1e0395799ef75e651161b0241792f931a3faabf4a462d2d'],
  ['migrations/0001_core_catalog.sql','e15280ba1bc3db2ced97415bad290bbe39fda9a6bc2735e642f6e1a52388029a'],
  ['migrations/0012_legacy_product_snapshots.sql','4391153e107b9ea2b2b1fcc2084f359ea9c7f957510794ba12e3b27170c603c7'],
  ['migrations/0013_product_catalog_revisions.sql','f57b46ee4f65478b8d3e18141e75c74010b0f2d7b87274675d7ecf4a3d1254b7'],
  ['staging-migrations/shop-owner-write/0002_shop_owner_write_grant.sql','a0a11c67d116579961b6ec26fc51026a30d629fb18a304da2e1f56bada608b76'],
  ['staging-migrations/shop-owner-write/0003_owner_product_create_receipts.sql','9f4b8b4b210c70d20ab8df1576d4decb5aa0274f3a28909062ad8a51804c7c5f']
].map(([name,checksum])=>Object.freeze({name,checksum})));

export function isOwnerReadyShopMigrationPlan(plan){
  return Array.isArray(plan) &&
    plan.length===OWNER_READY_SHOP_MIGRATION_PLAN.length &&
    OWNER_READY_SHOP_MIGRATION_PLAN.every((expected,index)=>
      plan[index]?.name===expected.name&&plan[index]?.checksum===expected.checksum);
}
