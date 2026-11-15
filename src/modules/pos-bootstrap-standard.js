/**
 * M06: source-faithful, Standard-product POS bootstrap projection.
 *
 * Pure INTERNAL read model only. The future M04/M03 RPC adapter must enforce
 * authenticated pos.view and tenant scope BEFORE acquiring these snapshots.
 * actorPermissions here MUST come from verified server-side RBAC, never input
 * submitted by a browser. Source: pinned Sales.gs::getPosBootstrap.
 *
 * Bundle product availability requires the reviewed M05 component planner;
 * this smaller Standard-only contract refuses bundles rather than inventing
 * stock quantities. Cash, Bank, inventory and ledgers are never written.
 */
import {buildLotPricingLadder_} from './stock-fifo-planning.js';

const object=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);

const isDeleted=row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE';
const active=rows=>rows.filter(row=>!isDeleted(row));

function isSettingEnabled_(value,defaultWhenUnset){
  if(value===true)return true;
  if(value===false)return false;
  const string=String(value===null||value===undefined?'':value).trim().toLowerCase();
  if(string==='true')return true;
  if(string==='false')return false;
  return defaultWhenUnset===true;
}

const normalizeRelationType=value=>String(value||'').trim()==='Husband'?'Husband':'Father';

/**
 * Caller-owned trusted snapshot (no D1 read or RPC path in this module).
 * Use only in authorized server code where actorPermissions is server-derived.
 */
export function projectStandardPosBootstrap(snapshot){
  if(!object(snapshot) || !Array.isArray(snapshot.productRows) ||
    !Array.isArray(snapshot.customerRows) || !Array.isArray(snapshot.stockLots) ||
    !Array.isArray(snapshot.vendors) || !Array.isArray(snapshot.vendorsAll) ||
    !Array.isArray(snapshot.bankAccounts) || !object(snapshot.settings) ||
    !object(snapshot.actorPermissions) || !object(snapshot.sessionResult)){
    throw new TypeError('Missing trusted POS bootstrap snapshot');
  }

  const permissions=snapshot.actorPermissions;
  if(permissions.posView!==true)throw new Error('POS view permission denied');

  const products=active(snapshot.productRows).filter(p=>p['Status']!=='Inactive');
  if(products.some(p=>String(p['Product Type']||'').trim()==='Bundle')){
    throw new Error('Bundle stock availability requires approved component planning');
  }

  const settings=snapshot.settings;
  const session=snapshot.sessionResult;
  if(!session.success){
    throw new Error(session.message||'Unable to verify the active cash session.');
  }
  const showPurchasePrice=
    isSettingEnabled_(settings['POS Show Purchase Price']) &&
    permissions.posCostView===true;

  const productOptions=products.map(p=>{
    const pricing=buildLotPricingLadder_(p['Product ID'],snapshot.stockLots,p);
    const output={
      id:p['Product ID'],
      name:p['Product Name'],
      brand:p['Brand']||'',
      unit:p['Unit'],
      barcode:p['Barcode']||'',
      sellingPrice:Number(p['Selling Price'])||0,
      lotPricing:pricing.segments,
      fallbackSellPrice:pricing.fallbackSellPrice,
      autoSellingPrice:pricing.autoSellingPrice,
      stock:Number(p['Current Stock'])||0,
      category:p['Category'],
      productType:'Standard',
      bundleRevision:0
    };
    // Critical privacy invariant: omit the PROPERTY entirely if either gate
    // fails. Concealing a rendered field after transmission is not security.
    if(showPurchasePrice)output.purchasePrice=Number(p['Purchase Price'])||0;
    return output;
  });

  return {
    products:productOptions,
    showPurchasePrice,
    canViewCurrentInvoiceProfit:
      permissions.reportsView===true||permissions.posCostView===true,
    multiPaymentEnabled:
      String(settings['POS Multi Payment Enabled']||'').toLowerCase()==='true',
    customers:active(snapshot.customerRows).map(c=>({
      id:c['Customer ID'],
      name:c['Customer Name'],
      phone:c['Phone'],
      address:c['Address'],
      fatherName:c['Father Name']||'',
      relationType:normalizeRelationType(c['Relation Type']),
      due:Number(c['Current Due'])||0
    })),
    vendors:snapshot.vendors,
    vendorsAll:snapshot.vendorsAll,
    bankAccounts:snapshot.bankAccounts,
    activeSession:session.data,
    shopName:settings['Shop Name']||'Hardware Store ERP',
    currencySymbol:settings['Currency Symbol']||'',
    taxPercent:Number(settings['Tax Percent'])||0
  };
}
