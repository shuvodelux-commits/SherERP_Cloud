#!/usr/bin/env node
/**
 * Static M00 source inventory. Heuristics, not a JavaScript parser or a
 * substitute for authorization, transaction, or runtime tests.
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const services = [
  'CacheService', 'DriveApp', 'HtmlService', 'LockService',
  'PropertiesService', 'ScriptApp', 'Session', 'SpreadsheetApp',
  'UrlFetchApp', 'Utilities',
];
const helpers = [
  'appendRow_', 'appendRows_', 'deleteRow_', 'findRow_', 'findRows_',
  'getAllRows_', 'getRange', 'getSheet_', 'updateRowFields_',
];
const occurrences = (content, pattern) => [...content.matchAll(pattern)];
const namesFrom = (contents, pattern) => [...new Set(contents.flatMap((content) =>
  occurrences(content, pattern).map((m) => m[1])
))].sort();
const escapeRegex = (s) => s.replace(/[.*+?^$()|{}[\]\\]/g, '\\$&');

export async function auditSource(sourceDir) {
  const root = resolve(sourceDir);
  const dirs = await readdir(root, {withFileTypes:true});
  const paths = dirs.filter((d) => d.isFile() && /\.(gs|html)$/.test(d.name))
    .map((d) => d.name).sort();
  const files = await Promise.all(paths.map(async (path) => {
    const code = await readFile(join(root, path), 'utf8');
    return {path, type: path.endsWith('.gs') ? 'backend' : 'frontend', code};
  }));
  const uses = (symbols, mode) => symbols.flatMap((name) => {
    const matcher = new RegExp('\\b' + escapeRegex(name) + '\\b' + (mode === 'call' ? '\\s*\\(' : ''), 'g');
    const used = files.map(({path, code}) => ({path, count:occurrences(code, matcher).length}))
      .filter((item) => item.count);
    return used.length ? [{name, calls:used.reduce((sum, x) => sum + x.count, 0), files:used.map((x) => x.path)}] : [];
  });
  return {
    formatVersion: 1,
    scope: 'root-level .gs and .html; static lexical scan (comments/strings may match)',
    totals: {
      backendFiles: files.filter((f) => f.type === 'backend').length,
      frontendFiles: files.filter((f) => f.type === 'frontend').length,
      files: files.length,
    },
    files: files.map(({path,type})=>({path,type})),
    googleServices: uses(services, 'symbol'),
    dbHelpers: uses(helpers, 'call'),
    rpcNames: namesFrom(files.map((f)=>f.code), /\bserverCall\s*\(\s*['"]([\w]+)['"]/g),
    includeNames: namesFrom(files.map((f)=>f.code), /<\?!=\s*include\s*\(\s*['"]([\w-]+)['"]\s*\)\s*;?\s*\?>/g),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try {
    const report = await auditSource(process.argv[2] || 'legacy/source');
    process.stdout.write(JSON.stringify(report, null, 2)+'\n');
  } catch (error) {
    console.error('M00 source audit failed: ' + error.message);
    process.exitCode = 1;
  }
}
