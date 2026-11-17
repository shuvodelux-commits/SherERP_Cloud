import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {reconcileArchiveSheetMetadata as audit} from '../scripts/dry-run-archive-metadata.mjs';

const schema={tables:Array.from({length:49},(_,i)=>({
  sheetKey:'GROUP_'+(i+1),columns:['Record ID','Current Due','Status']
}))};
function sheets(){
 return schema.tables.map((t,i)=>({
  sheet_key:t.sheetKey,sql_table:'legacy_'+t.sheetKey.toLowerCase(),
  actual_headers_json:JSON.stringify(t.columns),header_count:3,
  populated_data_rows:i,physical_data_rows:i+2,
  private_value:'SYNTHETIC_SECRET_DO_NOT_LEAK'
 })).concat([{
  sheet_key:'SHEET1',sql_table:'legacy_sheet1',actual_headers_json:'[]',
  header_count:0,populated_data_rows:0,physical_data_rows:0
 }]);
}
const run=rows=>audit({schema,sheets:rows});

test('all 49 frozen groups plus optional empty worksheet report safe metadata only',()=>{
 const report=run(sheets());
 assert.equal(report.sourceGroups,49);
 assert.equal(report.extraEmptySheets,1);
 assert.equal(report.populatedRows,1176);
 assert.equal(report.physicalRows,1274);
 assert.equal(report.matchingHeaderGroups,49);
 assert.equal(report.headerDifferenceGroups,0);
 assert.deepEqual(report.differences,[]);
 for(const flag of [
  'sourceHeaderMappingApproved','originalSourceIdsReconciled',
  'financialAccountsReconciled','remoteOperationalD1Reconciled',
  'operationalImportAuthorized','productionReady'
 ])assert.equal(report[flag],false);
 assert.doesNotMatch(JSON.stringify(report),/SYNTHETIC_SECRET_DO_NOT_LEAK/);
});
test('missing/additional source columns require explicit mapping review',()=>{
 const rows=sheets();
 rows[1].actual_headers_json=JSON.stringify(['Record ID','Old Balance','Status']);
 const report=run(rows);
 assert.equal(report.headerDifferenceGroups,1);
 assert.deepEqual(report.differences[0],{
  sourceGroup:'GROUP_2',missingColumns:['Current Due'],
  unexpectedColumns:['Old Balance'],columnOrderChanged:false,
  sourceHeaderCount:3,frozenHeaderCount:3
 });
 assert.equal(report.operationalImportAuthorized,false);
});
test('reordered columns cannot be approved as positional matches',()=>{
 const rows=sheets();
 rows[10].actual_headers_json=JSON.stringify(['Status','Record ID','Current Due']);
 const report=run(rows);
 assert.equal(report.headerDifferenceGroups,1);
 assert.equal(report.differences[0].columnOrderChanged,true);
 assert.deepEqual(report.differences[0].missingColumns,[]);
});
test('missing, duplicate, forged and extra source groups fail closed',()=>{
 assert.throws(()=>run(sheets().slice(1)),/archive metadata rejected/);
 const duplicate=sheets();duplicate[2]={...duplicate[1]};
 assert.throws(()=>run(duplicate),/archive metadata rejected/);
 const injected=sheets();injected[1].sheet_key='INJECTED';
 assert.throws(()=>run(injected),/archive metadata rejected/);
});
test('nonempty scratch sheet, unsafe table identifiers or invalid counts fail',()=>{
 for(const mutate of [
  x=>{x[49].populated_data_rows=1;},
  x=>{x[0].physical_data_rows=-1;},
  x=>{x[0].populated_data_rows=3;},
  x=>{x[0].header_count=6;},
  x=>{x[0].sql_table='legacy_injected; DROP TABLE';},
  x=>{x[0].actual_headers_json='[not json';},
  x=>{x[0].actual_headers_json='["A","A"]';}
 ]){const input=sheets();mutate(input);
  assert.throws(()=>run(input),/archive metadata rejected/);}
});
test('CLI refuses noncanonical data or symlink without printing private fields',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-private-metadata-'));
 try {
  const file=join(dir,'private.json');
  writeFileSync(file,JSON.stringify({sheets:sheets()}));
  const cli=new URL('../scripts/dry-run-archive-metadata.mjs',import.meta.url).pathname;
  const result=spawnSync(process.execPath,[cli,'--report',file],{encoding:'utf8'});
  // Synthetic GROUP_1...49 is not the actual frozen SherERP inventory.
  assert.equal(result.status,2);
  assert.doesNotMatch(result.stdout+result.stderr,/SYNTHETIC_SECRET_DO_NOT_LEAK|private\.json/);
  const link=join(dir,'symlink.json');symlinkSync(file,link);
  const rejected=spawnSync(process.execPath,[cli,'--report',link],{encoding:'utf8'});
  assert.equal(rejected.status,2);
  assert.doesNotMatch(rejected.stdout+rejected.stderr,/SYNTHETIC_SECRET_DO_NOT_LEAK|private\.json/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});