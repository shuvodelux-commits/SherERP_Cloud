/** Frozen GAS POS bootstrap oracle including real bundle recipe/availability. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';

const load=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const sourceSales=load('../../legacy/source/Sales.gs');
const sourceBundles=load('../../legacy/source/Bundles.gs');
const sourceLots=load('../../legacy/source/StockLots.gs');
const sourceUtils=load('../../legacy/source/Utils.gs');
const names=[
 [sourceSales,['getPosBootstrap']],
 [sourceBundles,['bundleProductType_','bundleProductMap_','validateBundleDefinition_',
   'getBundleDefinitions_','getBundleAvailability_']],
 [sourceLots,['compareLotsFifo_','lotSellPrice_','buildLotPricingLadder_']],
 [sourceUtils,['isValidNonNegativeNumber_','safeDateOnly_','isSettingEnabled_']]
];
const original=names.map(([text,required])=>{
  const nodes=parse(text,{ecmaVersion:'latest'}).body
    .filter(x=>x.type==='FunctionDeclaration'&&required.includes(x.id.name));
  if(nodes.length!==required.length)throw new Error('Missing pinned source declaration');
  return nodes.map(x=>text.slice(x.start,x.end)).join('\n');
}).join('\n');

function dhakaDate(value){
  const date=new Date(value);
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const map=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return [map.year,map.month,map.day].join('-');
}
export function sourceBundleBootstrap(snapshot){
  const rows={
    PRODUCTS:snapshot.productRows,
    CUSTOMERS:snapshot.customerRows,
    STOCK_LOTS:snapshot.stockLots,
    BUNDLE_COMPONENTS:snapshot.bundleComponentRows
  };
  const context={
    CONFIG:{APP_NAME:'Hardware Store ERP'},
    formatDate_:dhakaDate,
    requirePermission_:(_token,area,action)=>{
      if(area!=='pos'||action!=='view'||!snapshot.actorPermissions.posView){
        throw new Error('POS view permission denied');
      }
      return snapshot.actorPermissions;
    },
    activeRows_:name=>(rows[name]||[]).filter(row=>
      String(row['Is Deleted']||'').toUpperCase()!=='TRUE'),
    getAllRows_:name=>rows[name]||[],
    getSettingsMap_:()=>snapshot.settings,
    getActiveCashSession_:()=>snapshot.sessionResult,
    getActiveVendorsForUI_:()=>snapshot.vendors,
    getAllVendorsForUI_:()=>snapshot.vendorsAll,
    getActiveBankAccountsForUI_:()=>snapshot.bankAccounts,
    hasPermission_:(user,area,action)=>action==='view'&&(
      area==='posCost'?user.posCostView===true:
      area==='reports'?user.reportsView===true:false),
    canViewInvoiceProfit_:user=>user.posCostView===true||user.reportsView===true,
    normalizeCustomerRelationType_:value=>String(value||'').trim()==='Husband'?'Husband':'Father',
    logError_:()=>{},
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message:String(message)})
  };
  runInNewContext(original,context);
  return JSON.parse(JSON.stringify(context.getPosBootstrap('trusted-pos-session')));
}
