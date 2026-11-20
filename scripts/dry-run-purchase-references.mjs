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
 const purchaseSupplierById=new Map(purchaseIds.map((id,i)=>[id,purchaseSupplierIds[i]]));
 const purchasedProductsById=new Map(purchaseIds.map(id=>[id,new Set()]));
 // A purchase return is a new document with exact original purchase and
 // supplier provenance. The historical Return child may repeat a product.
 const returnIds=field(sourceExport,'PURCHASE_RETURN','Return ID');
 const returnPurchaseIds=field(sourceExport,'PURCHASE_RETURN','Purchase ID');
 const returnSupplierIds=field(sourceExport,'PURCHASE_RETURN','Supplier ID');
 const returnItemIds=field(sourceExport,'PURCHASE_RETURN_ITEMS','Return ID');
 const returnItemPurchases=field(sourceExport,'PURCHASE_RETURN_ITEMS','Purchase ID');
 const returnItemProducts=field(sourceExport,'PURCHASE_RETURN_ITEMS','Product ID');
 const returnById=new Map(returnIds.map((id,i)=>[id,returnPurchaseIds[i]]));
 const returnLineCounts=new Map(returnIds.map(id=>[id,0]));
 const returnedProductsById=new Map(returnIds.map(id=>[id,new Set()]));
 // Stock Lots can be purchased, internal, or created during Sales Return
 // restoration; not all original Lot Purchase IDs are Purchase documents.
 const lotProductIds=field(sourceExport,'STOCK_LOTS','Product ID');
 const lotOrigins=field(sourceExport,'STOCK_LOTS','Purchase ID');
 const lotSupplierIds=field(sourceExport,'STOCK_LOTS','Supplier ID');
 const saleReturnIdSet=new Set(field(sourceExport,'SALES_RETURN','Return ID'));
 // These are the two original Purchase.gs / PurchaseReturn.gs stock writers;
 // all other Stock Movement types belong to other workstreams.
 const movementTypes=field(sourceExport,'STOCK_MOVEMENT','Type');
 const movementRefs=field(sourceExport,'STOCK_MOVEMENT','Reference');
 const movementProductIds=field(sourceExport,'STOCK_MOVEMENT','Product ID');
 const movementLotIds=field(sourceExport,'STOCK_MOVEMENT','Lot ID');
 const counts={
  PURCHASE_SUPPLIER_ID_BLANK:0,
  PURCHASE_SUPPLIER_NOT_FOUND:0,
  PURCHASE_ITEM_PARENT_ID_BLANK:0,
  PURCHASE_ITEM_PARENT_NOT_FOUND:0,
  PURCHASE_ITEM_PRODUCT_ID_BLANK:0,
  PURCHASE_ITEM_PRODUCT_NOT_FOUND:0,
  PURCHASE_WITHOUT_ITEMS:0,
  PURCHASE_RETURN_PARENT_ID_BLANK:0,
  PURCHASE_RETURN_PARENT_NOT_FOUND:0,
  PURCHASE_RETURN_SUPPLIER_ID_BLANK:0,
  PURCHASE_RETURN_SUPPLIER_MISMATCH:0,
  PURCHASE_RETURN_ITEM_PARENT_ID_BLANK:0,
  PURCHASE_RETURN_ITEM_PARENT_NOT_FOUND:0,
  PURCHASE_RETURN_ITEM_PURCHASE_ID_BLANK:0,
  PURCHASE_RETURN_ITEM_PURCHASE_MISMATCH:0,
  PURCHASE_RETURN_ITEM_PRODUCT_ID_BLANK:0,
  PURCHASE_RETURN_ITEM_NOT_PURCHASED:0,
  PURCHASE_RETURN_WITHOUT_ITEMS:0,
  LOT_PRODUCT_ID_BLANK:0,
  LOT_PRODUCT_NOT_FOUND:0,
  LOT_ORIGIN_BLANK:0,
  LOT_ORIGIN_UNREVIEWED:0,
  LOT_PURCHASE_PRODUCT_NOT_IN_ITEMS:0,
  LOT_PURCHASE_SUPPLIER_ID_BLANK:0,
  LOT_PURCHASE_SUPPLIER_MISMATCH:0,
  MOVEMENT_PURCHASE_REF_BLANK:0,
  MOVEMENT_PURCHASE_REF_NOT_FOUND:0,
  MOVEMENT_PURCHASE_PRODUCT_NOT_IN_ITEMS:0,
  MOVEMENT_RETURN_REF_BLANK:0,
  MOVEMENT_RETURN_REF_NOT_FOUND:0,
  MOVEMENT_RETURN_PRODUCT_NOT_IN_ITEMS:0,
  MOVEMENT_PRODUCT_ID_BLANK:0,
  MOVEMENT_PRODUCT_NOT_FOUND:0,
  MOVEMENT_LOT_ID_BLANK:0,
  MOVEMENT_LOT_NOT_FOUND:0,
  MOVEMENT_LOT_PRODUCT_MISMATCH:0,
  MOVEMENT_PURCHASE_LOT_ORIGIN_MISMATCH:0
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
  else {
   childCounts.set(purchaseId,childCounts.get(purchaseId)+1);
   if(productId.trim())purchasedProductsById.get(purchaseId).add(productId);
  }
  if(!productId.trim())counts.PURCHASE_ITEM_PRODUCT_ID_BLANK++;
  else if(!productSet.has(productId))counts.PURCHASE_ITEM_PRODUCT_NOT_FOUND++;
 }
 for(const total of childCounts.values())
  if(total===0)counts.PURCHASE_WITHOUT_ITEMS++;

 for(let i=0;i<returnIds.length;i++){
  const purchaseId=returnPurchaseIds[i];
  const supplierId=returnSupplierIds[i];
  if(!purchaseId.trim())counts.PURCHASE_RETURN_PARENT_ID_BLANK++;
  else if(!purchaseSet.has(purchaseId))counts.PURCHASE_RETURN_PARENT_NOT_FOUND++;
  if(!supplierId.trim())counts.PURCHASE_RETURN_SUPPLIER_ID_BLANK++;
  else if(purchaseSet.has(purchaseId)&&supplierId!==purchaseSupplierById.get(purchaseId))
   counts.PURCHASE_RETURN_SUPPLIER_MISMATCH++;
 }
 for(let i=0;i<returnItemIds.length;i++){
  const returnId=returnItemIds[i];
  const purchaseId=returnItemPurchases[i];
  const productId=returnItemProducts[i];
  if(!returnId.trim())counts.PURCHASE_RETURN_ITEM_PARENT_ID_BLANK++;
  else if(!returnById.has(returnId))counts.PURCHASE_RETURN_ITEM_PARENT_NOT_FOUND++;
  else {
   returnLineCounts.set(returnId,returnLineCounts.get(returnId)+1);
   if(productId.trim())returnedProductsById.get(returnId).add(productId);
  }
  if(!purchaseId.trim())counts.PURCHASE_RETURN_ITEM_PURCHASE_ID_BLANK++;
  else if(returnById.has(returnId)&&purchaseId!==returnById.get(returnId))
   counts.PURCHASE_RETURN_ITEM_PURCHASE_MISMATCH++;
  if(!productId.trim())counts.PURCHASE_RETURN_ITEM_PRODUCT_ID_BLANK++;
  else if(returnById.has(returnId)){
   const originalPurchaseId=returnById.get(returnId);
   const purchased=purchasedProductsById.get(originalPurchaseId);
   if(purchased&&!purchased.has(productId))counts.PURCHASE_RETURN_ITEM_NOT_PURCHASED++;
  }
 }
 for(const total of returnLineCounts.values())
  if(total===0)counts.PURCHASE_RETURN_WITHOUT_ITEMS++;

 // The source StockLots.gs recognizes internal stock origins by exact
 // source markers (including OPENING-/ADJUSTMENT- prefixes). Purchase-origin
 // lots must link to that purchase's original Product and Supplier. Other
 // unknown origins are quarantined for review, NEVER auto-linked by name,
 // date, position, or a numeric suffix.
 const internalOrigin=(origin)=>{
  const normalized=origin.trim().toUpperCase();
  return ['OPENING','OPENING-MIGRATION','ADJUSTMENT','LEGACY',
   'OVERSOLD','VENDOR-RETURN-RECEIVED','RETURN'].includes(normalized)||
   normalized.startsWith('OPENING-')||normalized.startsWith('ADJUSTMENT-');
 };
 for(let i=0;i<lotOrigins.length;i++){
  const productId=lotProductIds[i];
  const origin=lotOrigins[i];
  const supplierId=lotSupplierIds[i];
  if(!productId.trim())counts.LOT_PRODUCT_ID_BLANK++;
  else if(!productSet.has(productId))counts.LOT_PRODUCT_NOT_FOUND++;
  if(!origin.trim())counts.LOT_ORIGIN_BLANK++;
  else if(purchaseSet.has(origin)){
   const purchased=purchasedProductsById.get(origin);
   if(productId.trim()&&purchased&&!purchased.has(productId))
    counts.LOT_PURCHASE_PRODUCT_NOT_IN_ITEMS++;
   if(!supplierId.trim())counts.LOT_PURCHASE_SUPPLIER_ID_BLANK++;
   else if(supplierId!==purchaseSupplierById.get(origin))
    counts.LOT_PURCHASE_SUPPLIER_MISMATCH++;
  }else if(!internalOrigin(origin)&&!saleReturnIdSet.has(origin))
   counts.LOT_ORIGIN_UNREVIEWED++;
 }

 // Purchase and Purchase Return Stock Movement IDs are individual source
 // rows, not unique per Purchase; multiple FIFO lots are normal. A Purchase
 // Return can consume a lot from another purchase when original data predates
 // lot tracking, so never require the Return movement lot's purchase origin
 // to equal the returned Purchase's origin.
 const lotIds=field(sourceExport,'STOCK_LOTS','Lot ID');
 const lotById=new Map(lotIds.map((id,i)=>[id,{
  productId:lotProductIds[i],purchaseId:lotOrigins[i]
 }]));
 for(let i=0;i<movementTypes.length;i++){
  const type=movementTypes[i];
  if(type!=='Purchase'&&type!=='Purchase Return')continue;
  const reference=movementRefs[i];
  const productId=movementProductIds[i];
  const lotId=movementLotIds[i];
  if(type==='Purchase'){
   if(!reference.trim())counts.MOVEMENT_PURCHASE_REF_BLANK++;
   else if(!purchaseSet.has(reference))counts.MOVEMENT_PURCHASE_REF_NOT_FOUND++;
   else if(productId.trim()&&!purchasedProductsById.get(reference).has(productId))
    counts.MOVEMENT_PURCHASE_PRODUCT_NOT_IN_ITEMS++;
  }else{
   if(!reference.trim())counts.MOVEMENT_RETURN_REF_BLANK++;
   else if(!returnById.has(reference))counts.MOVEMENT_RETURN_REF_NOT_FOUND++;
   else if(productId.trim()&&!returnedProductsById.get(reference).has(productId))
    counts.MOVEMENT_RETURN_PRODUCT_NOT_IN_ITEMS++;
  }
  if(!productId.trim())counts.MOVEMENT_PRODUCT_ID_BLANK++;
  else if(!productSet.has(productId))counts.MOVEMENT_PRODUCT_NOT_FOUND++;
  if(!lotId.trim())counts.MOVEMENT_LOT_ID_BLANK++;
  else if(!lotById.has(lotId))counts.MOVEMENT_LOT_NOT_FOUND++;
  else{
   const lot=lotById.get(lotId);
   if(productId.trim()&&lot.productId!==productId)
    counts.MOVEMENT_LOT_PRODUCT_MISMATCH++;
   if(type==='Purchase'&&reference.trim()&&purchaseSet.has(reference)&&lot.purchaseId!==reference)
    counts.MOVEMENT_PURCHASE_LOT_ORIGIN_MISMATCH++;
  }
 }

 const sourceGroupFor={
  PURCHASE_SUPPLIER_ID_BLANK:'PURCHASES',
  PURCHASE_SUPPLIER_NOT_FOUND:'PURCHASES',
  PURCHASE_ITEM_PARENT_ID_BLANK:'PURCHASE_ITEMS',
  PURCHASE_ITEM_PARENT_NOT_FOUND:'PURCHASE_ITEMS',
  PURCHASE_ITEM_PRODUCT_ID_BLANK:'PURCHASE_ITEMS',
  PURCHASE_ITEM_PRODUCT_NOT_FOUND:'PURCHASE_ITEMS',
  PURCHASE_WITHOUT_ITEMS:'PURCHASES',
  PURCHASE_RETURN_PARENT_ID_BLANK:'PURCHASE_RETURN',
  PURCHASE_RETURN_PARENT_NOT_FOUND:'PURCHASE_RETURN',
  PURCHASE_RETURN_SUPPLIER_ID_BLANK:'PURCHASE_RETURN',
  PURCHASE_RETURN_SUPPLIER_MISMATCH:'PURCHASE_RETURN',
  PURCHASE_RETURN_ITEM_PARENT_ID_BLANK:'PURCHASE_RETURN_ITEMS',
  PURCHASE_RETURN_ITEM_PARENT_NOT_FOUND:'PURCHASE_RETURN_ITEMS',
  PURCHASE_RETURN_ITEM_PURCHASE_ID_BLANK:'PURCHASE_RETURN_ITEMS',
  PURCHASE_RETURN_ITEM_PURCHASE_MISMATCH:'PURCHASE_RETURN_ITEMS',
  PURCHASE_RETURN_ITEM_PRODUCT_ID_BLANK:'PURCHASE_RETURN_ITEMS',
  PURCHASE_RETURN_ITEM_NOT_PURCHASED:'PURCHASE_RETURN_ITEMS',
  PURCHASE_RETURN_WITHOUT_ITEMS:'PURCHASE_RETURN',
  LOT_PRODUCT_ID_BLANK:'STOCK_LOTS',
  LOT_PRODUCT_NOT_FOUND:'STOCK_LOTS',
  LOT_ORIGIN_BLANK:'STOCK_LOTS',
  LOT_ORIGIN_UNREVIEWED:'STOCK_LOTS',
  LOT_PURCHASE_PRODUCT_NOT_IN_ITEMS:'STOCK_LOTS',
  LOT_PURCHASE_SUPPLIER_ID_BLANK:'STOCK_LOTS',
  LOT_PURCHASE_SUPPLIER_MISMATCH:'STOCK_LOTS',
  MOVEMENT_PURCHASE_REF_BLANK:'STOCK_MOVEMENT',
  MOVEMENT_PURCHASE_REF_NOT_FOUND:'STOCK_MOVEMENT',
  MOVEMENT_PURCHASE_PRODUCT_NOT_IN_ITEMS:'STOCK_MOVEMENT',
  MOVEMENT_RETURN_REF_BLANK:'STOCK_MOVEMENT',
  MOVEMENT_RETURN_REF_NOT_FOUND:'STOCK_MOVEMENT',
  MOVEMENT_RETURN_PRODUCT_NOT_IN_ITEMS:'STOCK_MOVEMENT',
  MOVEMENT_PRODUCT_ID_BLANK:'STOCK_MOVEMENT',
  MOVEMENT_PRODUCT_NOT_FOUND:'STOCK_MOVEMENT',
  MOVEMENT_LOT_ID_BLANK:'STOCK_MOVEMENT',
  MOVEMENT_LOT_NOT_FOUND:'STOCK_MOVEMENT',
  MOVEMENT_LOT_PRODUCT_MISMATCH:'STOCK_MOVEMENT',
  MOVEMENT_PURCHASE_LOT_ORIGIN_MISMATCH:'STOCK_MOVEMENT'
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
   products:products.length,
   purchaseReturns:returnIds.length,
   purchaseReturnItems:returnItemIds.length,
   stockLots:lotOrigins.length,
   stockMovements:movementTypes.length
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
