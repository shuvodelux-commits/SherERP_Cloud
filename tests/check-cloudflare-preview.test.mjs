import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCloudflarePreviewConfig } from '../scripts/check-cloudflare-preview.mjs';

const base = () => ({
  name: 'hisabiq',
  main: 'src/index.js',
  compatibility_date: '2026-11-14',
  workers_dev: true,
  previews: {},
  assets: {
    directory: './dist',
    binding: 'ASSETS',
    run_worker_first: ['/api/*'],
    not_found_handling: 'single-page-application'
  }
});

test('allows only the isolated, asset-only preview Worker', () => {
  assert.equal(validateCloudflarePreviewConfig(base()), true);
});

test('rejects the production Worker name and non-workers.dev routing', () => {
  assert.throws(() => validateCloudflarePreviewConfig({...base(), name:'shererp-cloud'}), /preview|name/i);
  assert.throws(() => validateCloudflarePreviewConfig({...base(), name:'shererp-cloud-preview'}), /preview|name/i);
  assert.throws(() => validateCloudflarePreviewConfig({...base(), routes:['example.com/*']}), /unexpected|route/i);
  assert.throws(() => validateCloudflarePreviewConfig({...base(), workers_dev:false}), /workers_dev/i);
});

test('rejects D1 bindings and any unexpected platform capability', () => {
  assert.throws(() => validateCloudflarePreviewConfig({...base(), d1_databases:[{binding:'DB',database_id:'live'}]}), /unexpected|database|D1/i);
  assert.throws(() => validateCloudflarePreviewConfig({...base(), vars:{SECRET:'some-value'}}), /unexpected|vars/i);
  assert.throws(() => validateCloudflarePreviewConfig({...base(), unsafe:{bindings:[]}}), /unexpected|unsafe/i);
});

test('requires API-first routing and the original output path', () => {
  const x=base();x.assets.run_worker_first=[];
  assert.throws(() => validateCloudflarePreviewConfig(x), /api|run_worker_first/i);
  const y=base();y.assets.directory='./public';
  assert.throws(() => validateCloudflarePreviewConfig(y), /dist|assets/i);
  const z=base();z.assets.binding='OTHER';
  assert.throws(() => validateCloudflarePreviewConfig(z), /ASSETS|binding/i);
});

test('fails closed for malformed input or unexpected asset settings', () => {
  assert.throws(() => validateCloudflarePreviewConfig(null), /config/i);
  const x=base();x.assets.run_worker_first=['/api/*','!/api/rpc'];
  assert.throws(() => validateCloudflarePreviewConfig(x), /api|run_worker_first/i);
  const y=base();y.assets.upload='everything';
  assert.throws(() => validateCloudflarePreviewConfig(y), /unexpected/i);
});

test('Worker Previews must explicitly declare no D1 or other bindings', () => {
  assert.equal(validateCloudflarePreviewConfig(base()), true);
  const noPreviews = base(); delete noPreviews.previews;
  assert.throws(() => validateCloudflarePreviewConfig(noPreviews), /previews/i);
  assert.throws(() => validateCloudflarePreviewConfig({...base(),previews:{d1_databases:[{binding:'DB'}]}}), /previews/i);
  assert.throws(() => validateCloudflarePreviewConfig({...base(),previews:{vars:{SECRET:'x'}}}), /previews/i);
});
