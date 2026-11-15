/**
 * M09 internal Dashboard low-stock tile from frozen Dashboard.gs.
 * Caller supplies already activeRows_('PRODUCTS')-filtered source rows;
 * this pure function does not authorize, access D1, post stock or add RPC.
 */

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
     Object.getPrototypeOf(value)===null);
}

function safeRecord(value,label){
  try{
    if(!plain(value))throw new TypeError('Invalid trusted '+label);
    for(const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))){
      if(!Object.hasOwn(descriptor,'value'))
        throw new TypeError('Invalid trusted '+label+' accessor');
      const v=descriptor.value;
      if(v!==null && !['undefined','string','number','boolean'].includes(typeof v))
        throw new TypeError('Invalid trusted '+label+' field');
      if(typeof v==='number' && !Number.isFinite(v) && !Number.isNaN(v))
        throw new TypeError('Invalid trusted '+label+' number');
    }
    return value;
  }catch{
    throw new TypeError('Invalid trusted '+label);
  }
}

function stockNumber(value){
  // Frozen source uses Number(value) directly: blanks and null are zero,
  // NaN/missing cells compare false, including nonnumeric scalar strings.
  const number=Number(value);
  if(number===Infinity || number===-Infinity)
    throw new TypeError('Invalid trusted product stock number');
  return number;
}

export function projectDashboardLowStockCount(snapshot){
  if(!plain(snapshot) || Reflect.ownKeys(snapshot).length!==1)
    throw new TypeError('Invalid trusted Dashboard low-stock snapshot');
  const descriptor=Object.getOwnPropertyDescriptor(snapshot,'activeProducts');
  if(!descriptor || !Object.hasOwn(descriptor,'value') ||
     !Array.isArray(descriptor.value) ||
     Object.getPrototypeOf(descriptor.value)!==Array.prototype)
    throw new TypeError('Invalid trusted Dashboard products array');
  const products=descriptor.value;
  // Never execute index accessors or silently ignore sparse rows.
  const descriptors=Object.getOwnPropertyDescriptors(products);
  for(let i=0;i<products.length;i++){
    if(!Object.hasOwn(descriptors,String(i)) ||
       !Object.hasOwn(descriptors[String(i)],'value'))
      throw new TypeError('Invalid trusted Dashboard products array');
  }
  let count=0;
  for(const entry of products){
    const row=safeRecord(entry,'product row');
    if(row.Status==='Inactive')continue;
    if(stockNumber(row['Current Stock'])<=stockNumber(row['Minimum Stock']))
      count++;
  }
  return count;
}
