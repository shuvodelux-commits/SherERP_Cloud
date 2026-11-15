/** Native, unchanged GAS POS bootstrap oracle with only read-only dependencies stubbed. */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';

const source=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
const originals=[
  [source('../../legacy/source/Sales.gs'),['getPosBootstrap']],
  [source('../../legacy/source/StockLots.gs'),['compareLotsFifo_','lotSellPrice_','buildLotPricingLadder_']],
  [source('../../legacy/source/Utils.gs'),['isValidNonNegativeNumber_','safeDateOnly_','isSettingEnabled_']],
  [source('../../legacy/source/Bundles.gs'),['bundleProductType_','bundleProductMap_']],
].map(([text,names])=>{
  const nodes=parse(text,{ecmaVersion:'latest'}).body
    .filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name));
  if(nodes.length!==names.length)throw new Error('Original POS source declaration unavailable');
  return nodes.map(node=>text.slice(node.start,node.end)).join('\n');
}).join('\n');

function dhakaDate(value){
  const parts=new Intl.DateTimeFormat('en-GB',{
    timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(value));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}

export function originalPosBootstrap(snapshot){
  const authorized=snapshot.actorPermissions;
  const groups={
    PRODUCTS:snapshot.productRows,CUSTOMERS:snapshot.customerRows,
    STOCK_LOTS:snapshot.stockLots,BUNDLE_COMPONENTS:[]
  };
  const vm={
    CONFIG:{APP_NAME:'SherERP'},
    formatDate_:dhakaDate,
    requirePermission_:(_token,section,action)=>{
      if(section!=='pos'||action!=='view'||!authorized.posView){
        throw new Error('POS view permission denied');
      }
      return authorized;
    },
    hasPermission_:(actor,section,action)=>{
      if(action!=='view')return false;
      return section==='posCost'?actor.posCostView===true:
        section==='reports'?actor.reportsView===true:false;
    },
    canViewInvoiceProfit_:actor=>actor.reportsView===true||actor.posCostView===true,
    activeRows_:key=>(groups[key]||[]).filter(row=>
      String(row['Is Deleted']||'').toUpperCase()!=='TRUE'),
    getAllRows_:key=>groups[key]||[],
    getSettingsMap_:()=>snapshot.settings,
    getActiveCashSession_:()=>snapshot.sessionResult,
    getActiveVendorsForUI_:()=>snapshot.vendors,
    getAllVendorsForUI_:()=>snapshot.vendorsAll,
    getActiveBankAccountsForUI_:()=>snapshot.bankAccounts,
    normalizeCustomerRelationType_:value=>String(value||'').trim()==='Husband'?'Husband':'Father',
    getBundleDefinitions_:()=>{throw new Error('Unsupported Bundle in Standard-only source oracle')},
    getBundleAvailability_:()=>{throw new Error('Unsupported Bundle in Standard-only source oracle')},
    logError_:()=>{},
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message:String(message)})
  };
  runInNewContext(originals,vm);
  return JSON.parse(JSON.stringify(vm.getPosBootstrap('verified-session')));
}
