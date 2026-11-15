import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

/**
 * Regression for Issue #92. The pinned Apps Script invoice oracle must use
 * the shop's script timezone for its due-date output, not the host's UTC
 * rendering of a local-midnight Date. Run source-vs-target assertions under
 * both timezones to guard the original calendar-date semantics.
 */
test('posted-invoice source due-date parity survives UTC and Asia/Dhaka hosts',()=>{
  for (const tz of ['UTC','Asia/Dhaka']) {
    const run=spawnSync(process.execPath,[
      '--test','tests/m06-posted-invoice-read-model.test.mjs'
    ],{
      encoding:'utf8',
      env:{...process.env,TZ:tz},
      timeout:30000
    });
    assert.equal(run.error,undefined,'Could not execute invoice parity suite in '+tz);
    assert.equal(run.status,0,
      'Posted-invoice source-parity failed under TZ='+tz+'\n'+
      run.stdout+'\n'+run.stderr);
  }
});
