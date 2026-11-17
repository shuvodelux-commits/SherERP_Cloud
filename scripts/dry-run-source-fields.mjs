#!/usr/bin/env node
/**
 * M02 final-run original-column preservation review; metadata only.
 * This is NOT a D1 importer or a signed source/data reconciliation.
 * M03 retains sole ownership of operational D1 schema and D1 writers.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const BASELINE=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const SOURCE_COMMIT=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;

// Original row position is the only guaranteed unique identity for these
// repeated-parent and ID-less groups; do not fabricate source record IDs.
const ROW_ONLY=new Set([
 'BUNDLE_COMPONENTS','SALE_BUNDLE_COMPONENTS','SALE_ITEM_LOTS',
 'PURCHASE_ITEMS','SALE_ITEMS','SALES_RETURN_ITEMS',
 'PURCHASE_RETURN_ITEMS','LOGS'
]);
const GROSS_ACCOUNT_KINDS=Object.freeze([
 'CUSTOMER_RECEIVABLE_AND_ADVANCE','SUPPLIER_PAYABLE_AND_ADVANCE',
 'VENDOR_PAYABLE','VENDOR_RECEIVABLE','OWNER_EQUITY_AND_DRAWINGS',
 'LENDER_LOAN_PAYABLE','BORROWER_LOAN_RECEIVABLE'
]);
function reject(){throw new Error('M02 frozen source-field schema or source pin drift');}
function isRecord(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function semanticHazard(sourceGroup,name){
 // Priority matters: credentials/config are not general money or IDs.
 if(sourceGroup==='SETTINGS'&&name==='Value')return 'configuration-secret';
 if((sourceGroup==='USERS'&&(name==='Password Hash'||name==='Password Salt'))||
    (sourceGroup==='SESSIONS'&&name==='Token'))
  return 'credential-secret';
 if(name==='Account Number'||/^(?:Phone|Mobile Number|Customer Phone|Deleted By Mobile)$/.test(name))
  return 'sensitive-identifier';
 if(name==='Allowed Modules'||name==='Permissions'||/ JSON$/.test(name))
  return 'structured-source-text';
 if(/^(?:Is Deleted|Is Backdated|Status)$/i.test(name))
  return 'state-flag';
 if(/^(?:Delete Reason|Deleted At|Deleted By|Reversed At|Reversed By)$/i.test(name))
  return 'deletion-provenance';
 if(/(?:^| )(?:ID|IDs)$/.test(name)||name==='Key')
  return 'legacy-id';
 if(/(?:^| )(?:Revision|Version|Row Order)$/.test(name))
  return 'version-revision';
 if(/^(?:Current Stock|Minimum Stock|Original Quantity|Remaining Quantity|Matched Historical Quantity|Quantity|Quantity In|Quantity Out|Quantity Per Set|Return Quantity|Sets Sold|Component Quantity Sold)$/.test(name))
  return 'stock-quantity';
 if(/(?:Price|Amount|Debit|Credit|Balance|Cash|Receivable|Due|Discount|Cost|COGS|Delta|Value|Subtotal|Grand Total|Line Total|Tendered|Applied|Change Amount|Variance|Total Value|Profit)/i.test(name))
  return 'financial-amount';
 if(/(?:^Date$|^Time$|Timestamp|Date$| At$|Last Login$|Last Activity$|Expires At$)/.test(name))
  return 'chronology-text';
 if(/(?: Name$|^Full Name$|^Person$|^Customer Name$)/.test(name))
  return 'private-display-text';
 return 'review-text';
}

/**
 * A pure, non-authoritative contract of EVERY original Config.gs column.
 * No transaction rows, source identifiers or data values are accessed.
 */
export function buildM02FieldPreservationReview({schema,pinnedSourceCommit}={}){
 if(!isRecord(schema)||JSON.stringify(schema)!==JSON.stringify(BASELINE)||
    pinnedSourceCommit!==SOURCE_COMMIT||schema.tables?.length!==49)
  reject();
 const groups=schema.tables.map(source=>{
  const names=source.columns;
  if(!Array.isArray(names)||!names.length||names.some(s=>typeof s!=='string')||
     new Set(names).size!==names.length)
   reject();
  return {
   sourceGroup:source.sheetKey,
   sourceColumnCount:names.length,
   sourceRecordIdColumn:ROW_ONLY.has(source.sheetKey)?null:names[0],
   identityBasis:ROW_ONLY.has(source.sheetKey)?'physical-sheet-row':'original-record-id-and-sheet-row',
   sourceRowProvenanceRequired:true,
   sourceGroupReviewApproved:false,
   originalSourcePreserved:false,
   columns:names.map(name=>({
    sourceColumn:name,
    semanticHazard:semanticHazard(source.sheetKey,name),
    sourceStorage:'exact-original-text',
    sourceValueMayBePrivate:true,
    operationalTargetColumn:null,
    operationalMappingApproved:false,
    autoConvertToNumberOrDate:false,
    reconciliationReviewRequired:true
   }))
  };
 });
 return {
  formatVersion:1,
  sourceCommit:pinnedSourceCommit,
  sourceGroups:groups.length,
  originalColumnObligations:groups.reduce((n,g)=>n+g.sourceColumnCount,0),
  reviewedOperationalMappings:0,
  grossFinancialAccountKinds:[...GROSS_ACCOUNT_KINDS],
  autoMergePartyByNameOrPhoneAllowed:false,
  crossRoleAutoNettingAllowed:false,
  payeeCreatesLiability:false,
  historicalOpeningPostsCashOrBank:false,
  roundSourceMoneyOnImport:false,
  sourceRowsRead:false,
  privateExportRequested:false,
  actualD1ReadbackVerified:false,
  sourceReconciled:false,
  d1WriterAuthorized:false,
  productionReady:false,
  limitations:'Field hazards are a conservative human-review checklist, not an operational SQL mapping, verified money parsing, private source import, approval of identity linking or actual D1 reconciliation.',
  groups
 };
}
function main(){
 const mode=process.argv[2];
 if(process.argv.length!==3||(mode!=='--check'&&mode!=='--json'))
  reject();
 const report=buildM02FieldPreservationReview({
  schema:BASELINE,pinnedSourceCommit:SOURCE_COMMIT
 });
 if(mode==='--json')process.stdout.write(JSON.stringify(report,null,2)+'\n');
 else process.stdout.write('M02 source-field obligations: '+report.sourceGroups+
  ' groups / '+report.originalColumnObligations+
  ' original columns; 0 operational field mappings approved; no D1 writes\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{main();}
 catch{
  process.stderr.write('M02 original-field review rejected: invalid frozen source request\n');
  process.exitCode=1;
 }
}
