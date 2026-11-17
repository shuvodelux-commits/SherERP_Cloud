/**
 * M03 issue #621: disposable tenant-provenance overlay for isolated Workerd D1.
 * None of these tables are production migrations or approved source imports.
 * Migration 0013 is globally keyed, and current M04 sessions have no tenant.
 */
export const SYNTHETIC_M03_PRODUCTS_BOOTSTRAP_DDL=Object.freeze([
 "CREATE TABLE synthetic_m03_session_tenants("+
  "token_hash TEXT PRIMARY KEY NOT NULL REFERENCES auth_sessions(token_hash),"+
  "tenant_id TEXT NOT NULL) STRICT",
 "CREATE TABLE synthetic_m03_product_tenants("+
  "tenant_id TEXT NOT NULL,product_id TEXT NOT NULL UNIQUE REFERENCES products(product_id),"+
  "PRIMARY KEY(tenant_id,product_id)) STRICT",
 "CREATE TABLE synthetic_m03_unit_tenants("+
  "tenant_id TEXT NOT NULL,unit_id TEXT NOT NULL UNIQUE REFERENCES product_units(unit_id),"+
  "PRIMARY KEY(tenant_id,unit_id)) STRICT",
 "CREATE TABLE synthetic_m03_category_tenants("+
  "tenant_id TEXT NOT NULL,category_id TEXT NOT NULL UNIQUE REFERENCES product_categories(category_id),"+
  "PRIMARY KEY(tenant_id,category_id)) STRICT",
 "CREATE TABLE synthetic_m03_product_stock("+
  "tenant_id TEXT NOT NULL,product_id TEXT NOT NULL,physical_qty_text TEXT NOT NULL,"+
  "is_tile INTEGER NOT NULL DEFAULT 0 CHECK(is_tile IN(0,1)),"+
  "PRIMARY KEY(tenant_id,product_id),"+
  "FOREIGN KEY(tenant_id,product_id) REFERENCES synthetic_m03_product_tenants(tenant_id,product_id)) STRICT",
 "CREATE TABLE synthetic_m03_stock_lots("+
  "tenant_id TEXT NOT NULL,lot_id TEXT NOT NULL,product_id TEXT NOT NULL,"+
  "remaining_qty_text TEXT NOT NULL,purchase_price_text TEXT NOT NULL,purchase_id TEXT NOT NULL,"+
  "PRIMARY KEY(tenant_id,lot_id),"+
  "FOREIGN KEY(tenant_id,product_id) REFERENCES synthetic_m03_product_tenants(tenant_id,product_id)) STRICT",
 "CREATE TABLE synthetic_m03_bundle_components("+
  "tenant_id TEXT NOT NULL,bundle_id TEXT NOT NULL,component_id TEXT NOT NULL,"+
  "qty_per_set_text TEXT NOT NULL,unit_name TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,"+
  "PRIMARY KEY(tenant_id,bundle_id,component_id,revision),"+
  "FOREIGN KEY(tenant_id,bundle_id) REFERENCES synthetic_m03_product_tenants(tenant_id,product_id),"+
  "FOREIGN KEY(tenant_id,component_id) REFERENCES synthetic_m03_product_tenants(tenant_id,product_id)) STRICT",
 "CREATE TABLE synthetic_m03_tile_current("+
  "tenant_id TEXT NOT NULL,product_id TEXT NOT NULL,unit_revision INTEGER NOT NULL,"+
  "current_measurement_revision INTEGER NOT NULL,measurement_json TEXT NOT NULL,"+
  "measurement_sha256 TEXT NOT NULL CHECK(length(measurement_sha256)=64),"+
  "PRIMARY KEY(tenant_id,product_id),"+
  "FOREIGN KEY(tenant_id,product_id) REFERENCES synthetic_m03_product_tenants(tenant_id,product_id)) STRICT",
 "CREATE TABLE synthetic_m03_tenant_settings("+
  "tenant_id TEXT PRIMARY KEY NOT NULL,currency_symbol TEXT NOT NULL,"+
  "low_stock_threshold_text TEXT NOT NULL) STRICT"
]);
