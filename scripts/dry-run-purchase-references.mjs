#!/usr/bin/env node
/**
 * M02 #24 — offline Purchase→Supplier/Product source reference review.
 *
 * Consumes one frozen, 49-group source-shaped JSON candidate supplied by
 * the operator; this is not an authenticity check, D1 importer or finance
 * reconciliation. Historical exact IDs are never inferred from names/phones.
 * Source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * No Sheets/D1 reads or writes, no personal/business data in output.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewOfflineSourceParity} from './dry-run-source-parity.mjs';
import {readLocalJsonFile} from './dry-run-safe-input.mjs';

const SCHEMA=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const PIN=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;

function field(data,group,column){
 const table=data.groups[group];
 const index=table.headers.indexOf(column);
 // Impossible after frozen source validation, but fail closed if an
 // approved source contract ever changes without this adapter's review.
 if(index<0)throw new Error('M02 purchase source field mapping unavailable');
 return table.rows.map(row=>row.cells[index]);
}

/**
 * Report only safe fixed issue codes and counts. Absence of a master record
 * blocks historical identity attribution, not permission to delete/orphan
 * old purchases or to automatically merge unrelated Party identities.
 */
export function reviewM02PurchaseReferences({schema,pinnedSourceCommit,sourceExport}={}){
 const verifiedShape=reviewOfflineSourceParity({
  schema,pinnedSourceCommit,sourceExport,candidateExport:sourceExport
 });
 const suppliers=field(sourceExport,'SUPPLIERS','Supplier ID');
 const products=field(sourceExport,'PRODUCTS','Product ID');
 const purchaseIds=field(sourceExport,'PURCHASES','Purchase ID');
 const purchaseSupplierIds=field(sourceExport,'PURCHASES','Supplier ID');
 const itemPurchaseIds=field(sourceExport,'PURCHASE_ITEMS','Purchase ID');
 const itemProductIds=field(sourceExport,'PURCHASE_ITEMS','Product ID');

 const supplierSet=new Set(suppliers),productSet=new Set(products);
 const purchaseSet=new Set(purchaseIds);
 const childCounts=new Map(purchaseIds.map(id=>[id,0]));
 const counts={
  PURCHASE_SUPPLIER_ID_BLANK:0,
  PURCHASE_SUPPLIER_NOT_FOUND:0,
  PURCHASE_ITEM_PARENT_ID_BLANK:0,
  PURCHASE_ITEM_PARENT_NOT_FOUND:0,
  PURCHASE_ITEM_PRODUCT_ID_BLANK:0,
  PURCHASE_ITEM_PRODUCT_NOT_FOUND:0,
  PURCHASE_WITHOUT_ITEMS:0
 };
 for(const id of purchaseSupplierIds){
  if(!id.trim())counts.PURCHASE_SUPPLIER_ID_BLANK++;
  else if(!supplierSet.has(id))counts.PURCHASE_SUPPLIER_NOT_FOUND++;
 }
 for(let i=0;i<itemPurchaseIds.length;i++){
  const purchaseId=itemPurchaseIds[i];
  const productId=itemProductIds[i];
  if(!purchaseId.trim())counts.PURCHASE_ITEM_PARENT_ID_BLANK++;
  else if(!purchaseSet.has(purchaseId))counts.PURCHASE_ITEM_PARENT_NOT_FOUND++;
  else childCounts.set(purchaseId,childCounts.get(purchaseId)+1);
  if(!productId.trim())counts.PURCHASE_ITEM_PRODUCT_ID_BLANK++;
  else if(!productSet.has(productId))counts.PURCHASE_ITEM_PRODUCT_NOT_FOUND++;
 }
 for(const total of childCounts.values())
  if(total===0)counts.PURCHASE_WITHOUT_ITEMS++;

 const sourceGroupFor={
  PURCHASE_SUPPLIER_ID_BLANK:'PURCHASES',
  PURCHASE_SUPPLIER_NOT_FOUND:'PURCHASES',
  PURCHASE_ITEM_PARENT_ID_BLANK:'PURCHASE_ITEMS',
  PURCHASE_ITEM_PARENT_NOT_FOUND:'PURCHASE_ITEMS',
  PURCHASE_ITEM_PRODUCT_ID_BLANK:'PURCHASE_ITEMS',
  PURCHASE_ITEM_PRODUCT_NOT_FOUND:'PURCHASE_ITEMS',
  PURCHASE_WITHOUT_ITEMS:'PURCHASES'
 };
 const issues=Object.entries(counts)
  .filter(([,count])=>count>0)
  .map(([code,count])=>({sourceGroup:sourceGroupFor[code],code,count}));
 return {
  formatVersion:1,
  sourceCommit:pinnedSourceCommit,
  sourceGroups:verifiedShape.sourceGroups,
  totals:{
   purchases:purchaseIds.length,
   purchaseItems:itemPurchaseIds.length,
   suppliers:suppliers.length,
   products:products.length
  },
  candidateReady:issues.length===0,
  issues,
  // Immutable NO-GO flags: valid source-shaped references cannot prove
  // source authenticity, original financial meaning, DB identity or posting.
  independentSourceExportVerified:false,
  d1ReadbackVerified:false,
  sourceToD1Reconciled:false,
  supplierRoleReviewed:false,
  postingAuthorized:false,
  productionReady:false
 };
}

async function main(){
 if(process.argv.length!==3)throw new Error('REQUIRE_ONE_LOCAL_SOURCE_EXPORT');
 const sourceExport=await readLocalJsonFile(process.argv[2]);
 const result=reviewM02PurchaseReferences({
  schema:SCHEMA,pinnedSourceCommit:PIN,sourceExport
 });
 process.stdout.write(JSON.stringify(result)+'\n');
 if(!result.candidateReady)process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{
  // No private path, ID, phone, supplier name, amount or row can leak.
  process.stderr.write('M02 purchase reference evidence rejected (values withheld)\n');
  process.exitCode=2;
 });
