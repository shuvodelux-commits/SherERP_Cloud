/**
 * M09 pure, internal Balance Sheet report snapshot, source-faithful to
 * frozen Reports.gs::getBalanceSheetReport.
 *
 * This is the original *limited Business Finance* display, not a full
 * double-entry Balance Sheet: Customer/Supplier dues and retained profit
 * are deliberately absent, so Assets need not equal Liabilities + Equity.
 *
 * Caller must authenticate reports:view and supply reviewed M08 Finance
 * summary plus authorized source-shaped active CASH_BOOK and all original
 * BANK_ACCOUNTS/STOCK_LOTS. No D1, RPC, journals, posting or caching.
 */
import {reportDefaultRange} from './report-date-range.js';

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function field(row,key){
  const descriptor=Object.getOwnPropertyDescriptor(row,key);
  if(descriptor && !Object.hasOwn(descriptor,'value'))
    throw new TypeError('Untrusted Balance Sheet accessor: '+key);
  return descriptor?.value;
}
function validatedRows(snapshot,key){
  const records=field(snapshot,key);
  if(!Array.isArray(records))
    throw new TypeError('Trusted Balance Sheet snapshot needs '+key+' array');
  for(const row of records){
    if(!plain(row) ||
      Object.values(Object.getOwnPropertyDescriptors(row))
        .some(desc=>!Object.hasOwn(desc,'value')))
      throw new TypeError('Invalid trusted Balance Sheet row in '+key);
  }
  return records;
}
function sourceNumber(value,description){
  if(value!==undefined && value!==null &&
      !['number','string','boolean'].includes(typeof value))
    throw new TypeError('Invalid trusted Balance Sheet '+description+' amount');
  const number=Number(value);
  if(!Number.isFinite(number) && !Number.isNaN(number))
    throw new TypeError('Expected finite Balance Sheet '+description+' amount');
  return number||0;
}
const roundMoney=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;
function requireFinanceSummary(snapshot){
  const summary=field(snapshot,'financeSummary');
  if(!plain(summary) ||
    Object.values(Object.getOwnPropertyDescriptors(summary))
      .some(d=>!Object.hasOwn(d,'value')))
    throw new TypeError('Missing trusted M08 Finance balance summary');
  const ownerCapital=field(summary,'ownerCapital');
  const outstandingLoan=field(summary,'outstandingLoan');
  if(typeof ownerCapital!=='number'||!Number.isFinite(ownerCapital)||
     typeof outstandingLoan!=='number'||!Number.isFinite(outstandingLoan))
    throw new TypeError('Trusted Finance summary requires finite ownerCapital and outstandingLoan');
  if(ownerCapital<0||outstandingLoan<0)
    throw new TypeError('Unreconciled Finance summary: gross Owner/Lender balances must be nonnegative');
  return {ownerCapital,outstandingLoan};
}

/**
 * Original full response {asOf,assets,liabilities,equity}. asOf is an
 * explicit shop-local YYYY-MM-DD, not a filter or an ambient UTC clock.
 */
export function projectBalanceSheetReport(snapshot,asOf){
  if(!plain(snapshot))
    throw new TypeError('Missing trusted Balance Sheet snapshot');
  reportDefaultRange(asOf); // Validates real canonical shop-local day.
  const cashRows=validatedRows(snapshot,'activeCashRows');
  const bankAccounts=validatedRows(snapshot,'bankAccounts');
  const stockLots=validatedRows(snapshot,'stockLots');
  const {ownerCapital,outstandingLoan}=requireFinanceSummary(snapshot);

  let cashUnrounded=0;
  for(const row of cashRows){
    if(field(row,'Is Deleted')===true ||
       String(field(row,'Is Deleted')||'').toUpperCase()==='TRUE')
      throw new TypeError('Trusted active Cash Book must exclude deleted rows');
    cashUnrounded+=sourceNumber(field(row,'Credit'),'cash credit')-
      sourceNumber(field(row,'Debit'),'cash debit');
  }
  const cash=roundMoney(cashUnrounded);

  let bank=0,mobileBanking=0;
  const bankIds=new Set();
  for(const account of bankAccounts){
    const status=field(account,'Status');
    const value=sourceNumber(field(account,'Current Balance'),'bank current balance');
    if(status==='Inactive')continue;
    const id=String(field(account,'Bank Account ID')||'');
    if(bankIds.has(id))
      throw new Error('Duplicate Bank Account ID in Balance Sheet: '+id);
    bankIds.add(id);
    // BankAccounts.gs::sanitizeAccountType_ accepts 'Mobile Banking',
    // otherwise defaults to 'Bank', including unknown and blank types.
    if(field(account,'Account Type')==='Mobile Banking')
      mobileBanking+=value;
    else bank+=value;
  }

  let inventory=0;
  // Reports.gs::getInventoryValueAtCost_ includes zero and NEGATIVE
  // remaining quantities, unlike getStockReport's positive-only lots.
  for(const lot of stockLots){
    inventory+=sourceNumber(field(lot,'Remaining Quantity'),'remaining quantity')*
      sourceNumber(field(lot,'Purchase Price'),'lot purchase price');
  }
  const totalAssets=cash+bank+mobileBanking+inventory;
  return {
    asOf,
    assets:{cash,bank,mobileBanking,inventory,total:totalAssets},
    liabilities:{outstandingLoan,total:outstandingLoan},
    equity:{ownerCapital,total:ownerCapital}
  };
}
