import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {planArchiveColumns} from '../scripts/dry-run-archive-header-plan.mjs';

const privateSentinel='SYNTHETIC_PRIVATE_CUSTOMER_01712345678';
const schema={tables:Array.from({length:49},(_,i)=>({
 sheetKey:'GROUP_'+(i+1),columns:['Record ID','Status','Current Due']
}))};
function archiveOf(config={}){
 const rows=schema.tables.map((g,i)=>({
  sheet_key:g.sheetKey,sql_table:'legacy_'+g.sheetKey.toLowerCase(),
  actual_headers_json:JSON.stringify(g.columns),
  header_count:3,populated_data_rows:i,physical_data_rows:i+2,
  private_customer_phone:privateSentinel
 }));
 for(const [index,headers] of Object.entries(config)){
  rows[Number(index)].actual_headers_json=JSON.stringify(headers);
  rows[Number(index)].header_count=headers.length;
 }
 rows.push({sheet_key:'SHEET1',sql_table:'legacy_sheet1',actual_headers_json:'[]',
  header_count:0,populated_data_rows:0,physical_data_rows:0});
 return rows;
}
const plan=rows=>planArchiveColumns({schema,sheets:rows});

test('49 exact groups preserve exact same-name source indexes, never import authority',()=>{
 const p=plan(archiveOf());
 assert.equal(p.formatVersion,1);
 assert.equal(p.sourceGroups,49);
 assert.equal(p.populatedRows,1176);
 assert.equal(p.physicalRows,1274);
 assert.equal(p.exactGroups,49);
 assert.equal(p.reorderOnlyGroups,0);
 assert.equal(p.reviewRequiredGroups,0);
 assert.equal(p.canProjectLosslesslyByName,true);
 assert.equal(p.operationalImportAuthorized,false);
 assert.equal(p.sourceHeaderMappingApproved,false);
 assert.equal(p.productionReady,false);
 assert.equal(p.groups[0].mapping[2].column,'Current Due');
 assert.equal(p.groups[0].mapping[2].sourceIndex,2);
 assert.equal(p.groups[0].mapping[2].frozenIndex,2);
 assert.doesNotMatch(JSON.stringify(p),/SYNTHETIC_PRIVATE_CUSTOMER/);
});
test('reordering is mapped by exact source name, not frozen physical position',()=>{
 const rows=archiveOf({1:['Current Due','Record ID','Status']});
 const p=plan(rows);
 assert.equal(p.exactGroups,48);
 assert.equal(p.reorderOnlyGroups,1);
 assert.equal(p.reviewRequiredGroups,0);
 const g=p.groups[1];
 assert.equal(g.status,'REORDER_BY_NAME');
 assert.deepEqual(g.mapping.map(x=>[x.column,x.sourceIndex,x.frozenIndex]),[
  ['Record ID',1,0],['Status',2,1],['Current Due',0,2]
 ]);
 assert.deepEqual(g.missingFrozenColumns,[]);
 assert.deepEqual(g.unexpectedSourceIndices,[]);
 assert.equal(p.canProjectLosslesslyByName,true);
 assert.equal(p.sourceHeaderMappingApproved,false);
});
test('missing required frozen fields and unexpected fields block projections without leaking original unknown labels',()=>{
 const p=plan(archiveOf({2:['Record ID','Status',privateSentinel]}));
 assert.equal(p.exactGroups,48);
 assert.equal(p.reviewRequiredGroups,1);
 assert.equal(p.canProjectLosslesslyByName,false);
 const g=p.groups[2];
 assert.equal(g.status,'REQUIRES_REVIEW');
 assert.deepEqual(g.missingFrozenColumns,['Current Due']);
 assert.deepEqual(g.unexpectedSourceIndices,[2]);
 assert.equal(g.mapping.length,2);
 assert.equal(g.canProjectLosslesslyByName,false);
 assert.equal(p.unmappedExtraSourceColumnCount,1);
 assert.equal(p.missingFrozenColumnCount,1);
 assert.doesNotMatch(JSON.stringify(p),/SYNTHETIC_PRIVATE_CUSTOMER|01712345678/);
});
test('unexpected product conversion columns are not silently dropped or treated as already approved',()=>{
 const p=plan(archiveOf({0:['Record ID','Status','Current Due','Conversion Unit','Conversion Factor']}));
 const g=p.groups[0];
 assert.deepEqual(g.unexpectedSourceIndices,[3,4]);
 assert.equal(p.unmappedExtraSourceColumnCount,2);
 assert.equal(g.canProjectLosslesslyByName,false);
 assert.equal(p.operationalImportAuthorized,false);
});
test('invalid archive metadata and duplicate header aliases fail closed',()=>{
 assert.throws(()=>plan(archiveOf().slice(1)),/archive metadata rejected/i);
 const duplicate=archiveOf();
 duplicate[0].actual_headers_json=JSON.stringify(['Record ID','Status','Status']);
 assert.throws(()=>plan(duplicate),/archive metadata rejected/i);
 const forged=archiveOf();
 forged[0].sql_table='DROP TABLE';
 assert.throws(()=>plan(forged),/archive metadata rejected/i);
});
test('CLI uses only local regular files, lossless gate rejects substantive drift, and no private values leak',()=>{
 const inventory=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
 const sheets=inventory.tables.map((g,i)=>({
  sheet_key:g.sheetKey,sql_table:'legacy_'+g.sheetKey.toLowerCase(),
  actual_headers_json:JSON.stringify(g.columns),header_count:g.columns.length,
  populated_data_rows:i,physical_data_rows:i+1,private_note:privateSentinel
 }));
 sheets.push({sheet_key:'SHEET1',sql_table:'legacy_sheet1',actual_headers_json:'[]',
  header_count:0,populated_data_rows:0,physical_data_rows:0});
 const dir=mkdtempSync(join(tmpdir(),'m02-archive-column-plan-'));
 const cli=new URL('../scripts/dry-run-archive-header-plan.mjs',import.meta.url).pathname;
 try{
  const file=join(dir,'source.json');
  writeFileSync(file,JSON.stringify({sheets}));
  const pass=spawnSync(process.execPath,[cli,'--require-lossless',file],{encoding:'utf8'});
  assert.equal(pass.status,0,pass.stderr);
  assert.equal(JSON.parse(pass.stdout).canProjectLosslesslyByName,true);
  sheets[0].actual_headers_json=JSON.stringify([...inventory.tables[0].columns,privateSentinel]);
  sheets[0].header_count+=1;
  writeFileSync(file,JSON.stringify({sheets}));
  const blocked=spawnSync(process.execPath,[cli,'--require-lossless',file],{encoding:'utf8'});
  assert.equal(blocked.status,2);
  assert.equal(JSON.parse(blocked.stdout).reviewRequiredGroups,1);
  const symlink=join(dir,'source-link.json');
  symlinkSync(file,symlink);
  const denied=spawnSync(process.execPath,[cli,'--report',symlink],{encoding:'utf8'});
  assert.equal(denied.status,2);
  assert.doesNotMatch(pass.stdout+pass.stderr+blocked.stdout+blocked.stderr+denied.stdout+denied.stderr,
    /SYNTHETIC_PRIVATE_CUSTOMER|01712345678/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});