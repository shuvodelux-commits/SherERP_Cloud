import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildFrontend} from '../scripts/build-frontend.mjs';
import {patchServerCall} from '../scripts/patch-rpc.mjs';
import {inspectUiContracts} from '../scripts/check-m01-ui.mjs';

let builtHtml;
let temporaryDirectory;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'shererp-m01-qa-'));
  const build = await buildFrontend({
    sourceDir: new URL('../legacy/source/', import.meta.url).pathname,
    outputDir: temporaryDirectory
  });
  builtHtml = patchServerCall(await readFile(build.outputPath, 'utf8'));
});

after(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, {recursive: true, force: true});
});

test('compiled original UI retains required shell, mobile and print contracts', () => {
  assert.deepEqual(inspectUiContracts(builtHtml), []);
});

test('rejects missing or duplicated real shell IDs but ignores JavaScript template strings', () => {
  const noScroll = builtHtml.replace('id="floatingHScrollInner"', 'id="scrollInnerRemoved"');
  assert.match(inspectUiContracts(noScroll).join('\n'), /floatingHScrollInner.*missing/);
  const duplicate = builtHtml.replace('</body>', '<div id="printHost"></div></body>');
  assert.match(inspectUiContracts(duplicate).join('\n'), /printHost.*duplicate/);
  const insideScript = builtHtml.replace('</body>', `<script>const markup = '<div id="printHost"></div>';</script></body>`);
  assert.deepEqual(inspectUiContracts(insideScript), []);
});

test('detects lost invoice printing rules and mobile breakpoint', () => {
  const noHeaderRepeat = builtHtml.replace('display: table-header-group;', 'display: table-row-group;');
  assert.match(inspectUiContracts(noHeaderRepeat).join('\n'), /repeating invoice table header/);
  const noMobile = builtHtml.replace('@media (max-width: 860px)', '@media (max-width: 600px)');
  assert.match(inspectUiContracts(noMobile).join('\n'), /860px mobile breakpoint/);
});

test('detects disconnected floating scrollbar and leaked GAS RPC wrapper', () => {
  const noScrollController = builtHtml.replace("getElementById('floatingHScrollInner')", "getElementById('lostScrollInner')");
  assert.match(inspectUiContracts(noScrollController).join('\n'), /floating scrollbar controller/);
  const noFetch = builtHtml.replace("fetch('/api/rpc'", "google.script.run('/api/rpc'");
  assert.match(inspectUiContracts(noFetch).join('\n'), /same-origin RPC fetch/);
});