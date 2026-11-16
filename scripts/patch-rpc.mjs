#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/** Patch original RPC and login/shell fail-closed safeguards in generated HTML; frozen source stays byte-identical. */
export function patchServerCall(html) {
  const startMarker = '  function serverCall(fnName) {';
  const endMarker = '  // ---------------- 6. Shared across every page ----------------';
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error('Original serverCall wrapper not found');
  if (html.indexOf(startMarker, start + 1) !== -1) throw new Error('Multiple/duplicate original serverCall wrappers');
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error('Original serverCall wrapper boundary not found');
  const original = html.slice(start, end);
  if (!original.includes('google.script.run') || !original.includes('runner[fnName].apply')) {
    throw new Error('Original serverCall wrapper changed; refusing unchecked transport replacement');
  }
  const replacement = `  function serverCall(fnName) {
    var args = Array.prototype.slice.call(arguments, 1);
    return Promise.resolve().then(function () {
      return fetch('/api/rpc', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({fnName: fnName, args: args})
      });
    }).then(function (response) {
      return response.json().catch(function () {
        throw new Error('Server error');
      }).then(function (res) {
        // A declared RPC success field must be Boolean, never a truthy string.
        // Raw legacy responses with no success field retain source semantics.
        if (res && Object.prototype.hasOwnProperty.call(res, 'success') &&
            typeof res.success !== 'boolean') {
          throw new Error('Server error');
        }
        if (!response.ok || !res || res.success === false) {
          throw new Error(res && res.message || 'Server error');
        }
        return res.data !== undefined ? res.data : res;
      });
    });
  }

`;
  // The original Enter-key handler calls doLogin_ even while its button is
  // disabled by setLoginPending_. Make the compiled UI single-flight without
  // modifying frozen javascript.html or its existing pending/retry lifecycle.
  const compiled=html.slice(0, start) + replacement + html.slice(end);
  const loginName='  function doLogin_() {';
  if (!compiled.includes(loginName)) return compiled; // Small RPC-only test fixtures.
  if (compiled.indexOf(loginName,compiled.indexOf(loginName)+1)!==-1) {
    throw new Error('Multiple original login handlers');
  }
  const loginMarker=loginName+"\n"+
    "    var errEl = document.getElementById('loginError');\n"+
    "    var btn = document.getElementById('loginSubmitBtn');\n";
  if (!compiled.includes(loginMarker)) {
    throw new Error('Original login handler changed; refusing unchecked guard');
  }
  const withLoginGuard=compiled.replace(loginMarker,loginMarker+
    '    if (btn && btn.disabled) return;\n');

  // When source getAppShellData fails after login, the original handler
  // displays a toast but leaves the protected shell uncovered. Re-lock only
  // the compiled UI, preserving the bearer for a later valid session retry.
  const shellName='  function loadAppShell_() {';
  if (!withLoginGuard.includes(shellName)) return withLoginGuard;
  if (withLoginGuard.indexOf(shellName,withLoginGuard.indexOf(shellName)+1)!==-1) {
    throw new Error('Multiple original application shell handlers');
  }
  const shellCatch="      .catch(function (err) {\n"+
    "        showToast(err.message || 'Could not load app settings.', 'error');\n"+
    "      });";
  if (!withLoginGuard.includes(shellCatch) ||
      withLoginGuard.indexOf(shellCatch,withLoginGuard.indexOf(shellCatch)+1)!==-1) {
    throw new Error('Original application shell failure boundary changed');
  }
  return withLoginGuard.replace(shellCatch,
    shellCatch.replace("        showToast(", "        showLogin_();\n        showToast("));
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const file = process.argv[2] || 'dist/index.html';
  try {
    const html = await readFile(file, 'utf8');
    await writeFile(file, patchServerCall(html), 'utf8');
    console.log('M01 RPC transport patched in ' + file);
  } catch (error) {
    console.error('M01 RPC patch failed: ' + error.message);
    process.exitCode = 1;
  }
}
