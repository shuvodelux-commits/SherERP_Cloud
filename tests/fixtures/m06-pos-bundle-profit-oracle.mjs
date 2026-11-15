/** Test-only, frozen GAS oracle for Bundle + Standard POS invoice profit. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';

const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const names=[
  [source('../../legacy/source/Utils.gs'),
    ['isValidNonNegativeNumber_','roundMoney_','safeDateOnly_']],
  [source('../../legacy/source/StockLots.gs'),
    ['compareLotsFifo_','lotSellPrice_','buildLotPricingLadder_',
     'computePlanSellingPrice_','planStockConsumption_','planSaleVendorConsumption_']],
  [source('../../legacy/source/Bundles.gs'),
    ['bundleProductType_','buildSaleStockDemands_']],
  [source('../../legacy/source/Sales.gs'),
    ['estimatePosInvoiceProfit_']]
];
function declarations(text,needed){
  const nodes=parse(text,{ecmaVersion:'latest',sourceType:'module'}).body
    .filter(node=>node.type==='FunctionDeclaration'&&needed.includes(node.id.name));
  if(nodes.length!==needed.length)throw new Error('Frozen GAS profit oracle missing dependency');
  return nodes.map(node=>text.slice(node.start,node.end)).join('\n');
}
const original=names.map(([text,needed])=>declarations(text,needed)).join('\n');
function dhakaDate(value){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))throw new TypeError('Invalid original lot date');
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(d);
  const found=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return [found.year,found.month,found.day].join('-');
}

export function originalMixedPosProfit(payload,snapshot){
  const context={
    formatDate_:dhakaDate,
    getAllRows_:()=>{throw new Error('Unexpected hidden GAS read in original POS calculation');}
  };
  runInNewContext(original,context);
  return JSON.parse(JSON.stringify(context.estimatePosInvoiceProfit_(
    payload,snapshot.productsById,snapshot.stockLots,snapshot.bundleDefinitions
  )));
}
