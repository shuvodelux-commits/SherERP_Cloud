/**
 * M05 INTERNAL Products page bootstrap projection.
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * Products.gs::getProductsBootstrap and Bundles.gs recipe functions.
 *
 * Caller must authorize products.view and tenant-scope ALL trusted source
 * snapshots before calling. This module has no DB, RPC, posting or mutation.
 * The M09 Stock Report intentionally uses a different valuation contract.
 */
function plain(value){
  if(!value || typeof value!=='object' || Array.isArray(value))return false;
  const proto=Object.getPrototypeOf(value);
  return (proto===Object.prototype || proto===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(
      descriptor=>Object.hasOwn(descriptor,'value'));
}

function sourceRows(snapshot,key){
  const value=snapshot[key];
  if(!Array.isArray(value))
    throw new TypeError('Explicit trusted '+key+' snapshot array required.');
  if(value.some(row=>!plain(row)))
    throw new TypeError('Invalid trusted '+key+' row or accessor.');
  return value;
}

function primitive(value,label){
  if(value!=null && !['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid trusted '+label+' source value.');
  return value;
}

function valueNumber(value,label){
  const raw=primitive(value,label);
  const number=Number(raw);
  if(!Number.isFinite(number) && !Number.isNaN(number))
    throw new TypeError('Invalid '+label+' nonfinite number in trusted source snapshot.');
  return number||0;
}

function unique(rows,field,label){
  const keys=new Set();
  for(const row of rows){
    const id=primitive(row[field],label+' ID');
    if((typeof id==='string' && !id.trim()) || id===undefined || id===null || id===''){
      throw new Error('Missing '+label+' ID in source snapshot.');
    }
    if(typeof id==='number' && !Number.isFinite(id))
      throw new Error('Missing '+label+' ID in source snapshot.');
    const key=String(id);
    if(keys.has(key))
      throw new Error('Duplicate '+label+' ID in source snapshot: '+key);
    keys.add(key);
  }
  return rows;
}

function sourceDeleted(row){
  return row['Is Deleted']===true ||
    String(primitive(row['Is Deleted'],'Is Deleted')||'').toUpperCase()==='TRUE';
}

function bundleProductType(row){
  return String(primitive(row?.['Product Type'],'Product Type')||'').trim()==='Bundle'
    ?'Bundle':'Standard';
}

function storedDefinition(id,revision,rows){
  const rev=valueNumber(revision,'bundle revision')||1;
  return {
    bundleId:String(id),revision:rev,
    components:rows.filter(row=>{
      return String(primitive(row['Bundle Product ID'],'Bundle Product ID'))===String(id) &&
        valueNumber(row.Revision,'recipe revision')===rev &&
        String(primitive(row.Status,'recipe status')||'').toLowerCase()==='active';
    }).map(row=>({
      productId:String(primitive(row['Component Product ID'],'component product ID')||''),
      qtyPerSet:valueNumber(row['Quantity Per Set'],'recipe quantity'),
      unit:String(primitive(row.Unit,'recipe unit')||'')
    }))
  };
}

function recipeDefinition(id,product,recipes,productMap){
  const revision=valueNumber(product['Bundle Revision'],'bundle revision')||1;
  const components=recipes.filter(row=>{
    return String(primitive(row['Bundle Product ID'],'Bundle Product ID')||'')===String(id) &&
      valueNumber(row.Revision,'recipe revision')===revision &&
      String(primitive(row.Status,'recipe status')||'').toLowerCase()==='active';
  }).map(row=>({
    productId:String(primitive(row['Component Product ID'],'component ID')||''),
    qtyPerSet:valueNumber(row['Quantity Per Set'],'recipe quantity'),
    unit:String(primitive(row.Unit,'recipe unit')||'')
  }));

  if(!components.length)throw new Error('Bundle recipe unavailable: '+id);
  const seen=new Set();
  const valid=components.map(component=>{
    const pid=String(component.productId||'').trim();
    const qty=component.qtyPerSet;
    const physical=productMap.get(pid);
    if(!pid || !physical)throw new Error('Bundle component product was not found.');
    if(pid===String(id) || bundleProductType(physical)!=='Standard')
      throw new Error('A bundle can contain only a standard product.');
    if(String(primitive(physical.Status,'product status')||'').toLowerCase()!=='active' ||
       String(primitive(physical['Is Deleted'],'Is Deleted')||'').toUpperCase()==='TRUE')
      throw new Error('Bundle component must be active: '+pid);
    if(!Number.isFinite(qty) || qty<=0)
      throw new Error('Bundle component quantity must be finite and greater than zero.');
    if(qty>1000000000)
      throw new Error('Bundle component quantity exceeds maximum allowed.');
    if(seen.has(pid))
      throw new Error('A component appears more than once; combine quantities.');
    seen.add(pid);
    return {
      productId:pid,qtyPerSet:qty,
      unit:String(primitive(physical.Unit,'product unit')||component.unit||'pcs')
    };
  });
  return {bundleId:String(id),revision,components:valid};
}

function availableSets(definition,productMap){
  if(!definition?.components?.length)return 0;
  return Math.max(0,Math.min(...definition.components.map(component=>{
    const physical=productMap.get(component.productId);
    const stock=valueNumber(physical?.['Current Stock'],'product stock');
    return Math.floor(Math.max(0,stock)/component.qtyPerSet);
  })));
}

const internalUnpriced=source=>source==='OPENING' ||
  source==='OPENING-MIGRATION' || source==='ADJUSTMENT' ||
  source==='LEGACY' || source.startsWith('OPENING-') ||
  source.startsWith('ADJUSTMENT-');

/**
 * Preserve all Products.gs fields and valuation rules, including historical
 * deleted stock-lot rows considered by the frozen getAllRows_ call.
 * Never interpret these display values as permission to correct stock.
 */
export function projectProductsBootstrap(snapshot){
  if(!plain(snapshot))
    throw new TypeError('Trusted Products Bootstrap snapshot required.');
  const productRows=sourceRows(snapshot,'productRows');
  const stockLots=sourceRows(snapshot,'stockLots');
  const bundleComponentRows=sourceRows(snapshot,'bundleComponentRows');
  const categoryRows=sourceRows(snapshot,'categoryRows');
  const unitRows=sourceRows(snapshot,'unitRows');
  if(!plain(snapshot.settings))
    throw new TypeError('Trusted Products Bootstrap settings map required.');

  const products=unique(productRows.filter(row=>!sourceDeleted(row)),
    'Product ID','product');
  const categories=unique(categoryRows.filter(row=>row.Status!=='Inactive'),
    'Category ID','category');
  const units=unique(unitRows.filter(row=>row.Status!=='Inactive'),
    'Unit ID','unit');
  unique(stockLots,'Lot ID','lot');

  const productMap=new Map(products.map(row=>[String(row['Product ID']),row]));
  const lotStats=new Map();
  for(const row of stockLots){
    const productId=primitive(row['Product ID'],'lot product ID');
    if(!productId)continue;
    const pid=String(productId);
    const qty=valueNumber(row['Remaining Quantity'],'remaining quantity');
    const cost=valueNumber(row['Purchase Price'],'lot purchase price');
    const source=String(primitive(row['Purchase ID'],'purchase source')||'').toUpperCase();
    const stats=lotStats.get(pid)||{
      qty:0,value:0,unpricedInternalQty:0,unpricedInternalLotCount:0
    };
    stats.qty+=qty;
    stats.value+=qty*cost;
    if(qty>0 && cost===0 && internalUnpriced(source)){
      stats.unpricedInternalQty+=qty;
      stats.unpricedInternalLotCount++;
    }
    lotStats.set(pid,stats);
  }

  const bundleDefinitions=new Map(),bundleErrors=new Map();
  for(const product of products){
    if(bundleProductType(product)!=='Bundle')continue;
    const id=product['Product ID'];
    try{
      bundleDefinitions.set(id,recipeDefinition(id,product,bundleComponentRows,productMap));
    }catch(error){
      bundleErrors.set(id,error.message);
      bundleDefinitions.set(id,storedDefinition(
        id,product['Bundle Revision'],bundleComponentRows));
    }
  }

  const valuedProducts=products.map(row=>{
    const id=row['Product ID'];
    const isBundle=bundleProductType(row)==='Bundle';
    const stock=isBundle?0:valueNumber(row['Current Stock'],'product stock');
    const cost=valueNumber(row['Purchase Price'],'product purchase price');
    const stats=lotStats.get(String(id));
    let stockValue;
    if(!stats){
      stockValue=stock*cost;
    }else{
      stockValue=stats.value;
      if(stats.qty<=stock){
        const gap=Math.max(0,stock-stats.qty);
        stockValue+=(stats.unpricedInternalQty+gap)*cost;
      }
    }
    const definition=bundleDefinitions.get(id);
    const error=bundleErrors.get(id)||'';
    return {
      ...row,
      'Product Type':isBundle?'Bundle':'Standard',
      'Bundle Components':isBundle?definition.components:[],
      'Bundle Error':isBundle?error:'',
      'Available Sets':isBundle&&!error?availableSets(definition,productMap):0,
      'Stock Value':isBundle?0:stockValue,
      'Unpriced Lot Count':stats?(stats.unpricedInternalLotCount||0):0,
      'Unpriced Remaining Quantity':stats?(stats.unpricedInternalQty||0):0
    };
  });

  return {
    products:valuedProducts,
    categories:categories.map(row=>({
      id:row['Category ID'],name:row['Category Name']
    })),
    units:units.map(row=>({
      id:row['Unit ID'],name:row['Unit Name']
    })),
    currencySymbol:snapshot.settings['Currency Symbol']||'',
    lowStockThreshold:valueNumber(snapshot.settings['Low Stock Threshold'],
      'low stock threshold')||5
  };
}
