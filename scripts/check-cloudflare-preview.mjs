#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A deployment guard for the deliberately inert, DB-free preview Worker. */
export function validateCloudflarePreviewConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid preview config');
  }
  const allowed = new Set(['name','main','compatibility_date','workers_dev','assets']);
  for (const key of Object.keys(config)) {
    if (!allowed.has(key)) throw new Error('Unexpected preview config field: '+key);
  }
  if (config.name !== 'shererp-cloud-preview') throw new Error('Expected isolated preview Worker name');
  if (config.main !== 'src/index.js') throw new Error('Unexpected Worker entry point');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date || '')) {
    throw new Error('Invalid compatibility date');
  }
  if (config.workers_dev !== true) throw new Error('Preview workers_dev must be true');
  const assets = config.assets;
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) {
    throw new Error('Missing preview assets config');
  }
  const assetKeys = new Set(['directory','binding','run_worker_first','not_found_handling']);
  for (const key of Object.keys(assets)) {
    if (!assetKeys.has(key)) throw new Error('Unexpected preview assets field: '+key);
  }
  if (assets.directory !== './dist' || assets.binding !== 'ASSETS' ||
      assets.not_found_handling !== 'single-page-application') {
    throw new Error('Preview must serve ./dist through ASSETS and SPA fallback');
  }
  if (!Array.isArray(assets.run_worker_first) ||
      assets.run_worker_first.length !== 1 || assets.run_worker_first[0] !== '/api/*') {
    throw new Error('Preview run_worker_first must be exactly /api/*');
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = process.argv[2] || 'wrangler.preview.jsonc';
    const config = JSON.parse(readFileSync(resolve(path), 'utf8'));
    validateCloudflarePreviewConfig(config);
    console.log('Preview configuration OK: isolated Worker, static assets, no D1 binding');
  } catch (err) {
    console.error('Cloudflare preview safety check failed: '+err.message);
    process.exitCode = 1;
  }
}
