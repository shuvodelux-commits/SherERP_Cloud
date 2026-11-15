#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const REQUIRED_IDS = [
  'app', 'sidebar', 'content', 'subNav', 'refreshBtn',
  'printHost', 'floatingHScroll', 'floatingHScrollInner'
];

/**
 * Static M01 regression gates for the generated, RPC-patched HTML.
 * This is not a replacement for Playwright interaction or print visual tests.
 */
export function inspectUiContracts(html) {
  const errors = [];
  if (typeof html !== 'string') return ['Compiled HTML must be a string'];

  // JS templates often contain e.g. '<div id="printHost">' but aren't live DOM.
  const markup = html.replace(
    /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ''
  );
  const ids = new Map();
  for (const match of markup.matchAll(/<[a-z][\w:-]*\b[^>]*?\bid\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/gi)) {
    const id = match[1] ?? match[2];
    ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  for (const id of REQUIRED_IDS) {
    const count = ids.get(id) ?? 0;
    if (!count) errors.push(id + ' missing from live shell markup');
    else if (count !== 1) errors.push(id + ' duplicate live shell ID (' + count + ')');
  }

  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)]
    .map((match) => match[1]).join('\n');
  if (!/@media\s*\(\s*max-width\s*:\s*860px\s*\)/i.test(css)) {
    errors.push('860px mobile breakpoint missing');
  }
  if (!/@media\s+print\b/i.test(css) ||
      !/body\.printing-invoice\s+#printHost\s*\{[^}]*display\s*:\s*block\s*!important/i.test(css)) {
    errors.push('invoice print host visibility missing');
  }
  if (!/body\.printing-invoice\s+\.inv-table\s+thead\s*\{[^}]*display\s*:\s*table-header-group/i.test(css)) {
    errors.push('repeating invoice table header missing');
  }
  if (!/body\.printing-invoice\s+\.inv-table\s+tr\s*\{[^}]*break-inside\s*:\s*avoid/i.test(css)) {
    errors.push('invoice table row split prevention missing');
  }

  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map((match) => match[1]).join('\n');
  for (const id of ['floatingHScroll', 'floatingHScrollInner']) {
    const reference = new RegExp("getElementById\\(\\s*['\\\"]" + id + "['\\\"]\\s*\\)");
    if (!reference.test(scripts)) errors.push('floating scrollbar controller missing ' + id);
  }
  if (!/getElementById\(\s*['"]printHost['"]\s*\)/.test(scripts)) {
    errors.push('invoice print controller missing printHost');
  }

  const start = html.indexOf('  function serverCall(fnName) {');
  const end = html.indexOf('  // ---------------- 6. Shared across every page ----------------', start);
  const wrapper = start < 0 || end < 0 ? '' : html.slice(start, end);
  if (!/fetch\(['"]\/api\/rpc['"]/.test(wrapper) ||
      !/credentials\s*:\s*['"]same-origin['"]/.test(wrapper) ||
      /google\.script\.run|runner\[fnName\]/.test(wrapper)) {
    errors.push('same-origin RPC fetch transport missing or legacy GAS wrapper present');
  }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const html = await readFile(process.argv[2] || 'dist/index.html', 'utf8');
    const errors = inspectUiContracts(html);
    if (errors.length) {
      console.error('M01 UI contract failed:\n' + errors.map((error) => '- ' + error).join('\n'));
      process.exitCode = 1;
    } else {
      console.log('M01 UI contract OK: shell IDs, mobile, print, scroll and RPC');
    }
  } catch (error) {
    console.error('M01 UI contract failed: ' + error.message);
    process.exitCode = 1;
  }
}