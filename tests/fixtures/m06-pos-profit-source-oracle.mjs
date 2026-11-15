/** Source oracle for Standard-product POS profit; executes frozen GAS logic. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';

const load=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const originalSales=load('../../legacy/source/Sales.gs');
const originalStock=load('../../legacy/source/StockLots.gs');
const originalUtils=load('../../legacy/source/Utils.gs');
const originalBundles=load('../../legacy/source/Bundles.gs');
const stockNames=['compareLotsFifo_','lotSellPrice_','buildLotPricingLadder_',
  'computePlanSellingPrice_','planStockConsumption_','planSaleVendorConsumption_'];
const utilsNames=['isValidNonNegativeNumber_','roundMoney_','safeDateOnly_'];
function exactSourceDeclarations(source,names){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const functions=ast.body.filter(node=>
    node.type==='FunctionDeclaration' && names.includes(node.id.name));
  if(functions.length!==names.length)throw new Error('Missing pinned GAS profit-oracle dependency');
  return functions.map(node=>source.slice(node.start,node.end)).join('\n');
}
const oracleSource=[
  exactSourceDeclarations(originalUtils,utilsNames),
  exactSourceDeclarations(originalStock,stockNames),
  exactSourceDeclarations(originalBundles,['bundleProductType_']),
  exactSourceDeclarations(originalSales,['estimatePosInvoiceProfit_'])
].join('\n');

function dhakaDate(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new TypeError('Invalid source lot date');
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const byType=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return [byType.year,byType.month,byType.day].join('-');
}

export function sourceEstimatePosInvoiceProfit(payload,productsById,allLots){
  const context={
    formatDate_:dhakaDate,
    getAllRows_:()=>{throw new Error('Unexpected implicit GAS read in isolated profit preview');},
    buildSaleStockDemands_:()=>{throw new Error('Bundle profit not supported by Standard-only oracle');}
  };
  runInNewContext(oracleSource,context);
  return JSON.parse(JSON.stringify(
    context.estimatePosInvoiceProfit_(payload,productsById,allLots,{})
  ));
}
