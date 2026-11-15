/**
 * M09: original Dashboard Customer Due / Supplier Payable / Low Stock cards.
 *
 * Caller supplies independently authorized, already-active source-shaped
 * Customer, Supplier and Product rows. This projection neither reconciles
 * ledger accounts nor looks up/combines Unified Party roles.
 *
 * Source: frozen Dashboard.gs::getDashboardStats + Utils.gs::roundMoney_.
 * No D1 access, RPC exposure, caching, writes, or original UI changes.
 */

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}

function own(row,key){
  return Object.getOwnPropertyDescriptor(row,key)?.value;
}

function activeRows(snapshot,key){
  const descriptor=Object.getOwnPropertyDescriptor(snapshot,key);
  if(!descriptor || !Object.hasOwn(descriptor,'value') ||
      !Array.isArray(descriptor.value))
    throw new TypeError('Trusted dashboard snapshot requires active '+key+' array');
  for(const row of descriptor.value){
    if(!plain(row) ||
      Object.values(Object.getOwnPropertyDescriptors(row))
        .some(d=>!Object.hasOwn(d,'value')))
      throw new TypeError('Invalid trusted active dashboard row in '+key);
  }
  return descriptor.value;
}

function sourceNumber(value,field){
  if(value!==undefined && value!==null &&
      !['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid trusted '+field+' number');
  const amount=Number(value);
  if(amount===Infinity || amount===-Infinity)
    throw new TypeError('Expected finite '+field+' number');
  return amount;
}

const roundMoney=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;

function positiveDue(rows){
  let total=0;
  for(const row of rows){
    total+=Math.max(0,sourceNumber(own(row,'Current Due'),'due')||0);
  }
  return roundMoney(total);
}

/** Three exact source Dashboard card keys, with no cross-role netting. */
export function projectDashboardDueStock(snapshot){
  if(!plain(snapshot))
    throw new TypeError('Missing trusted dashboard snapshot');
  const customers=activeRows(snapshot,'customers');
  const suppliers=activeRows(snapshot,'suppliers');
  const products=activeRows(snapshot,'products');

  const dueReceivable=positiveDue(customers);
  const supplierPayable=positiveDue(suppliers);

  let lowStockCount=0;
  for(const product of products){
    if(own(product,'Status')==='Inactive')continue;
    const stock=sourceNumber(own(product,'Current Stock'),'stock');
    const minimum=sourceNumber(own(product,'Minimum Stock'),'minimum stock');
    if(stock<=minimum)lowStockCount++;
  }
  return {dueReceivable,supplierPayable,lowStockCount};
}
