/**
 * M09 INTERNAL, READ-ONLY complete Day Book source snapshot composition.
 * Pinned: Mohim_ERP DayBook.gs::getDayBookTransactions source group order.
 *
 * This function DOES NOT load/authorize D1 or expose public RPC. The caller
 * must have enforced M04 daybook.view and supplied all source-equivalent
 * rows for one business, in normalized shop-local dates and timestamps.
 * No financial writes, Cash Session changes, caches or data migrations.
 */
import {projectDayBookSalesPurchases} from './daybook-sales-purchases.js';
import {projectDayBookReturnRows} from './daybook-returns.js';
import {projectDayBookPartySettlements} from './daybook-party-settlements.js';
import {projectDayBookExpenseFinanceRows} from './daybook-expense-finance.js';
import {projectDayBookBankRows} from './daybook-bank-dedup.js';
import {projectDayBookTransferStockRows} from './daybook-transfers-stock.js';
import {projectDayBookRunningCash} from './daybook-running-cash.js';
import {projectDayBookWindow} from './daybook-window-totals.js';

const GROUPS=[
  'sales','salesReturns','purchases','purchaseReturns','customerLedgerRows',
  'supplierLedgerRows','expenses','financeTransactions','bankTransfers',
  'bankEntries','stockMovements','cashBookRows'
];

function plainRecord(value,label){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype &&
     Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book '+label+' record');
  const fields=Object.getOwnPropertyDescriptors(value);
  const copy=Object.create(null);
  for(const key of Reflect.ownKeys(fields)){
    const field=fields[key];
    if(typeof key!=='string' || !Object.hasOwn(field,'value'))
      throw new TypeError('Invalid trusted Day Book '+label+' accessor');
    const part=field.value;
    if(part!==undefined && part!==null &&
      !['string','number','boolean'].includes(typeof part))
      throw new TypeError('Invalid trusted Day Book '+label+' field');
    if(typeof part==='number' && !Number.isFinite(part))
      throw new TypeError('Invalid finite Day Book '+label+' scalar');
    copy[key]=part;
  }
  return copy;
}

function fullSnapshot(value){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    (Object.getPrototypeOf(value)!==Object.prototype &&
     Object.getPrototypeOf(value)!==null))
    throw new TypeError('Invalid trusted Day Book complete snapshot');
  const fields=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(fields).length!==GROUPS.length ||
    Reflect.ownKeys(fields).some(key=>typeof key!=='string' ||
      !GROUPS.includes(key) || !Object.hasOwn(fields[key],'value')))
    throw new TypeError('Invalid trusted Day Book complete snapshot groups');
  const result=Object.create(null);
  for(const group of GROUPS){
    const records=fields[group].value;
    if(!Array.isArray(records))
      throw new TypeError('Invalid trusted Day Book '+group+' array');
    const elements=Object.getOwnPropertyDescriptors(records);
    if(Reflect.ownKeys(elements).length!==records.length+1 ||
      Reflect.ownKeys(elements).some(key=>key!=='length' &&
        (typeof key!=='string' || !/^(?:0|[1-9]\d*)$/.test(key) ||
          !Object.hasOwn(elements[key],'value'))))
      throw new TypeError('Invalid incomplete Day Book '+group+' array');
    result[group]=Array.from(records,record=>plainRecord(record,group));
  }
  return result;
}

function sourceDeleted(row){
  const value=row['Is Deleted'];
  if(value===undefined || value===null || value==='' ||
     value===false || value==='FALSE')return false;
  if(value===true || value==='TRUE')return true;
  throw new TypeError('Invalid trusted Day Book deleted flag');
}

function visibleSources(rows,includeDeleted){
  return rows.filter(row=>includeDeleted || !sourceDeleted(row));
}

/**
 * Compose the frozen Day Book group order, then real Cash Book chronology,
 * then the original descending display filters and totals.
 * @param {object} snapshot - all 12 complete pre-authorized source groups
 * @param {object} filters - original Day Book filter contract (source-normalized)
 * @param {boolean} isAdmin - authenticated M04 role fact from caller, never user input
 */
export function projectDayBookCompleteSnapshot(snapshot,filters={},isAdmin=false){
  if(typeof isAdmin!=='boolean')
    throw new TypeError('Invalid trusted Day Book Administrator boolean');
  // Source inputs must be complete and plain *before* filtering out records.
  const data=fullSnapshot(snapshot);
  // A zero-row call validates all original filters, even when no rows match.
  projectDayBookWindow([],filters,isAdmin);
  const sourceFilters=Object.getOwnPropertyDescriptor(filters,'includeDeleted');
  const showDeleted=isAdmin && sourceFilters?.value===true;

  const salesPurchases=projectDayBookSalesPurchases({
    sales:data.sales,purchases:data.purchases
  },isAdmin,showDeleted);
  const returns=projectDayBookReturnRows({
    salesReturns:data.salesReturns,purchaseReturns:data.purchaseReturns,
    supplierLedgerRows:data.supplierLedgerRows
  },isAdmin,showDeleted);
  const settlements=projectDayBookPartySettlements({
    customerLedgerRows:data.customerLedgerRows,
    supplierLedgerRows:data.supplierLedgerRows
  },isAdmin,showDeleted);
  const expenseFinance=projectDayBookExpenseFinanceRows({
    expenses:data.expenses,financeTransactions:data.financeTransactions
  },isAdmin,showDeleted);
  const keep=rows=>visibleSources(rows,showDeleted);
  const customerRows=keep(data.customerLedgerRows);
  const supplierRows=keep(data.supplierLedgerRows);
  const bank=projectDayBookBankRows({
    sales:keep(data.sales),purchases:keep(data.purchases),
    expenses:keep(data.expenses),
    customerPayments:customerRows.filter(row=>row.Type==='Payment'),
    customerAdvanceRefunds:customerRows.filter(row=>row.Type==='Advance Refund'),
    supplierPayments:supplierRows.filter(row=>row.Type==='Payment'),
    financeTransactions:keep(data.financeTransactions),
    bankTransfers:data.bankTransfers,bankEntries:data.bankEntries
  },isAdmin,showDeleted);
  const transferStock=projectDayBookTransferStockRows({
    bankTransfers:data.bankTransfers,stockMovements:data.stockMovements
  });
  const section=(rows,module)=>rows.filter(row=>row.module===module);
  const ordered=[
    ...section(salesPurchases,'Sales'),
    ...section(returns,'Sales Return'),
    ...section(salesPurchases,'Purchase'),
    ...section(returns,'Purchase Return'),
    ...section(settlements,'Customer Payment'),
    ...section(settlements,'Customer Advance Refund'),
    ...section(settlements,'Supplier Payment'),
    ...section(expenseFinance,'Expense'),
    ...section(expenseFinance,'Finance'),
    ...bank,
    ...section(transferStock,'Bank Transfer'),
    ...section(transferStock,'Stock Adjustment')
  ];
  const timed=projectDayBookRunningCash(ordered,data.cashBookRows);
  return projectDayBookWindow(timed,filters,isAdmin);
}
