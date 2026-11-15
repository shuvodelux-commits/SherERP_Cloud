import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {serveCompiledUi} from '../qa/serve-compiled-ui.mjs';

const json = (fnName, args = []) => JSON.stringify({fnName, args});
const cases = [
  {name: 'health GET', path: '/api/health', method: 'GET'},
  {name: 'health refuses POST', path: '/api/health', method: 'POST'},
  {name: 'RPC refuses GET', path: '/api/rpc', method: 'GET'},
  {name: 'RPC requires JSON', path: '/api/rpc', method: 'POST', headers: {'Content-Type': 'text/plain'}, body: json('login', ['01700000000', 'invalid-fixture'])},
  {name: 'RPC refuses malformed JSON', path: '/api/rpc', method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{invalid'},
  {name: 'login fails closed', path: '/api/rpc', method: 'POST', headers: {'Content-Type': 'application/json'}, body: json('login', ['01700000000', 'invalid-fixture'])},
  {name: 'unknown RPC fails closed', path: '/api/rpc', method: 'POST', headers: {'Content-Type': 'application/json'}, body: json('notMigrated', [])},
  {name: 'cross-origin RPC forbidden', path: '/api/rpc', method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://example.invalid'}, body: json('login', ['01700000000', 'invalid-fixture'])},
  {name: 'unrecognized API route', path: '/api/missing', method: 'GET'}
];

test('M01 loopback browser fixture exactly follows the inert public Worker API boundary', async (t) => {
  const fixture = await serveCompiledUi();
  try {
    for (const scenario of cases) {
      await t.test(scenario.name, async () => {
        const url = new URL(scenario.path, fixture.url);
        const init = {method: scenario.method, ...(scenario.headers ? {headers: scenario.headers} : {}), ...(scenario.body ? {body: scenario.body} : {})};
        const expected = await worker.fetch(new Request(url, init), {});
        const actual = await fetch(url, init);
        assert.equal(actual.status, expected.status, scenario.name + ' status');
        for (const name of ['content-type', 'allow', 'cache-control', 'x-content-type-options']) {
          assert.equal(actual.headers.get(name), expected.headers.get(name), scenario.name + ' ' + name);
        }
        assert.deepEqual(await actual.json(), await expected.json(), scenario.name + ' response JSON');
      });
    }
  } finally {
    await fixture.close();
  }
});
