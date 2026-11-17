/**
 * M09 internal Profit Report projection from the frozen SherERP Reports.gs.
 *
 * The future caller MUST authenticate, enforce reports:view, and supply
 * original source-shaped rows with approved M05/M07/M08 provenance.
 * Net-of-return SALE_ITEM_LOTS.Quantity is already final COGS evidence;
 * neither restores nor subtracts returned cost again. Settlement discounts
 * must come from a separately reconciled Customer/Supplier ledger reader.
 *
 * No SQL, D1, RPC registry, mutation, cache or alternate FIFO planner.
 */
import {normalizeReportRange,dateInReportRange,reportDefaultRange} from './report-date-range.js';

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function own(row,key){
  const property=Object.getOwnPropertyDescriptor(row,key);
  if(property && !Object.hasOwn(property,'value'))
    throw new TypeError('Untrusted Profit Report accessor '+key);
  return property?.value;
}
function loaded(snapshot,key){
  const value=own(snapshot,key);
  if(!Array.isArray(value))
    throw new TypeError('Trusted Profit Report snapshot requires '+key+' array');
  for(const row of value){
    if(!plain(row) ||
      Object.values(Object.getOwnPropertyDescriptors(row))
        .some(d=>!Object.hasOwn(d,'value')))
      throw new TypeError('Invalid trusted Profit Report row in '+key);
  }
  return value;
}
function checkedNumber(value,context){
  if(value!==null && value!==undefined &&
     !['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid trusted Profit Report '+context+' amount');
  const n=Number(value);
  if(!Number.isFinite(n) && !Number.isNaN(n))
    throw new TypeError('Expected finite Profit Report '+context+' amount');
  return n||0;
}
function checkedDate(value){
  if(value===null||value===undefined||value==='')return '';
  if(typeof value!=='string')
    throw new TypeError('Invalid canonical Profit Report date');
  reportDefaultRange(value);
  return value;
}
function sortedByDesc(map,field){
  return [...map.values()].sort((a,b)=>
    (Number(b[field])||0)-(Number(a[field])||0));
}
const round=value=>Math.round(((Number(value)||0)+Number.EPSILON)*100)/100;
function moneyFields(rows,fields){
  for(const row of rows)
    for(const name of fields)checkedNumber(own(row,name),name);
}
function settlement(snapshot){
  const s=own(snapshot,'settlementDiscount');
  if(!plain(s))
    throw new TypeError('Missing trusted Profit Report settlement discount summary');
  const customer=own(s,'customerDiscountGiven');
  const supplier=own(s,'supplierDiscountReceived');
  const impact=own(s,'netProfitImpact');
  for(const n of [customer,supplier,impact])
    if(typeof n!=='number'||!Number.isFinite(n))
      throw new TypeError('Trusted Profit Report settlement discount amounts must be finite');
  if(round(supplier-customer)!==impact)
    throw new TypeError('Unreconciled Profit Report settlement discount net impact');
  return {customerDiscountGiven:customer,supplierDiscountReceived:supplier,netProfitImpact:impact};
}
function mapIncrement(root,invoiceId,productId,quantity){
  const id=String(invoiceId),product=String(productId);
  let row=root.get(id);
  if(!row){row=new Map();root.set(id,row);}
  row.set(product,(row.get(product)||0)+checkedNumber(quantity,'quantity'));
}
function duplicateInvoiceIds(allSales,selected){
  const counts=new Map(),chosen=new Set();
  for(const sale of allSales){
    const id=String(own(sale,'Invoice ID')||'').trim();
    if(id)counts.set(id,(counts.get(id)||0)+1);
  }
  for(const sale of selected){
    const id=String(own(sale,'Invoice ID')||'').trim();
    if(id)chosen.add(id);
  }
  return [...counts].filter(([id,n])=>n>1&&chosen.has(id))
    .map(([id])=>id).sort();
}

/**
 * Exact getProfitReport response, including legacy coverage field names.
 * Inputs are data from already-authorized source-shaped readers, not HTTP.
 */
export function projectProfitReport(snapshot,filters,today){
  if(!plain(snapshot))
    throw new TypeError('Missing trusted Profit Report snapshot');
  const allSales=loaded(snapshot,'allSales');
  const saleItems=loaded(snapshot,'saleItems');
  const saleReturnItems=loaded(snapshot,'saleReturnItems');
  const lotConsumptions=loaded(snapshot,'lotConsumptions');
  const vendorSourcing=loaded(snapshot,'vendorSourcing');
  const expensesRows=loaded(snapshot,'expenses');
  const saleBundleComponents=loaded(snapshot,'saleBundleComponents');
  const discount=settlement(snapshot);
  const range=normalizeReportRange(filters,today);

  // All supplied source rows must be loaded, canonical and finite even if
  // some lie outside this period. No Proxy/getter/Promise is consulted.
  moneyFields(allSales,['Subtotal','Grand Total','Discount']);
  moneyFields(saleItems,['Quantity','Unit Price','Line Total']);
  moneyFields(saleReturnItems,['Return Quantity','Line Total']);
  moneyFields(lotConsumptions,['Quantity','Unit Cost']);
  moneyFields(vendorSourcing,['Quantity','Unit Cost','Total Cost']);
  moneyFields(expensesRows,['Amount']);
  moneyFields(saleBundleComponents,['Quantity Per Set']);
  for(const sale of allSales)checkedDate(own(sale,'Date'));
  for(const expense of expensesRows)checkedDate(own(expense,'Date'));

  const sales=allSales.filter(sale=>
    !(own(sale,'Is Deleted')===true||
      String(own(sale,'Is Deleted')||'').toUpperCase()==='TRUE') &&
    dateInReportRange(checkedDate(own(sale,'Date')),range));
  const duplicates=duplicateInvoiceIds(allSales,sales);
  if(duplicates.length)
    throw new Error('Profit report: Duplicate invoice ID detected: '+
      duplicates.join(', ')+'. Repair duplicate Sales invoice IDs before using invoice-linked accounting reports.');

  const factorByInvoice=new Map(),saleByInvoice=new Map(),inScope=new Set();
  let grossSales=0,discountTotal=0;
  for(const sale of sales){
    const id=String(own(sale,'Invoice ID'));
    const subtotal=checkedNumber(own(sale,'Subtotal'),'subtotal');
    const grand=checkedNumber(own(sale,'Grand Total'),'grand total');
    factorByInvoice.set(id,subtotal>0?grand/subtotal:1);
    saleByInvoice.set(id,sale);
    inScope.add(id);
    grossSales+=grand;
    discountTotal+=checkedNumber(own(sale,'Discount'),'discount');
  }
  const byProduct=new Map(),netQtyByInvoiceProduct=new Map(),
    costQtyByInvoiceProduct=new Map();
  function bucket(pid,name){
    const key=String(pid);
    let b=byProduct.get(key);
    if(!b){
      b={productId:pid,label:name||pid,qtySold:0,qtyReturned:0,
        revenue:0,cost:0,profit:0};
      byProduct.set(key,b);
    }
    if(name&&b.label===pid)b.label=name;
    return b;
  }
  for(const item of saleItems){
    const id=String(own(item,'Invoice ID'));
    if(!inScope.has(id))continue;
    const productId=own(item,'Product ID');
    const b=bucket(productId,own(item,'Product Name'));
    const qty=checkedNumber(own(item,'Quantity'),'sale item quantity');
    b.qtySold+=qty;
    mapIncrement(netQtyByInvoiceProduct,id,productId,qty);
    const raw=own(item,'Line Total');
    const rawNum=checkedNumber(raw,'sale line total');
    const usable=raw!==''&&raw!==null&&raw!==undefined&&
      !Number.isNaN(Number(raw))&&Number.isFinite(Number(raw))&&Number(raw)>=0;
    const grossLine=usable?rawNum:
      qty*checkedNumber(own(item,'Unit Price'),'unit price');
    b.revenue+=grossLine*factorByInvoice.get(id);
  }

  let returnedTotal=0;
  for(const item of saleReturnItems){
    const id=String(own(item,'Invoice ID'));
    if(!inScope.has(id))continue;
    const productId=own(item,'Product ID');
    const b=bucket(productId,own(item,'Product Name'));
    const parent=saleByInvoice.get(id);
    const raw=checkedNumber(own(item,'Line Total'),'return line total');
    const subtotal=checkedNumber(own(parent,'Subtotal'),'parent subtotal');
    const grand=checkedNumber(own(parent,'Grand Total'),'parent total');
    const scaled=own(item,'Pricing Basis')==='NetAfterInvoiceDiscount'
      ?raw:raw*(subtotal>0?grand/subtotal:1);
    const quantity=checkedNumber(own(item,'Return Quantity'),'returned quantity');
    b.qtyReturned+=quantity;
    mapIncrement(netQtyByInvoiceProduct,id,productId,-quantity);
    b.revenue-=scaled;
    returnedTotal+=scaled;
  }

  let cogs=0;
  for(const lot of lotConsumptions){
    const id=String(own(lot,'Invoice ID'));
    if(!inScope.has(id))continue;
    const quantity=checkedNumber(own(lot,'Quantity'),'net consumed lot quantity');
    const lineCost=quantity*checkedNumber(own(lot,'Unit Cost'),'lot unit cost');
    cogs+=lineCost;
    bucket(own(lot,'Source Sale Product ID')||own(lot,'Product ID'),'').cost+=lineCost;
    mapIncrement(costQtyByInvoiceProduct,id,own(lot,'Product ID'),quantity);
  }
  for(const vendor of vendorSourcing){
    const id=String(own(vendor,'Invoice ID'));
    if(!inScope.has(id))continue;
    const qty=checkedNumber(own(vendor,'Quantity'),'vendor quantity');
    const raw=own(vendor,'Total Cost');
    const usable=raw!==''&&raw!==null&&raw!==undefined&&
      !Number.isNaN(Number(raw))&&Number.isFinite(Number(raw))&&Number(raw)>=0;
    const lineCost=usable?checkedNumber(raw,'vendor total cost'):
      qty*checkedNumber(own(vendor,'Unit Cost'),'vendor unit cost');
    cogs+=lineCost;
    bucket(own(vendor,'Product ID'),own(vendor,'Product Name')).cost+=lineCost;
    mapIncrement(costQtyByInvoiceProduct,id,own(vendor,'Product ID'),qty);
  }
  for(const b of byProduct.values())b.profit=b.revenue-b.cost;

  let expenses=0;
  const expenseByCategory=new Map();
  for(const e of expensesRows){
    if(own(e,'Status')==='Cancelled')continue;
    if(!dateInReportRange(checkedDate(own(e,'Date')),range))continue;
    const amount=checkedNumber(own(e,'Amount'),'expense');
    expenses+=amount;
    const category=own(e,'Category Name')||'Uncategorized';
    const key=String(category);
    if(!expenseByCategory.has(key))
      expenseByCategory.set(key,{label:category,entries:0,amount:0});
    const b=expenseByCategory.get(key);
    b.entries++;b.amount+=amount;
  }

  const netRevenue=grossSales-returnedTotal;
  const grossProfit=netRevenue-cogs;
  const netProfit=round(grossProfit-expenses+discount.netProfitImpact);

  // Source-saved bundle recipes replace only the coverage quantities.
  // Physical components are NOT an alternate revenue or cost journal.
  for(const component of saleBundleComponents){
    const id=String(own(component,'Invoice ID'));
    if(!inScope.has(id))continue;
    const net=netQtyByInvoiceProduct.get(id);
    const bundleId=String(own(component,'Bundle Product ID'));
    if(!net||!net.has(bundleId))continue;
    const sets=checkedNumber(net.get(bundleId),'net bundle sets');
    const demand=sets*checkedNumber(own(component,'Quantity Per Set'),'bundle quantity per set');
    mapIncrement(netQtyByInvoiceProduct,id,own(component,'Component Product ID'),demand);
  }
  for(const component of saleBundleComponents){
    const id=String(own(component,'Invoice ID'));
    const net=netQtyByInvoiceProduct.get(id);
    if(net)net.delete(String(own(component,'Bundle Product ID')));
  }

  const missing=sales.filter(sale=>{
    const id=String(own(sale,'Invoice ID'));
    const required=netQtyByInvoiceProduct.get(id);
    if(!required||!required.size)return true;
    return [...required].some(([pid,quantity])=>{
      const netQty=Math.max(0,checkedNumber(quantity,'required net quantity'));
      const coveredQty=checkedNumber(
        costQtyByInvoiceProduct.get(id)?.get(pid),'covered net quantity');
      return coveredQty+0.0000001<netQty;
    });
  });
  const products=sortedByDesc(byProduct,'profit');
  const result={
    range,
    totals:{
      invoices:sales.length,grossSales,discount:discountTotal,
      returned:returnedTotal,netRevenue,cogs,grossProfit,
      grossMarginPercent:netRevenue>0?(grossProfit/netRevenue)*100:0,
      expenses,
      customerSettlementDiscount:discount.customerDiscountGiven,
      supplierSettlementDiscountReceived:discount.supplierDiscountReceived,
      settlementDiscountNetImpact:discount.netProfitImpact,
      netProfit,
      netMarginPercent:netRevenue>0?(netProfit/netRevenue)*100:0
    },
    coverage:{
      invoicesInRange:sales.length,
      invoicesWithLotData:sales.length-missing.length,
      invoicesMissingLotData:missing.length,
      missingSample:missing.slice(0,10).map(sale=>({
        invoiceId:own(sale,'Invoice ID'),
        date:checkedDate(own(sale,'Date')),
        grandTotal:checkedNumber(own(sale,'Grand Total'),'grand total')
      }))
    },
    byProduct:products,
    expenseByCategory:sortedByDesc(expenseByCategory,'amount')
  };
  result.topProducts=result.byProduct.slice(0,15);
  result.lossMakers=result.byProduct.filter(p=>p.profit<0).slice(0,10);
  return result;
}
