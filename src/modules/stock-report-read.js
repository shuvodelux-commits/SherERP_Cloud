/**
 * M09 internal Stock & Valuation report read projection.
 *
 * Mirrors frozen Reports.gs::getStockReport. The future authorized reader
 * must provide already-active/nondeleted Products (including Inactive Status)
 * and every source-equivalent STOCK_LOTS row. The lot ledger is authoritative
 * evidence; this module reports stock mismatch, it never fixes stock.
 * No authentication, D1 access, RPC registration, mutation or hidden cache.
 */

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
     Object.getPrototypeOf(value)===null);
}
function own(row,key){
  const d=Object.getOwnPropertyDescriptor(row,key);
  if(d && !Object.hasOwn(d,'value'))
    throw new TypeError('Untrusted Stock Report accessor: '+key);
  return d?.value;
}
function trustedRows(snapshot,key){
  const data=own(snapshot,key);
  if(!Array.isArray(data))
    throw new TypeError('Trusted Stock Report snapshot needs '+key+' array');
  for(const row of data){
    if(!plain(row) ||
      Object.values(Object.getOwnPropertyDescriptors(row))
        .some(d=>!Object.hasOwn(d,'value')))
      throw new TypeError('Invalid trusted Stock Report row in '+key);
  }
  return data;
}
function number(value,key){
  if(value!==undefined && value!==null &&
    !['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid trusted Stock Report '+key+' number');
  const n=Number(value);
  if(!Number.isFinite(n) && !Number.isNaN(n))
    throw new TypeError('Expected finite Stock Report '+key+' number');
  return n||0;
}
function id(value){
  if(typeof value!=='string' || !value.trim())
    throw new TypeError('Invalid trusted Stock Report Product ID');
  return value;
}
function sortedByDesc(group,key){
  return Object.keys(group).map(k=>group[k])
    .sort((a,b)=>(Number(b[key])||0)-(Number(a[key])||0));
}

/**
 * Full frozen getStockReport response. Unlike dated Reports this has no
 * date filter; valuation uses remaining lot cost, not product purchase price.
 */
export function projectStockReport(snapshot){
  if(!plain(snapshot))
    throw new TypeError('Missing trusted Stock Report snapshot');
  const products=trustedRows(snapshot,'activeProducts');
  const lots=trustedRows(snapshot,'stockLots');

  const lotValueByProduct=new Map(),lotQtyByProduct=new Map();
  for(const lot of lots){
    const productId=id(own(lot,'Product ID'));
    const qty=number(own(lot,'Remaining Quantity'),'remaining quantity');
    const price=number(own(lot,'Purchase Price'),'lot purchase price');
    if(qty<=0)continue;
    lotValueByProduct.set(productId,(lotValueByProduct.get(productId)||0)+qty*price);
    lotQtyByProduct.set(productId,(lotQtyByProduct.get(productId)||0)+qty);
  }

  let totalValue=0,totalRetailValue=0,lowStockCount=0,outOfStockCount=0,activeCount=0;
  const selected=new Set();
  const rows=products.map(p=>{
    const rawId=own(p,'Product ID'),productId=id(rawId);
    if(selected.has(productId))
      throw new Error('Duplicate Product ID in Stock Report: '+productId);
    selected.add(productId);
    const stock=number(own(p,'Current Stock'),'current stock');
    const minStock=number(own(p,'Minimum Stock'),'minimum stock');
    const purchasePrice=number(own(p,'Purchase Price'),'purchase price');
    const sellingPrice=number(own(p,'Selling Price'),'selling price');
    const lotValue=lotValueByProduct.get(productId)||0;
    const lotQuantity=lotQtyByProduct.get(productId)||0;
    const retailValue=stock*sellingPrice;
    const status=own(p,'Status');
    const active=status!=='Inactive';

    if(active){
      activeCount++;
      totalValue+=lotValue;
      totalRetailValue+=retailValue;
      if(stock<=0)outOfStockCount++;
      else if(stock<=minStock)lowStockCount++;
    }

    return {
      productId:rawId,
      name:own(p,'Product Name'),
      category:own(p,'Category')||'Uncategorized',
      unit:own(p,'Unit')||'',
      stock,minStock,purchasePrice,sellingPrice,
      lotQuantity,lotValue,retailValue,
      status:status||'Active',
      lotMismatch:active && lotQuantity!==stock
    };
  }).sort((a,b)=>b.lotValue-a.lotValue);

  const byCategory=Object.create(null);
  for(const row of rows){
    if(row.status==='Inactive')continue;
    const category=row.category;
    // Keep labels as source strings; the result is a read-only grouping,
    // not a source for SQL identifiers or Party identity matching.
    if(!byCategory[category])
      byCategory[category]={label:category,products:0,stock:0,value:0};
    byCategory[category].products++;
    byCategory[category].stock+=row.stock;
    byCategory[category].value+=row.lotValue;
  }
  return {
    totals:{
      products:products.length,
      activeProducts:activeCount,
      inventoryValue:totalValue,
      retailValue:totalRetailValue,
      potentialMargin:totalRetailValue-totalValue,
      lowStockCount,outOfStockCount,
      mismatchCount:rows.filter(row=>row.lotMismatch).length
    },
    byCategory:sortedByDesc(byCategory,'value'),
    products:rows,
    lowStock:rows.filter(row=>row.status!=='Inactive' && row.stock<=row.minStock)
  };
}
