/**
 * M09 INTERNAL source-faithful Dashboard gross Customer AR / Supplier AP tiles.
 * Inputs must already be trusted activeRows_('CUSTOMERS'/'SUPPLIERS') from
 * one authenticated shop. This module cannot join or net Party roles, query
 * D1, authorize a public RPC, or post financial transactions.
 */
const SOURCES=new Set(['activeCustomers','activeSuppliers']);

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
     Object.getPrototypeOf(value)===null);
}
function trustedRows(value,label){
  if(!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype)
    throw new TypeError('Invalid trusted '+label+' array');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(let i=0;i<value.length;i++){
    const indexed=descriptors[String(i)];
    if(!indexed || !Object.hasOwn(indexed,'value'))
      throw new TypeError('Invalid trusted '+label+' array slot');
    const row=indexed.value;
    if(!plain(row))throw new TypeError('Invalid trusted '+label+' row');
    for(const entry of Object.values(Object.getOwnPropertyDescriptors(row))){
      if(!Object.hasOwn(entry,'value'))
        throw new TypeError('Invalid trusted '+label+' row accessor');
      const v=entry.value;
      if(v!==null && !['undefined','number','boolean','string'].includes(typeof v))
        throw new TypeError('Invalid trusted '+label+' row field');
      if(typeof v==='number' && !Number.isFinite(v) && !Number.isNaN(v))
        throw new TypeError('Invalid trusted '+label+' row amount');
    }
  }
  return value;
}

function gross(rows,label){
  let sum=0;
  for(const row of trustedRows(rows,label)){
    const raw=Object.getOwnPropertyDescriptor(row,'Current Due')?.value;
    // Source: Math.max(0, Number(row['Current Due']) || 0).
    const value=Number(raw);
    if(!Number.isFinite(value) && !Number.isNaN(value))
      throw new TypeError('Invalid trusted '+label+' Current Due amount');
    sum+=Math.max(0,value||0);
  }
  return Math.round((sum+Number.EPSILON)*100)/100;
}

/**
 * The two source Dashboard figures are independent GROSS view amounts:
 * positive Customer Current Due != Supplier Current Due, even when the
 * Customer and Supplier happen to reference the same person/business.
 */
export function projectDashboardGrossDues(snapshot){
  if(!plain(snapshot))throw new TypeError('Invalid trusted gross dues snapshot');
  const keys=Reflect.ownKeys(snapshot);
  if(keys.length!==2 || keys.some(x=>typeof x!=='string'||!SOURCES.has(x)))
    throw new TypeError('Invalid trusted gross dues snapshot fields');
  const customer=Object.getOwnPropertyDescriptor(snapshot,'activeCustomers');
  const supplier=Object.getOwnPropertyDescriptor(snapshot,'activeSuppliers');
  if(!customer || !supplier || !Object.hasOwn(customer,'value') ||
     !Object.hasOwn(supplier,'value'))
    throw new TypeError('Invalid trusted gross dues snapshot descriptor');

  return {
    dueReceivable:gross(customer.value,'Customer'),
    supplierPayable:gross(supplier.value,'Supplier')
  };
}
