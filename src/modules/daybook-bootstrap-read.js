/**
 * M09 internal Day Book bootstrap projection.
 * Frozen source: Mohim_ERP::DayBook.gs::getDayBookBootstrap and DAY_BOOK_MODULES.
 *
 * The caller must have authenticated the actor, enforced daybook:view,
 * and loaded tenant-scoped Settings. This is NOT a public RPC or an
 * authorization decision. No D1 queries, cash/ledger reads or writes.
 */
const MODULES=Object.freeze([
  'Sales','Sales Return','Purchase','Purchase Return',
  'Customer Payment','Customer Advance Refund','Supplier Payment','Expense','Finance',
  'Bank','Bank Transfer','Stock Adjustment'
]);

function trustedRecord(record,label){
  if(record===null || typeof record!=='object' || Array.isArray(record) ||
    (Object.getPrototypeOf(record)!==Object.prototype &&
     Object.getPrototypeOf(record)!==null)){
    throw new TypeError('Invalid trusted '+label+' record');
  }
  const descriptors=Object.getOwnPropertyDescriptors(record);
  for(const key of Reflect.ownKeys(descriptors)){
    if(typeof key!=='string' || !Object.hasOwn(descriptors[key],'value')){
      throw new TypeError('Invalid trusted '+label+' accessor or key');
    }
  }
  return descriptors;
}

function scalar(descriptors,key){
  const value=descriptors[key]?.value;
  if(value!==undefined && value!==null &&
    !['string','number','boolean'].includes(typeof value)){
    throw new TypeError('Invalid trusted Settings scalar');
  }
  if(typeof value==='number' && !Number.isFinite(value)){
    throw new TypeError('Invalid finite Settings number');
  }
  return value;
}

/**
 * Four original success-payload fields in original property order.
 * No success envelope: an eventual authorized RPC wrapper owns that.
 */
export function projectDayBookBootstrap(settingsMap,actor){
  const settings=trustedRecord(settingsMap,'Settings');
  const staff=trustedRecord(actor,'actor');
  const role=staff.Role?.value;
  if(typeof role!=='string')throw new TypeError('Invalid trusted actor role');
  const currency=scalar(settings,'Currency Symbol');
  const editable=Number(scalar(settings,'Day Book Editable Days'))||0;
  if(!Number.isFinite(editable))throw new TypeError('Invalid finite Day Book editableDays');
  return {
    currencySymbol:currency||'',
    editableDays:editable,
    modules:[...MODULES],
    isAdmin:role==='Administrator'
  };
}
