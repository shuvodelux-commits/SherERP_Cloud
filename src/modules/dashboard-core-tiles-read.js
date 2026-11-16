/**
 * M09 internal Dashboard core operational tiles.
 * Composes existing frozen-source read models only. This is neither the full
 * getDashboardStats endpoint nor a server authorization / D1 read boundary.
 * Source cashier state and tenant currency remain separate authorized gates.
 */
import {projectDashboardTodayNetSales} from './dashboard-today-sales-read.js';
import {projectDashboardDailyMovements} from './dashboard-daily-read.js';
import {projectDashboardGrossDues} from './dashboard-gross-dues-read.js';
import {projectDashboardFinanceSummary} from './dashboard-finance-summary-read.js';
import {projectDashboardLowStockCount} from './dashboard-low-stock-read.js';

const required=[
  'today','todaySales','activeReturnItems','customerLedgerRows',
  'expenseRows','purchaseRows','activeCustomers','activeSuppliers',
  'activeProducts','activeTransactions'
];
const rowGroups=new Set(required.filter(key=>key!=='today'));

function trustedSnapshot(value){
  if(value===null || typeof value!=='object' || Array.isArray(value) ||
     (Object.getPrototypeOf(value)!==Object.prototype &&
      Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Dashboard core snapshot');
  const keys=Reflect.ownKeys(value);
  if(keys.length!==required.length ||
     keys.some(key=>typeof key!=='string'||!required.includes(key)))
    throw new TypeError('Invalid trusted Dashboard core snapshot fields');

  const data={};
  for(const key of required){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d || !Object.hasOwn(d,'value'))
      throw new TypeError('Invalid trusted Dashboard core snapshot accessor');
    const raw=d.value;
    if(!rowGroups.has(key)){
      if(typeof raw!=='string')
        throw new TypeError('Invalid trusted Dashboard core date');
      data[key]=raw;
      continue;
    }
    if(!Array.isArray(raw) || Object.getPrototypeOf(raw)!==Array.prototype)
      throw new TypeError('Invalid trusted Dashboard core '+key+' array');
    const descriptors=Object.getOwnPropertyDescriptors(raw);
    const own=Reflect.ownKeys(descriptors);
    if(own.some(index=>typeof index!=='string' || (index!=='length' &&
      (!/^(0|[1-9]\d*)$/.test(index) || Number(index)>=raw.length))))
      throw new TypeError('Invalid trusted Dashboard core '+key+' array fields');
    for(let i=0;i<raw.length;i++){
      const slot=descriptors[String(i)];
      if(!slot || !Object.hasOwn(slot,'value'))
        throw new TypeError('Invalid trusted Dashboard core '+key+' array slot');
    }
    data[key]=raw;
  }
  return data;
}

/**
 * Exactly nine original DashboardStats fields in their original order.
 * Caller owns trusted shop-local dates, original activeRows_ filtering,
 * active Sales Return header+line filtering, full Sales invoice-ID uniqueness,
 * authenticated dashboard.view and source/D1 reconciliation.
 */
export function projectDashboardCoreTiles(snapshot){
  const s=trustedSnapshot(snapshot);
  const todaySalesTotal=projectDashboardTodayNetSales({
    today:s.today,todaySales:s.todaySales,activeReturnItems:s.activeReturnItems
  });
  const daily=projectDashboardDailyMovements({
    today:s.today,todaySales:s.todaySales,
    customerLedgerRows:s.customerLedgerRows,
    expenseRows:s.expenseRows,purchaseRows:s.purchaseRows
  });
  const dues=projectDashboardGrossDues({
    activeCustomers:s.activeCustomers,activeSuppliers:s.activeSuppliers
  });
  const finance=projectDashboardFinanceSummary({
    activeTransactions:s.activeTransactions
  });
  const lowStockCount=projectDashboardLowStockCount({
    activeProducts:s.activeProducts
  });
  return {
    todaySalesTotal,
    todayCollectionTotal:daily.todayCollectionTotal,
    todayExpenseTotal:daily.todayExpenseTotal,
    todayPurchaseTotal:daily.todayPurchaseTotal,
    dueReceivable:dues.dueReceivable,
    borrowerReceivable:finance.borrowerReceivable,
    supplierPayable:dues.supplierPayable,
    outstandingLoan:finance.outstandingLoan,
    lowStockCount
  };
}
