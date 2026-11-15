/**
 * M06 pure source-parity original POS bootstrap, including Bundle cards.
 *
 * Uses the merged Standard-only POS read projection and source-exact Bundle
 * recipe helpers. The future M04/M03 caller MUST authenticate pos.view and
 * tenant scope BEFORE reading sensitive source-shaped rows. No RPC, D1,
 * inventory reservations, financial posting or mutation lives here.
 */
import {projectStandardPosBootstrap} from './pos-bootstrap-standard.js';
import {
  bundleProductType_,getBundleDefinitions_,getBundleAvailability_
} from './pos-bundle-catalog.js';

const deleted=row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE';

/**
 * @param {object} snapshot Trusted read-only POS bootstrap snapshot from the
 *   internal server, including explicit source BUNDLE_COMPONENTS rows.
 * @returns {object} Original getPosBootstrap data payload (not RPC envelope).
 */
export function projectPosBootstrapWithBundles(snapshot){
  if(!snapshot || typeof snapshot!=='object' ||
    !Array.isArray(snapshot.productRows) ||
    !Array.isArray(snapshot.bundleComponentRows)){
    throw new TypeError('Missing trusted Bundle POS bootstrap snapshot');
  }

  // Original getPosBootstrap chooses only active, non-Inactive products.
  // The separately reviewed Standard projector must not process Bundles.
  const visible=snapshot.productRows.filter(p=>!deleted(p) && p.Status!=='Inactive');
  const standardRows=snapshot.productRows
    .filter(p=>bundleProductType_(p)!=='Bundle')
    .map(p=>{
      // Source treats any Product Type other than literal Bundle as Standard.
      const type=String(p['Product Type']||'').trim();
      return type && type!=='Standard'?{...p,'Product Type':'Standard'}:p;
    });
  const base=projectStandardPosBootstrap({...snapshot,productRows:standardRows});

  const productsById={};
  visible.forEach(p=>{productsById[p['Product ID']]=p;});
  let standardIndex=0;
  const products=[];
  for(const p of visible){
    if(bundleProductType_(p)!=='Bundle'){
      products.push(base.products[standardIndex++]);
      continue;
    }
    const id=p['Product ID'];
    let recipe;
    try{
      recipe=getBundleDefinitions_([id],productsById,snapshot.bundleComponentRows)[id];
    }catch(_err){
      // Original POS omits an invalid/unavailable Bundle card, rather than
      // emitting a partially sellable line or hiding unrelated products.
      continue;
    }
    const sellPrice=Number(p['Selling Price'])||0;
    const card={
      id,name:p['Product Name'],brand:p.Brand||'',unit:p.Unit,
      barcode:p.Barcode||'',sellingPrice:sellPrice,lotPricing:[],
      fallbackSellPrice:sellPrice,autoSellingPrice:sellPrice,
      stock:getBundleAvailability_(recipe,productsById),
      category:p.Category,productType:'Bundle',bundleRevision:recipe.revision
    };
    if(base.showPurchasePrice)card.purchasePrice=Number(p['Purchase Price'])||0;
    products.push(card);
  }
  return {...base,products};
}
