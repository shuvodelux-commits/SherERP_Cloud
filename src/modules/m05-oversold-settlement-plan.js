/**
 * M05: deterministic, READ-ONLY oversold-to-purchase settlement proposal.
 *
 * This is NOT a posting service or a historical repair. Every lot and tenant
 * scope must come from already-authorized trusted snapshots. M03 later owns
 * atomic D1 writes and M08 must approve signed cost-variance accounting.
 *
 * Monetary outputs are INTEGER MINOR UNITS (BDT paisa). Costs in source lots
 * are per the explicitly declared Quantity Unit; legacy canonical-base lots
 * with no Quantity Unit inherit canonicalUnit.baseUnit.
 */

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const PLAIN = o => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(o)) &&
  Object.values(Object.getOwnPropertyDescriptors(o)).every(d => Object.hasOwn(d,'value'));
const ID = v => typeof v === 'string' ? v.trim() : '';
const get = (o, column, alias) => Object.hasOwn(o, column) ? o[column] : o[alias];
const abs = n => n < 0n ? -n : n;

function decimal(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  const s = String(value).trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(s)) return null;
  const sign = s[0] === '-' ? -1n : 1n;
  const positive = sign < 0n ? s.slice(1) : s;
  const [a,b=''] = positive.split('.');
  return {n: sign * BigInt(a+b), d:10n ** BigInt(b.length)};
}
function rounded(n,d) {
  const q=abs(n)/d, rem=abs(n)%d;
  return (n<0n?-1n:1n)*(q+(rem*2n>=d?1n:0n));
}
function safeNum(value, scale=1n) {
  if(abs(value)>MAX_SAFE || abs(scale)>MAX_SAFE) throw new RangeError('Amount exceeds safe output range');
  return Number(value)/Number(scale);
}
function frozen(data){
  if(data && typeof data === 'object') {
    for(const x of Object.values(data)) frozen(x);
    Object.freeze(data);
  }
  return data;
}
function dateOnly(value) {
  if(typeof value!=='string'||! /^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date=new Date(value+'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value ? value : null;
}
function ratioConfig(canonicalUnit) {
  if(!PLAIN(canonicalUnit)||!ID(canonicalUnit.baseUnit)||
    !Number.isInteger(canonicalUnit.precision)||canonicalUnit.precision<0||canonicalUnit.precision>6||
    !PLAIN(canonicalUnit.units)) throw new TypeError('Canonical unit baseUnit, precision (0..6), and conversion units required');
  const cfg = new Map();
  for(const [unit,scale] of Object.entries(canonicalUnit.units)) {
    const ratio=decimal(scale);
    if(!unit.trim()||!ratio||ratio.n<=0n) throw new TypeError('Invalid positive base-unit conversion for '+unit);
    cfg.set(unit,ratio);
  }
  const base=cfg.get(canonicalUnit.baseUnit);
  if(!base||base.n!==base.d) throw new TypeError('Base unit must have conversion factor 1');
  return {baseUnit:canonicalUnit.baseUnit,precision:canonicalUnit.precision,
    unitScales:cfg,scale:10n**BigInt(canonicalUnit.precision)};
}
function parseBaseQuantity(raw, ratio, config, issue, context) {
  const value=decimal(raw);
  if(!value) {issue('INVALID_LOT_QUANTITY',context);return null;}
  const numerator=value.n*ratio.n*config.scale;
  const denominator=value.d*ratio.d;
  if(numerator%denominator!==0n) {issue('NON_CANONICAL_QUANTITY',context);return null;}
  const result=numerator/denominator;
  if(abs(result)>MAX_SAFE){issue('UNSAFE_QUANTITY',context);return null;}
  return result;
}
function parseUnitCost(raw,issue,context){
  const v=decimal(raw);
  if(!v||v.n<0n||v.n*100n%v.d!==0n){issue('INVALID_LOT_COST',context);return null;}
  const cents=v.n*100n/v.d;
  if(cents>MAX_SAFE){issue('UNSAFE_LOT_COST',context);return null;}
  return cents;
}
function zeroPlan(issues) {
  return frozen({allocations:[],purchaseOriginalBaseQty:null,purchaseRemainingBaseQty:null,
    totalSettledBaseQty:0,updatedDebtBaseQty:[],reviewIssues:issues});
}

/**
 * @param {{tenantId:string, productId:string, operationId:string,
 *  effectiveDate:string, canonicalUnit:{baseUnit:string,precision:number,units:object},
 *  purchaseLot:object, oversoldLots:object[]}} input
 * @returns {Readonly<object>} a non-posting plan; reviewIssues block ALL allocations.
 */
export function planOversoldSettlement(input) {
  if(!PLAIN(input) || !ID(input.tenantId) || !ID(input.productId) ||
    !ID(input.operationId) || !PLAIN(input.purchaseLot) || !Array.isArray(input.oversoldLots) ||
    !input.oversoldLots.every(PLAIN)) throw new TypeError('Trusted explicit purchase/OVERSOLD snapshots and IDs required');
  const effectiveDate=dateOnly(input.effectiveDate);
  if(!effectiveDate)throw new TypeError('Invalid effectiveDate: YYYY-MM-DD calendar date required');
  const cfg=ratioConfig(input.canonicalUnit), issues=[];
  const issue=(code, detail={})=>issues.push({code,...detail});
  const all=[input.purchaseLot,...input.oversoldLots],seen=new Set();
  const parsed=[];
  for(const [index,lot] of all.entries()) {
    const isPurchase=index===0;
    const lotId=ID(get(lot,'Lot ID','lotId'));
    const productId=ID(get(lot,'Product ID','productId'));
    const tenantId=ID(get(lot,'Tenant ID','tenantId'));
    const purchaseId=ID(get(lot,'Purchase ID','purchaseId'));
    const purchaseDate=dateOnly(get(lot,'Purchase Date','purchaseDate'));
    const unit=get(lot,'Quantity Unit','quantityUnit')??cfg.baseUnit;
    const status=String(get(lot,'Status','status')||'').toLowerCase();
    const context={lotId,index};
    if(!lotId)issue('MISSING_LOT_ID',context);
    if(seen.has(lotId))issue('DUPLICATE_LOT_ID',context);
    seen.add(lotId);
    if(productId!==input.productId||tenantId!==input.tenantId)issue('LOT_SCOPE_MISMATCH',context);
    if(!purchaseDate)issue('INVALID_LOT_DATE',context);
    if(isPurchase&&purchaseDate!==effectiveDate)issue('PURCHASE_DATE_MISMATCH',context);
    if(!isPurchase&&purchaseDate&&purchaseDate>effectiveDate)issue('BACKDATED_PURCHASE_REVIEW',context);
    if(isPurchase ? !purchaseId||purchaseId==='OVERSOLD'||status!=='active' : purchaseId!=='OVERSOLD'||status!=='oversold')issue('INVALID_LOT_SOURCE_STATUS',context);
    const conversion=typeof unit==='string'?cfg.unitScales.get(unit):undefined;
    if(!conversion)issue('UNKNOWN_QUANTITY_UNIT',context);
    const remaining=conversion?parseBaseQuantity(get(lot,'Remaining Quantity','remainingQuantity'),conversion,cfg,issue,context):null;
    const original=conversion?parseBaseQuantity(get(lot,'Original Quantity','originalQuantity'),conversion,cfg,issue,context):null;
    const cost=parseUnitCost(get(lot,'Purchase Price','purchasePrice'),issue,context);
    if(remaining!==null&&original!==null&&(
      original<0n || (isPurchase ? remaining<=0n||original<remaining : remaining>=0n||original<(-remaining))
    ))issue('ORIGINAL_QTY_INCONSISTENT',context);
    parsed.push({isPurchase,lotId,purchaseId,purchaseDate,remaining,original,cost,conversion});
  }
  if(issues.length) return zeroPlan(issues);
  const stock=parsed[0], debts=parsed.slice(1).sort((a,b)=>a.purchaseDate.localeCompare(b.purchaseDate)||a.lotId.localeCompare(b.lotId));
  let available=stock.remaining, allocated=0n, accumulatedActualCost=0n;
  const allocations=[],updatedDebtBaseQty=[];
  for(const debt of debts){
    const owed=-debt.remaining;
    const use=owed<available?owed:available;
    if(use>0n){
      const prev=accumulatedActualCost;
      allocated+=use;
      available-=use;
      accumulatedActualCost=rounded(stock.cost*allocated*stock.conversion.d,stock.conversion.n*cfg.scale);
      const actual=accumulatedActualCost-prev;
      const provisional=rounded(debt.cost*use*debt.conversion.d,debt.conversion.n*cfg.scale);
      allocations.push({tenantId:input.tenantId,operationId:input.operationId,productId:input.productId,
        oversoldLotId:debt.lotId,purchaseLotId:stock.lotId,purchaseId:stock.purchaseId,
        baseQty:safeNum(use,cfg.scale),provisionalCostMinor:safeNum(provisional),
        actualCostMinor:safeNum(actual),varianceMinor:safeNum(provisional-actual)});
    }
    updatedDebtBaseQty.push({lotId:debt.lotId,remainingBaseQty:safeNum(debt.remaining+use,cfg.scale)});
  }
  return frozen({allocations,purchaseOriginalBaseQty:safeNum(stock.original,cfg.scale),
    purchaseRemainingBaseQty:safeNum(available,cfg.scale),totalSettledBaseQty:safeNum(allocated,cfg.scale),
    updatedDebtBaseQty,reviewIssues:[]});
}
