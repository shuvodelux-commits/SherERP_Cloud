/**
 * M09 source-compatible Dashboard read response composer.
 *
 * Caller must have independently checked dashboard:view, authenticated the
 * requester and loaded source-shaped active records. In particular,
 * financeSummary and cashBalance MUST come from their approved Finance/Cash
 * readers, not user input, a fabricated zero, or a cross-role Party net.
 *
 * Pure internal adapter only: no D1, RPC, cache, writes or UI changes.
 * Source: frozen Dashboard.gs::getDashboardStats / dashboard.html::dashLoad.
 */
import {projectDashboardDailyActivity} from './dashboard-daily-activity.js';
import {projectDashboardDueStock} from './dashboard-due-stock.js';

function isPlain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}

function ownData(object,key){
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  if(!descriptor || !Object.hasOwn(descriptor,'value'))
    throw new TypeError('Missing trusted Dashboard '+key+' value');
  return descriptor.value;
}

function trustedNumber(value,label){
  if(typeof value!=='number' || !Number.isFinite(value))
    throw new TypeError('Expected finite trusted Dashboard '+label+' number');
  return value;
}

/**
 * Reconstruct the exact 11 source Dashboard fields without recalculating
 * M08 Finance or Cash values or combining any distinct Party role accounts.
 */
export function projectDashboardStats(snapshot,today){
  if(!isPlain(snapshot))
    throw new TypeError('Missing trusted Dashboard snapshot');

  const finance=ownData(snapshot,'financeSummary');
  if(!isPlain(finance))
    throw new TypeError('Trusted Dashboard Finance summary is required');
  const borrowerReceivable=trustedNumber(
    ownData(finance,'borrowerReceivable'),'borrowerReceivable');
  const outstandingLoan=trustedNumber(
    ownData(finance,'outstandingLoan'),'outstandingLoan');
  const cashBalance=trustedNumber(ownData(snapshot,'cashBalance'),'cashBalance');
  const currencySymbol=ownData(snapshot,'currencySymbol');
  if(typeof currencySymbol!=='string')
    throw new TypeError('Trusted Dashboard currencySymbol must be a string');

  const daily=projectDashboardDailyActivity(snapshot,today);
  const dueStock=projectDashboardDueStock(snapshot);

  return {
    todaySalesTotal:daily.todaySalesTotal,
    todayCollectionTotal:daily.todayCollectionTotal,
    todayExpenseTotal:daily.todayExpenseTotal,
    todayPurchaseTotal:daily.todayPurchaseTotal,
    dueReceivable:dueStock.dueReceivable,
    borrowerReceivable,
    supplierPayable:dueStock.supplierPayable,
    outstandingLoan,
    cashBalance,
    lowStockCount:dueStock.lowStockCount,
    currencySymbol
  };
}
