import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalD1SchemaReport} from '../scripts/local-d1-schema-check.mjs';

const good=[{results:[{app_tables:7,applied_migrations:3,history_triggers:4,auth_tables:5,auth_session_guards:3}],success:true}];
test('D1 migration evidence requires seven core + five auth tables, three migrations and audit/session triggers',()=>{
  assert.equal(validateLocalD1SchemaReport(good),true);
  assert.equal(validateLocalD1SchemaReport(good[0]),true);
});
test('D1 migration verifier fails on missing schema, migration, trigger or errors',()=>{
  for(const bad of [
    [{results:[{app_tables:6,applied_migrations:2,history_triggers:4}],success:true}],
    [{results:[{app_tables:7,applied_migrations:2,history_triggers:4,auth_tables:5,auth_session_guards:3}],success:true}],
    [{results:[{app_tables:7,applied_migrations:3,history_triggers:3,auth_tables:5,auth_session_guards:3}],success:true}],
    [{results:[{app_tables:7,applied_migrations:2,history_triggers:4}],success:false}],
    {},null,[],{results:[]}
    [{results:[{app_tables:7,applied_migrations:3,history_triggers:4,auth_tables:4,auth_session_guards:3}],success:true}],
    [{results:[{app_tables:7,applied_migrations:3,history_triggers:4,auth_tables:5,auth_session_guards:2}],success:true}],
  ]) assert.throws(()=>validateLocalD1SchemaReport(bad));
});
