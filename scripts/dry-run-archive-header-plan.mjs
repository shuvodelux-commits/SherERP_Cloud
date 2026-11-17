#!/usr/bin/env node
/**
 * M02 offline-only exact-name column mapping proposal for private historical
 * worksheets. This is NOT an operational import or schema approval.
 * Source-only unmatched header labels and business cells are never returned.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reconcileArchiveSheetMetadata} from './dry-run-archive-metadata.mjs';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';

const SCHEMA=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));

export function planArchiveColumns({schema,sheets}={}){
 // Reuse the already reviewed fail-closed 49-group/Sheet1 metadata validator.
 const audit=reconcileArchiveSheetMetadata({schema,sheets});
 const byKey=new Map(sheets.map(s=>[s.sheet_key,s]));
 const groups=[];
 let exactGroups=0,reorderOnlyGroups=0,reviewRequiredGroups=0;
 let missingFrozenColumnCount=0,unmappedExtraSourceColumnCount=0;
 for(const table of schema.tables){
  const actual=JSON.parse(byKey.get(table.sheetKey).actual_headers_json);
  const index=new Map(actual.map((column,i)=>[column,i]));
  const expected=table.columns;
  const mapping=expected.flatMap((column,frozenIndex)=>
   index.has(column)?[{column,sourceIndex:index.get(column),frozenIndex}]:[]);
  const missingFrozenColumns=expected.filter(column=>!index.has(column));
  const known=new Set(expected);
  // The archive's original unknown header names never enter report output.
  // Their positional evidence remains available inside the private archive.
  const unexpectedSourceIndices=actual.flatMap((column,i)=>known.has(column)?[]:[i]);
  const review=missingFrozenColumns.length>0||unexpectedSourceIndices.length>0;
  const reordered=!review&&mapping.some(x=>x.sourceIndex!==x.frozenIndex);
  const status=review?'REQUIRES_REVIEW':reordered?'REORDER_BY_NAME':'EXACT';
  if(review)reviewRequiredGroups++;
  else if(reordered)reorderOnlyGroups++;
  else exactGroups++;
  missingFrozenColumnCount+=missingFrozenColumns.length;
  unmappedExtraSourceColumnCount+=unexpectedSourceIndices.length;
  groups.push({
   sourceGroup:table.sheetKey,status,
   frozenHeaderCount:expected.length,sourceHeaderCount:actual.length,
   populatedRows:byKey.get(table.sheetKey).populated_data_rows,
   mapping,missingFrozenColumns,unexpectedSourceIndices,
   canProjectLosslesslyByName:!review
  });
 }
 return {
  formatVersion:1,scope:'offline-source-header-map-proposal',
  sourceGroups:audit.sourceGroups,populatedRows:audit.populatedRows,
  physicalRows:audit.physicalRows,
  exactGroups,reorderOnlyGroups,reviewRequiredGroups,
  missingFrozenColumnCount,unmappedExtraSourceColumnCount,
  canProjectLosslesslyByName:reviewRequiredGroups===0,
  originalArchivePreserved:true,
  sourceHeaderMappingApproved:false,
  sourceIdentityReconciled:false,
  financialAccountsReconciled:false,
  remoteOperationalD1Reconciled:false,
  operationalImportAuthorized:false,productionReady:false,
  groups
 };
}

async function main(){
 const args=process.argv.slice(2);
 if(args.length!==2||!['--report','--require-lossless'].includes(args[0]))
  throw new Error('invalid CLI input');
 const input=await readLocalJsonFile(args[1]);
 const plan=planArchiveColumns({schema:SCHEMA,sheets:input.sheets});
 process.stdout.write(JSON.stringify(plan,null,2)+'\n');
 if(args[0]==='--require-lossless'&&!plan.canProjectLosslesslyByName)
  process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main().catch(()=>{
  process.stderr.write('M02 archive column plan rejected: invalid private input (values withheld)\n');
  process.exitCode=2;
 });
}
