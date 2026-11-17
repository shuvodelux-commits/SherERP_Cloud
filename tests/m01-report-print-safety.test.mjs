import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {patchM01ReportPrintSafety} from '../scripts/patch-m01-report-print-safety.mjs';

const reports=await readFile(new URL('../legacy/source/reports.html',import.meta.url),'utf8');
const syntheticController='(function(){window.__m01ReportPrintState={};})();';

test('M01 Reports Print must wrap only the original active report loader in compiled HTML',()=>{
  const compiled=patchM01ReportPrintSafety(reports,syntheticController);
  assert.notEqual(compiled,reports,'an unmodified original source prints without a valid report');
  assert.match(compiled,/var guard = window\.__m01ReportPrintState/);
  assert.match(compiled,/guard\.start\(tab\)/);
  assert.match(compiled,/guard\.complete\(ticket\)/);
  assert.match(compiled,/guard\.fail\(ticket\)/);
  assert.equal((compiled.match(/guard\.start\(tab\)/g)||[]).length,1);
  assert.match(compiled,/getSalesReport/);
  assert.match(compiled,/getBalanceSheetReport/);
  assert.match(compiled,/window\.print\(\)/,'original print lifecycle remains intact');
});

test('M01 Reports source-anchored patch installs controller once, is repeatable and freezes original bytes',async()=>{
  const compiled=patchM01ReportPrintSafety(reports,syntheticController);
  assert.match(compiled,/window\.__m01ReportPrintState=\{\}/);
  assert.equal(patchM01ReportPrintSafety(compiled,syntheticController),compiled);
  assert.equal(await readFile(new URL('../legacy/source/reports.html',import.meta.url),'utf8'),reports);
});

test('M01 Reports compiler fails closed when original loader is absent, duplicated or malformed',()=>{
  const old='function rptRunActive_(force)';
  for(const input of [
    reports.replace(old,'function oldReportLoader(force)'),
    reports.replace(old,old+old),
    reports.replace('id="rptPrintBtn"','id="missingPrintBtn"')
  ]){
    assert.throws(()=>patchM01ReportPrintSafety(input,syntheticController),
      /missing|ambiguous|duplicate|anchor/i);
  }
});

test('M01 Reports isolated patch never creates report RPC or public posting',()=>{
  const compiled=patchM01ReportPrintSafety(reports,syntheticController);
  assert.doesNotMatch(compiled,/INSERT INTO|UPDATE stock|__m09PreviewMarkLoaded/);
  assert.ok(compiled.includes("getSalesReport"),'preserve original source-shaped reports');
});
