/**
 * M05 INTERNAL, READ-ONLY source-backed purchase unit snapshot conservation.
 *
 * The snapshot is an *historical* candidate from an already trusted M05
 * server-side preflight; this mathematical review is NOT source
 * authentication, a live D1 import, a posting authorization or a unit
 * conversion catalog lookup. NEVER substitute today's conversion factors
 * or unit prices for historical snapshot evidence.
 *
 * Original purchase: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * Optional multi-unit source: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
 */
const TOLERANCE=0.0000001;
const SUBTOTAL_TOLERANCE=0.004;
const roundMoney=value=>Math.round((value+Number.EPSILON)*100)/100;

function plain(value){
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const prototype=Object.getPrototypeOf(value);
  return (prototype===Object.prototype || prototype===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}
const finite=value=>typeof value==='number' && Number.isFinite(value);
const positive=value=>finite(value) && value>0;
const nonnegative=value=>finite(value) && value>=0;
const nonempty=value=>typeof value==='string' && value.trim().length>0;

function checkRows(rows,label){
  if(!Array.isArray(rows)||rows.some(row=>!plain(row)))
    throw new TypeError('Invalid trusted '+label+' snapshot or accessor.');
}

/**
 * Consistency review of an in-memory *trusted* mixed-unit preflight result.
 * Absence of the optional line.unit property retains legacy single-unit
 * behavior; explicit null or broken unit evidence is not a legacy fallback.
 *
 * The result records problems for independent source review, never repairs
 * the supplied candidate and never returns a posting plan.
 */
export function auditMultiUnitPurchaseSnapshot(preflight){
  if(!plain(preflight)||!Array.isArray(preflight.lines))
    throw new TypeError('Explicit trusted purchase preflight snapshot required.');
  checkRows(preflight.lines,'purchase line');

  const issues=[];
  const issue=(code,index,productId='')=>issues.push({code,line:index,productId});
  const seenProducts=new Set();
  const summary={
    lines:preflight.lines.length,unitLines:0,legacyLines:0,
    auditedBaseQuantity:0,auditedUnitLineTotal:0,
    amountTolerance:TOLERANCE
  };
  let runningSubtotal=0,subtotalVerifiable=true;
  if(preflight.lines.length===0)issue('EMPTY_PURCHASE_LINES',-1);

  for(const [index,line] of preflight.lines.entries()){
    const productId=nonempty(line.productId)?line.productId:'';
    if(!productId)issue('INVALID_PURCHASE_PRODUCT_ID',index);
    else if(seenProducts.has(productId))issue('DUPLICATE_PURCHASE_PRODUCT',index,productId);
    if(productId)seenProducts.add(productId);

    if(!positive(line.qty)||!nonnegative(line.price)){
      issue('INVALID_BASE_LINE_AMOUNT',index,productId);
      subtotalVerifiable=false;
    }

    if(!Object.hasOwn(line,'unit')){
      summary.legacyLines++;
      if(positive(line.qty)&&nonnegative(line.price)){
        const amount=line.qty*line.price;
        if(!Number.isFinite(amount)){
          issue('INVALID_BASE_LINE_AMOUNT',index,productId);
          subtotalVerifiable=false;
        }else runningSubtotal+=amount;
      }
      continue;
    }

    summary.unitLines++;
    const unit=line.unit;
    if(!plain(unit) || !nonempty(unit.stockUnit) ||
      !Array.isArray(unit.unitSnapshot) ||
      !Array.isArray(unit.pricingSnapshot) ||
      unit.unitSnapshot.length===0 ||
      unit.unitSnapshot.length!==unit.pricingSnapshot.length){
      issue('INCOMPLETE_UNIT_SNAPSHOT',index,productId);
      subtotalVerifiable=false;
      continue;
    }

    checkRows(unit.unitSnapshot,'unit component');
    checkRows(unit.pricingSnapshot,'unit pricing component');

    const seenUnits=new Set();
    let quantity=0,rawTotal=0,componentsValid=true;
    for(let i=0;i<unit.unitSnapshot.length;i++){
      const component=unit.unitSnapshot[i];
      const pricing=unit.pricingSnapshot[i];
      if(!nonempty(component.conversionId)||!nonempty(component.unitName) ||
        !positive(component.factor)||!positive(component.qty)){
        issue('INVALID_UNIT_COMPONENT',index,productId);
        componentsValid=false;
      }
      if(!nonnegative(pricing.unitPrice)){
        issue('INVALID_UNIT_PRICE',index,productId);
        componentsValid=false;
      }
      if(nonempty(component.conversionId)){
        if(seenUnits.has(component.conversionId)){
          issue('DUPLICATE_UNIT_CONVERSION',index,productId);
          componentsValid=false;
        }
        seenUnits.add(component.conversionId);
      }
      if(component.conversionId!==pricing.conversionId ||
        component.unitName!==pricing.unitName ||
        component.factor!==pricing.factor ||
        component.qty!==pricing.qty){
        issue('COMPONENT_MISMATCH',index,productId);
        componentsValid=false;
      }
      if(positive(component.factor)&&positive(component.qty) &&
        nonnegative(pricing.unitPrice)){
        quantity+=component.factor*component.qty;
        rawTotal+=component.qty*pricing.unitPrice;
        if(!Number.isFinite(quantity)||!Number.isFinite(rawTotal)){
          issue('INVALID_UNIT_COMPONENT',index,productId);
          componentsValid=false;
        }
      }
    }

    // Quantity is independently reviewable even when the parallel pricing
    // component identity disagrees. Do not suppress a base-quantity drift
    // simply because the same line has a second snapshot discrepancy.
    if(unit.unitSnapshot.every(component=>positive(component.factor)&&
      positive(component.qty)) && Number.isFinite(quantity) &&
      (!positive(line.qty)||Math.abs(quantity-line.qty)>TOLERANCE)){
      issue('BASE_QUANTITY_MISMATCH',index,productId);
    }

    if(!nonnegative(unit.lineTotal)){
      issue('INVALID_UNIT_LINE_TOTAL',index,productId);
      componentsValid=false;
    }

    if(componentsValid){
      const expectedTotal=roundMoney(rawTotal);
      if(!Number.isFinite(expectedTotal)){
        issue('INVALID_UNIT_LINE_TOTAL',index,productId);
        subtotalVerifiable=false;
        continue;
      }
      summary.auditedBaseQuantity+=quantity;
      summary.auditedUnitLineTotal+=expectedTotal;
      runningSubtotal+=expectedTotal;
      if(Math.abs(expectedTotal-unit.lineTotal)>TOLERANCE){
        issue('UNIT_LINE_TOTAL_MISMATCH',index,productId);
      }
      if(!positive(line.qty)||!nonnegative(line.price)||
        Math.abs(line.qty*line.price-unit.lineTotal)>TOLERANCE){
        issue('BASE_UNIT_COST_MISMATCH',index,productId);
      }
    }else subtotalVerifiable=false;
  }

  if(!nonnegative(preflight.subtotal))issue('INVALID_PURCHASE_SUBTOTAL',-1);
  else if(subtotalVerifiable &&
    (!Number.isFinite(runningSubtotal) ||
      Math.abs(runningSubtotal-preflight.subtotal)>SUBTOTAL_TOLERANCE)){
    issue('PURCHASE_SUBTOTAL_MISMATCH',-1);
  }

  return {ready:issues.length===0,issues,summary};
}
