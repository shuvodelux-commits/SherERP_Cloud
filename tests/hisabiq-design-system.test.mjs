import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tokenJson = read('../docs/design-system/hisabiq-tokens.json');
const tokens = JSON.parse(tokenJson);
const css = read('../src/ui/hisabiq/hisabiq-design-system.css');
const guide = read('../docs/design-system/HISABIQ_SHERERP.md');

test('the approved HisabIQ source SHA is pinned across design-system artifacts', () => {
  const sha = 'e42a00a9f48ffc1f5c4ec10083e36d9eb4686484';
  assert.equal(tokens.source.commit, sha);
  assert.ok(guide.includes(sha));
  assert.match(css, /source: hisabiq_ui@e42a00a9f48ffc1f5c4ec10083e36d9eb4686484/);
  assert.equal(tokens.adoption.runtimeImported, false);
});

test('themes retain source light/dark primary, surface and foreground contrast pairs', () => {
  assert.equal(tokens.colors.light.primary, '#0D7C74');
  assert.equal(tokens.colors.light.primaryForeground, '#FFFFFF');
  assert.equal(tokens.colors.light.background, '#F5F7FA');
  assert.equal(tokens.colors.dark.primary, '#3DB8AC');
  assert.equal(tokens.colors.dark.primaryForeground, '#0B1A2C');
  assert.equal(tokens.colors.dark.background, '#0B1A2C');
  for (const mode of ['light', 'dark']) {
    for (const [key, hex] of Object.entries(tokens.colors[mode])) {
      assert.match(hex, /^#[\da-f]{6}$/i, `${mode}.${key}`);
      assert.ok(css.includes(`--hds-${key.replace(/[A-Z]/g, (c) => '-'+c.toLowerCase())}: ${hex.toLowerCase()}`), `scoped CSS missing ${mode}.${key} ${hex}`);
    }
  }
});

test('global component geometry and proportional typography cannot silently drift', () => {
  assert.equal(tokens.geometry.controlHeightPx, 36);
  assert.equal(tokens.geometry.transactionCompletionHeightPx, 48);
  assert.equal(tokens.geometry.iconButtonWidthPx, 36);
  assert.equal(tokens.geometry.controlRadiusRem, 0.375);
  assert.equal(tokens.geometry.cardRadiusPx, 12);
  assert.equal(tokens.typography.sizesPx.tableData, 13);
  assert.equal(tokens.typography.sizesPx.tableHeading, 12);
  assert.equal(tokens.typography.sizesPx.tableHelper, 11);
  assert.equal(tokens.typography.sizesPx.inputValue, 13);
  assert.equal(tokens.typography.noMonospaceNumbers, true);
  assert.equal(tokens.typography.noTabularNumbers, true);
  assert.match(css, /--hds-control-height:\s*36px/);
  assert.match(css, /--hds-completion-height:\s*48px/);
  assert.match(css, /font-variant-numeric:\s*proportional-nums/);
  assert.doesNotMatch(css, /font-family:[^;]*(?:monospace|Geist Mono)/i);
});

test('motion remains sourced, bounded, and instantly disabled for reduced motion', () => {
  const motion = tokens.motion;
  assert.equal(motion.tabUnderlineMs, 200);
  assert.equal(motion.tabUnderlineHeightPx, 2);
  assert.equal(motion.navHoverMs, 110);
  assert.equal(motion.navActiveMs, 190);
  assert.equal(motion.sidebarToggleMs, 220);
  assert.equal(motion.dialogEntryMs, 180); // Live Dialog.tsx, not older guide's 220ms.
  assert.equal(motion.menuEntryMs, 140);
  assert.equal(motion.partySheetMs, 280);
  assert.deepEqual(motion.segmentedSpring, {stiffness:520,damping:38,mass:0.7});
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /--hds-dialog-entry:\s*180ms/);
  assert.match(css, /--hds-popup-entry:\s*140ms/);
  assert.match(css, /--hds-sheet-entry:\s*280ms/);
  assert.match(css, /--hds-tab-entry:\s*200ms/);
});

test('new source CSS remains strictly opt-in and does not override legacy Owner HTML', () => {
  assert.equal(tokens.adoption.cssSelector, '[data-hisabiq-design-system]');
  assert.match(css, /\[data-hisabiq-design-system\]/);
  assert.doesNotMatch(css, /(^|\n)\s*:root\b/m);
  assert.doesNotMatch(css, /(^|\n)\s*html(?:\s|,|\{)/m);
  assert.doesNotMatch(css, /(^|\n)\s*body(?:\s|,|\{)/m);
  assert.doesNotMatch(css, /(^|\n)\s*button\s*\{/m);
  assert.doesNotMatch(css, /(^|\n)\s*table\s*\{/m);
  assert.match(guide, /No runtime imports have been added/);
});
