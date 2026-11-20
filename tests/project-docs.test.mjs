import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkMarkdownLinks, CORE_DOCS} from '../scripts/check-project-docs.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean));

test('core project handoff links resolve to tracked files',()=>{
  assert.deepEqual(CORE_DOCS,['PROJECT.md','README.md','AGENTS.md']);
  for(const path of CORE_DOCS){
    assert.ok(tracked.has(path),path+' should stay tracked');
    const body=readFileSync(new URL('../'+path,import.meta.url),'utf8');
    assert.deepEqual(checkMarkdownLinks(path,body,tracked),[],path+' has broken relative links');
  }
});

test('relative Markdown links resolve from their own directory, ignoring external links and anchors',()=>{
  const body=[
    '[project](../PROJECT.md)',
    '[local](local.md#heading)',
    '[external](https://github.com/example/repo)',
    '[anchor](#overview)',
    '[mail](mailto:owner@example.test)',
    '![figure](../missing.png)',
  ].join('\n');
  assert.deepEqual(checkMarkdownLinks('docs/start.md',body,new Set(['PROJECT.md','docs/local.md'])),
    ['docs/start.md: missing linked file missing.png']);
});

test('the single operational handoff is discoverable and old checkpoint is retired',()=>{
  assert.match(readFileSync(new URL('../README.md',import.meta.url),'utf8'),/\[PROJECT\.md\]\(PROJECT\.md\)/);
  assert.match(readFileSync(new URL('../AGENTS.md',import.meta.url),'utf8'),/\[PROJECT\.md\]\(PROJECT\.md\)/);
  assert.match(readFileSync(new URL('../PROJECT.md',import.meta.url),'utf8'),/Production: NO-GO|Production.*NO-GO/i);
  assert.equal(tracked.has('docs/CLEAN_SHOP_HANDOFF.md'),false);
});
