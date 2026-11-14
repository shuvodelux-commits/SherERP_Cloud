import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const cli = new URL('../scripts/audit-source.mjs', import.meta.url).pathname;
const execute = (dir) => JSON.parse(execFileSync(process.execPath, [cli, dir], {encoding:'utf8'}));

test('audits only root-level .gs/.html in deterministic order', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'm00-audit-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  await mkdir(join(dir,'tests'));
  await writeFile(join(dir,'tests','ignored.gs'), 'SpreadsheetApp.getActiveSpreadsheet()');
  await writeFile(join(dir,'Z.gs'), "function sale() {\n  const s = SpreadsheetApp.getActiveSpreadsheet();\n  const rows = getAllRows_('PRODUCTS');\n}\n");
  await writeFile(join(dir,'A.gs'), "function getThing() {\n  return findRow_('PRODUCTS', 'Product ID', 'P1');\n}\n");
  await writeFile(join(dir,'index.html'), "<?!= include('style'); ?>\n<script>serverCall('sale', authToken)</script>\n");
  await writeFile(join(dir,'style.html'), '<style></style>\n');
  const report=execute(dir);
  assert.deepEqual(report.totals, {backendFiles:2, frontendFiles:2, files:4});
  assert.deepEqual(report.files.map(f=>f.path), ['A.gs','Z.gs','index.html','style.html']);
  assert.deepEqual(report.rpcNames, ['sale']);
  assert.deepEqual(report.includeNames, ['style']);
  assert.deepEqual(report.googleServices, [{name:'SpreadsheetApp', calls:1, files:['Z.gs']}]);
  assert.deepEqual(report.dbHelpers, [{name:'findRow_', calls:1, files:['A.gs']}, {name:'getAllRows_',calls:1,files:['Z.gs']}]);
});

test('missing source directory fails with a clear error', () => {
  assert.throws(() => execute('/does-not-exist-mohim-erp'), /ENOENT/);
});
