/**
 * M06 read-only Sales detail / return economics / source profit projection.
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * SalesManagement.gs::getSaleDetail / buildSalesInvoiceProfitMetrics_.
 *
 * M03 supplies tenant-scoped snapshots, M04 supplies separate sales:view and
 * private-cost authority, M07 scopes ACTIVE return items, M05 supplies
 * net-of-return FIFO and vendor cost evidence. This is NOT a posting engine,
 * D1 repository, RPC or replacement for any native edit/return workflow.
 */
import {projectPostedSaleInvoice} from './sale-invoice-read-model.js';

const record=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);
const amount=value=>Number(value)||0;
const roundMoney=value=>{
  const n=Number(value)||0;
  return Math.round((n+Number.EPSILON)*100)/100;
};
const nonNegative=value=>{
  const n=Number(value);
  return !Number.isNaN(n)&&Number.isFinite(n)&&n>=0;
};
const deleted=row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE';

function economicReturnLineAmount(row,subtotal,grandTotal){
  const raw=amount(row?.['Line Total']);
  if(row?.['Pricing Basis']==='NetAfterInvoiceDiscount')return raw;
  const sub=amount(subtotal),grand=amount(grandTotal);
  return raw*(sub>0?grand/sub:1);
}

/**
 * Exactly the source SalesManagement gross-profit/cost coverage projection,
 * scoped to one uniquely identified invoice. Historical Bundle parents
 * have no physical FIFO lots: physical component rows provide the coverage.
 */
export function sourceProfitMetric(invoiceId,sale,saleItems,returnItems,snapshot){
  const soldQty=Object.create(null);
  const returnedQty=Object.create(null);
  const coveredQty=Object.create(null);
  let returnedAmount=0,cost=0;
  const add=(map,id,qty)=>{map[id]=(map[id]||0)+amount(qty);};
  for(const item of saleItems)add(soldQty,String(item['Product ID']||''),item['Quantity']);
  for(const row of returnItems){
    add(returnedQty,String(row['Product ID']||''),row['Return Quantity']);
    returnedAmount=roundMoney(returnedAmount+
      economicReturnLineAmount(row,sale['Subtotal'],sale['Grand Total']));
  }
  const bundleRows=snapshot.bundleComponents.filter(row=>
    String(row['Invoice ID']||'')===invoiceId);
  if(bundleRows.length){
    const initial={...soldQty},ret={...returnedQty};
    for(const row of bundleRows){
      const parent=String(row['Bundle Product ID']||'');
      const component=String(row['Component Product ID']||'');
      const perSet=amount(row['Quantity Per Set']);
      add(soldQty,component,amount(initial[parent])*perSet);
      add(returnedQty,component,amount(ret[parent])*perSet);
    }
    for(const row of bundleRows){
      const parent=String(row['Bundle Product ID']||'');
      delete soldQty[parent];
      delete returnedQty[parent];
    }
  }
  for(const lot of snapshot.saleItemLots){
    if(String(lot['Invoice ID']||'')!==invoiceId)continue;
    const qty=amount(lot['Quantity']);
    cost=roundMoney(cost+qty*amount(lot['Unit Cost']));
    add(coveredQty,String(lot['Product ID']||''),qty);
  }
  for(const vendor of snapshot.vendorSourcing){
    if(String(vendor['Invoice ID']||'')!==invoiceId || deleted(vendor))continue;
    const qty=amount(vendor['Quantity']);
    const raw=vendor['Total Cost'];
    const lineCost=raw!=='' && raw!==null && raw!==undefined && nonNegative(raw)
      ?Number(raw):qty*amount(vendor['Unit Cost']);
    cost=roundMoney(cost+lineCost);
    add(coveredQty,String(vendor['Product ID']||''),qty);
  }
  const netSale=roundMoney(amount(sale['Grand Total'])-returnedAmount);
  const cogs=roundMoney(cost);
  const ids=Object.keys(soldQty);
  const costComplete=ids.length>0 && ids.every(id=>
    (amount(coveredQty[id])+0.0000001)>=
      Math.max(0,amount(soldQty[id])-amount(returnedQty[id]))
  );
  const profit=roundMoney(netSale-cogs);
  return {
    profit,
    profitMarginPercent:netSale>0?(profit/netSale)*100:0,
    profitCostComplete:costComplete
  };
}

/**
 * Original SalesManagement.gs::getSaleDetail success.data shape.
 * No hidden database reads, financial movements or mutation of source rows.
 */
export function projectSalesManagementDetail(invoiceId,snapshot,{canViewSales,canViewProfit}={}){
  if(canViewSales!==true)throw new Error('Permission denied: sales.view');
  if(typeof invoiceId!=='string'||!invoiceId.trim())
    throw new TypeError('Missing invoice ID for Sales detail.');
  if(!record(snapshot) ||
    !['returnItems','saleItemLots','vendorSourcing','bundleComponents']
      .every(key=>Array.isArray(snapshot[key]))){
    throw new TypeError('Missing trusted Sales detail financial evidence snapshot.');
  }
  const invoice=projectPostedSaleInvoice(invoiceId,snapshot);
  const returns=snapshot.returnItems.filter(row=>String(row['Invoice ID'])===invoiceId);
  let returnedAmount=0;
  for(const row of returns)
    returnedAmount+=economicReturnLineAmount(row,invoice.subtotal,invoice.grandTotal);
  invoice.returnedAmount=returnedAmount;
  invoice.netSale=Number(invoice.grandTotal)-returnedAmount;

  if(canViewProfit===true){
    const sale=snapshot.sales.find(row=>String(row['Invoice ID'])===invoiceId);
    const items=snapshot.items.filter(row=>String(row['Invoice ID'])===invoiceId);
    Object.assign(invoice,sourceProfitMetric(invoiceId,sale,items,returns,snapshot));
  }
  return invoice;
}
