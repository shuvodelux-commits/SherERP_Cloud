#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/**
 * M01 Reports print-safety enhancement, compiled HTML only.
 * NOT invoked by the shared production build until M03 integration review.
 */
const MARKER='<script data-m01-report-print-guard="1">';
const REPORT_SCRIPT="<script>\n  var rptState = { currency: '', shopName: '', loaded: {}, activeTab: 'rptSales' };";
const ORIGINAL=[
  "  function rptRunActive_(force) {",
  "    var tab = rptState.activeTab;",
  "    if (!force && rptState.loaded[tab]) return Promise.resolve();",
  "    return RPT_LOADERS[tab]().then(function () {",
  "      rptState.loaded[tab] = true;",
  "    }).catch(function (err) { showToast(err.message, 'error'); });",
  "  }"
].join('\n');
const GUARDED=[
  "  function rptRunActive_(force) {",
  "    var tab = rptState.activeTab;",
  "    var guard = window.__m01ReportPrintState;",
  "    if (!guard) {",
  "      showToast('Reports print safety is unavailable.', 'error');",
  "      return Promise.resolve();",
  "    }",
  "    if (!force && rptState.loaded[tab] && guard.isCurrent(tab)) return Promise.resolve();",
  "    var ticket = guard.start(tab);",
  "    return Promise.resolve().then(function () {",
  "      return RPT_LOADERS[tab]();",
  "    }).then(function () {",
  "      var accepted = guard.complete(ticket);",
  "      if (guard.isLatest(ticket)) rptState.loaded[tab] = accepted;",
  "      guard.refresh();",
  "    }).catch(function (err) {",
  "      guard.fail(ticket);",
  "      if (guard.isLatest(ticket)) rptState.loaded[tab] = false;",
  "      guard.refresh();",
  "      showToast(err.message, 'error');",
  "    });",
  "  }"
].join('\n');
const count=(text,phrase)=>text.split(phrase).length-1;

export function patchM01ReportPrintSafety(html,controller){
  if(typeof html!=='string'||typeof controller!=='string'||!controller.trim())
    throw new TypeError('Missing compiled Reports HTML or controller');
  if(/<\/script/i.test(controller))throw new TypeError('Unsafe Reports controller end-tag');
  const has=count(html,MARKER);
  if(has>1)throw new Error('Duplicate M01 Reports print safety installation');
  if(has===1){
    if(count(html,GUARDED)!==1 || count(html,ORIGINAL)!==0)
      throw new Error('Partial or ambiguous Reports print safety installation');
    return html;
  }
  for(const [text,label] of [
    [ORIGINAL,'original Reports loader'],[REPORT_SCRIPT,'Reports script start'],
    ['id="rptPrintBtn"','Reports Print button']
  ]){
    if(count(html,text)!==1)
      throw new Error('Missing, duplicate or ambiguous '+label+' anchor');
  }
  if(count(html,'function rptRunActive_(force)')!==1)
    throw new Error('Duplicate Reports loader name');
  const script=MARKER+'\n'+controller+'\n</script>\n';
  return html.replace(REPORT_SCRIPT,script+REPORT_SCRIPT).replace(ORIGINAL,GUARDED);
}

// Manual preview invocation only; NOT a production-build activation.
if(process.argv[1] && resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const file=resolve(process.argv[2]||'dist/index.html');
  try{
    const [html,controller]=await Promise.all([
      readFile(file,'utf8'),
      readFile(new URL('../src/ui/m01-report-print-controller.js',import.meta.url),'utf8')
    ]);
    await writeFile(file,patchM01ReportPrintSafety(html,controller),'utf8');
    console.log('M01 Reports print safety installed in local compiled preview only: '+file);
  }catch(error){
    console.error('M01 Reports preview patch failed: '+error.message);
    process.exitCode=1;
  }
}