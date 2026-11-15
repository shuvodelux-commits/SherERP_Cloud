import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

/**
 * Regression for Issue #92. The pinned Apps Script invoice oracle must use
 * the shop's script timezone for due-date output, not the host's UTC
 * rendering of a local-midnight Date. Execute all 14 oracle tests in
 * independent child processes; inherited Node test-runner context can make
 * nested --test invocations falsely report success without running tests.
 */
test('posted-invoice source due-date parity survives UTC and Asia/Dhaka hosts',()=>{
  for (const tz of ['UTC','Asia/Dhaka']) {
    const env={...process.env,TZ:tz};
    delete env.NODE_TEST_CONTEXT;
    const run=spawnSync(process.execPath,[
      'tests/m06-posted-invoice-read-model.test.mjs'
    ],{encoding:'utf8',env,timeout:30000});

    assert.equal(run.error,undefined,'Could not execute invoice suite in '+tz);
    assert.match(run.stdout,/\b1\.\.14\b/,
      'Nested invoice tests were not executed under TZ='+tz+'\n'+run.stdout);
    assert.equal(run.status,0,
      'Posted-invoice source-parity failed under TZ='+tz+'\n'+
      run.stdout+'\n'+run.stderr);
    assert.match(run.stdout,/# pass 14\b/);
  }
});
