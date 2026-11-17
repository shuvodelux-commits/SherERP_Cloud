#!/usr/bin/env node
/**
 * M02-safe archive metadata reconciliation. The private SQLite/D1 archive
 * contains original history, but is NOT the operational ERP schema.
 * This tool reads ONLY a local metadata projection, never business cell values.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';

const SCHEMA=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const REQUIRED_GROUPS=49;
const MAX_COLS=512;
const reject=()=>{throw new Error('M02 archive metadata rejected');};
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safeCount=v=>Number.isSafeInteger(v)&&v>=0;

function safeHeaders(value){
 let headers=value;
 if(typeof value==='string'){
  try{headers=JSON.parse(value);}
  catch{reject();}
 }
 if(!Array.isArray(headers)||headers.length>MAX_COLS||
    headers.some(x=>typeof x!=='string'||!x.trim()||x.length>1024)||
    new Set(headers).size!==headers.length)reject();
 return headers;
}

/**
 * Compare the 49 frozen source group headers with archive_sheets metadata.
 * Exactly one optional empty Sheet1 is tolerated, never invented records.
 * This does not map financial accounts, source IDs, or grant D1 writer authority.
 */
export function reconcileArchiveSheetMetadata({schema,sheets}={}){
 if(!record(schema)||!Array.isArray(schema.tables)||
    schema.tables.length!==REQUIRED_GROUPS||!Array.isArray(sheets)||
    sheets.length<REQUIRED_GROUPS||sheets.length>REQUIRED_GROUPS+1)reject();
 const frozen=new Map();
 for(const group of schema.tables){
  if(!record(group)||typeof group.sheetKey!=='string'||
     !/^[A-Z][A-Z0-9_]*$/.test(group.sheetKey)||frozen.has(group.sheetKey))
   reject();
  frozen.set(group.sheetKey,safeHeaders(group.columns));
 }
 const found=new Map();
 let extraEmptySheets=0;
 for(const sheet of sheets){
  if(!record(sheet)||typeof sheet.sheet_key!=='string'||
     !/^[A-Z][A-Z0-9_]*$/.test(sheet.sheet_key)||
     typeof sheet.sql_table!=='string'||
     sheet.sql_table!=='legacy_'+sheet.sheet_key.toLowerCase()||
     !safeCount(sheet.header_count)||
     !safeCount(sheet.populated_data_rows)||
     !safeCount(sheet.physical_data_rows)||
     sheet.populated_data_rows>sheet.physical_data_rows)reject();
  const headers=safeHeaders(sheet.actual_headers_json);
  if(headers.length!==sheet.header_count)reject();
  if(sheet.sheet_key==='SHEET1'){
   if(extraEmptySheets||headers.length||sheet.populated_data_rows||
      sheet.physical_data_rows)reject();
   extraEmptySheets++;
   continue;
  }
  if(!frozen.has(sheet.sheet_key)||found.has(sheet.sheet_key))reject();
  found.set(sheet.sheet_key,{
   headers,populated:sheet.populated_data_rows,physical:sheet.physical_data_rows
  });
 }
 if(found.size!==REQUIRED_GROUPS||found.size+extraEmptySheets!==sheets.length)reject();

 const differences=[];
 let populatedRows=0,physicalRows=0,matchingHeaderGroups=0;
 for(const [sourceGroup,expected] of frozen){
  const entry=found.get(sourceGroup);
  if(!entry)reject();
  populatedRows+=entry.populated;
  physicalRows+=entry.physical;
  if(!safeCount(populatedRows)||!safeCount(physicalRows))reject();
  const missingColumns=expected.filter(name=>!entry.headers.includes(name));
  const unexpectedColumns=entry.headers.filter(name=>!expected.includes(name));
  const columnOrderChanged=!missingColumns.length&&!unexpectedColumns.length&&
   expected.some((name,index)=>name!==entry.headers[index]);
  if(missingColumns.length||unexpectedColumns.length||columnOrderChanged){
   differences.push({
    sourceGroup,missingColumns,unexpectedColumns,columnOrderChanged,
    sourceHeaderCount:entry.headers.length,frozenHeaderCount:expected.length
   });
  }else matchingHeaderGroups++;
 }
 return {
  formatVersion:1,sourceGroups:REQUIRED_GROUPS,extraEmptySheets,
  populatedRows,physicalRows,matchingHeaderGroups,
  headerDifferenceGroups:differences.length,differences,
  originalArchivePreserved:true,
  sourceHeaderMappingApproved:false,originalSourceIdsReconciled:false,
  financialAccountsReconciled:false,remoteOperationalD1Reconciled:false,
  operationalImportAuthorized:false,productionReady:false
 };
}

async function main(){
 const args=process.argv.slice(2);
 if(args.length!==2||!['--report','--require-exact'].includes(args[0]))reject();
 const input=await readLocalJsonFile(args[1]);
 if(!record(input)||!Array.isArray(input.sheets))reject();
 const report=reconcileArchiveSheetMetadata({schema:SCHEMA,sheets:input.sheets});
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(args[0]==='--require-exact'&&report.headerDifferenceGroups)
  process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(()=>{
  process.stderr.write('M02 archive metadata rejected: invalid local evidence (values withheld)\n');
  process.exitCode=2;
 });
}