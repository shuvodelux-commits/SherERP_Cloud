import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalD1SchemaReport} from '../scripts/local-d1-schema-check.mjs';

const good=[{results:[{app_tables:7,applied_migrations:2,history_triggers:4}],success:true}];
test('D1 migration evidence requires seven app tables, two migrations and audit triggers',()=>{
  assert.equal(validateLocalD1SchemaReport(good),true);
  assert.equal(validateLocalD1SchemaReport(good[0]),true);
});
test('D1 migration verifier fails on missing schema, migration, trigger or errors',()=>{
  for(const bad of [
    [{results:[{app_tables:6,applied_migrations:2,history_triggers:4}],success:true}],
    [{results:[{app_tables:7,applied_migrations:1,history_triggers:4}],success:true}],
    [{results:[{app_tables:7,applied_migrations:2,history_triggers:3}],success:true}],
    [{results:[{app_tables:7,applied_migrations:2,history_triggers:4}],success:false}],
    {},null,[],{results:[]}
  ]) assert.throws(()=>validateLocalD1SchemaReport(bad));
});
