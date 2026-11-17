import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalD1SchemaReport} from '../scripts/local-d1-schema-check.mjs';

const expected={
  app_tables:20,applied_migrations:14,history_triggers:4,delete_audit_guards:2,draft_audit_guards:2,invoice_edit_audit_guards:2,opening_balance_audit_guards:2,stock_lot_cost_audit_guards:2,product_snapshot_guards:4,product_catalog_guards:9,tile_measurement_guards:3,auth_tables:5,
  auth_session_guards:3,provenance_columns:4,provenance_guards:2,
};
const envelope=row=>[{results:[row],success:true}];

test('local D1 schema evidence requires 14 migrations, historical columns and immutable guards',()=>{
  assert.equal(validateLocalD1SchemaReport(envelope(expected)),true);
  assert.equal(validateLocalD1SchemaReport(envelope(expected)[0]),true);
});

test('local D1 schema verifier denies any omitted schema table, migration, trigger, or provenance guard',()=>{
  for(const [field,missing] of [
    ['app_tables',6],['applied_migrations',3],['history_triggers',3],['delete_audit_guards',1],['draft_audit_guards',1],['invoice_edit_audit_guards',1],['opening_balance_audit_guards',1],['stock_lot_cost_audit_guards',1],['product_snapshot_guards',3],['product_catalog_guards',8],['tile_measurement_guards',2],
    ['auth_tables',4],['auth_session_guards',2],
    ['provenance_columns',3],['provenance_guards',1],
  ]) assert.throws(()=>validateLocalD1SchemaReport(envelope({...expected,[field]:missing})),field);
  for(const malformed of [{},null,[],{results:[]},[{success:false,results:[expected]}]])
    assert.throws(()=>validateLocalD1SchemaReport(malformed));
});
