#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Check Wrangler --local --json output, not a remote D1 status query. */
export function validateLocalD1SchemaReport(output) {
  const obj=Array.isArray(output)?(output.length===1?output[0]:null):output;
  if(!obj || obj.success !== true || !Array.isArray(obj.results) || obj.results.length!==1)
    throw new Error('Unexpected local D1 query result');
  const row=obj.results[0];
  if(row.app_tables!==13 || row.applied_migrations!==10 || row.history_triggers!==4 ||
     row.delete_audit_guards!==2 || row.draft_audit_guards!==2 || row.invoice_edit_audit_guards!==2 || row.opening_balance_audit_guards!==2 ||
     row.auth_tables!==5 || row.auth_session_guards!==3 ||
     row.provenance_columns!==4 || row.provenance_guards!==2)
    throw new Error('Local D1 schema verification failed: table, migration, column or trigger count mismatch');
  return true;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const input=JSON.parse(readFileSync(resolve(process.argv[2]),'utf8'));
    validateLocalD1SchemaReport(input);
    console.log('Local D1 verified: 13 core/diagnostic/audit tables, 5 auth tables, 10 migrations, 4 Party triggers, 3 session guards, 4 source provenance columns and 2 immutable-history guards');
  }catch(e){console.error('Local D1 verification failed: '+e.message);process.exitCode=1;}
}
