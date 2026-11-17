/**
 * M05 internal, read-only source Tiles stock-lot reconciliation.
 *
 * The frozen StockLots.gs source reconciles Product Current Stock against
 * ALL source lot Remaining Quantities, including OVERSOLD and Deleted rows.
 * For Tiles, preserve the dated source's versioned measurement/Box revision
 * through M05's reviewed signed stock-view contract, never today's config.
 *
 * This function is not a stock reservation, a repair routine, an importer,
 * D1 data access layer, an authenticated read endpoint or a posting engine.
 */
import {projectTileStockView} from './m05-tile-stock-view.js';

const MAX_PCS=BigInt(Number.MAX_SAFE_INTEGER);
const CANONICAL_PCS=/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u;
const MEASUREMENT_IDENTITY=[
  'productId','revision','baseUnit','boxConversionId','boxUnitName',
  'length','width','dimensionUnit','piecesPerBox','coveragePolicy',
  'manufacturerSqftPerBox','manufacturerEvidence'
];

function record(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Explicit trusted tile '+label+' record required');
  for(const key of Reflect.ownKeys(value)){
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!keys.includes(key)||
        !descriptor.enumerable||!Object.hasOwn(descriptor,'value'))
      throw new TypeError('Invalid tile '+label+' field or accessor');
  }
  for(const key of keys)if(!Object.hasOwn(value,key))
    throw new TypeError('Missing tile '+label+' field: '+key);
  return value;
}

function list(value){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)
    throw new TypeError('Explicit tile lots array required');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors)){
    if(key==='length')continue;
    const descriptor=descriptors[key];
    if(typeof key!=='string'||!/^(0|[1-9][0-9]*)$/u.test(key)||
        Number(key)>=value.length||!Object.hasOwn(descriptor,'value'))
      throw new TypeError('Invalid tile lots array field or accessor');
  }
  for(let i=0;i<value.length;i++)
    if(!Object.hasOwn(descriptors,String(i)))
      throw new TypeError('Sparse tile lots array is not trusted');
  return value;
}

function identity(value,label){
  if(typeof value!=='string'||!value||value!==value.trim()||
      value.length>256||/[\u0000-\u001f\u007f]/u.test(value))
    throw new TypeError('Invalid original tile '+label+' identity');
  return value;
}

function pcs(value){
  if(typeof value!=='string'||!CANONICAL_PCS.test(value))
    throw new TypeError('Invalid canonical tile stock Pcs integer');
  const n=BigInt(value);
  if(n>MAX_PCS||n< -MAX_PCS)
    throw new RangeError('Tile stock Pcs exceeds safe integer compatibility');
  return n;
}

function gcd(a,b){
  if(a<0n)a= -a;
  while(b!==0n)[a,b]=[b,a%b];
  return a;
}

function addExact(a,b){
  const n=a.n*BigInt(b.denominator)+BigInt(b.numerator)*a.d;
  const d=a.d*BigInt(b.denominator);
  const g=gcd(n,d);
  return {n:n/g,d:d/g};
}

function areaIdentity(measurement){
  return JSON.stringify(MEASUREMENT_IDENTITY.map(
    key=>Object.hasOwn(measurement,key)?measurement[key]:null
  ));
}

/** A trusted single-product historical LOT snapshot, never posting authority. */
export function auditTileLotStock(snapshot){
  const s=record(snapshot,['productId','cachedStockPcs','lots'],'lot audit snapshot');
  const productId=identity(s.productId,'product');
  const cached=pcs(s.cachedStockPcs);
  const lots=list(s.lots);
  const ids=new Set(),issues=[],lotViews=[];
  let lotStock=0n,amount={n:0n,d:1n},signature=null,mixed=false;

  for(const raw of lots){
    const lot=record(raw,[
      'lotId','productId','remainingPcs','status','catalog','measurement'
    ],'lot');
    const lotId=identity(lot.lotId,'lot');
    if(ids.has(lotId))throw new TypeError('Duplicate tile lot identity: '+lotId);
    ids.add(lotId);
    if(identity(lot.productId,'product')!==productId)
      throw new TypeError('Original tile lot product identity mismatch');
    const remaining=pcs(lot.remainingPcs);
    if(typeof lot.status!=='string'||lot.status!==lot.status.trim()||
        !lot.status||lot.status.length>64)
      throw new TypeError('Invalid tile lot status');
    // Caller owns tenant-specific provenance and immutable history retrieval.
    // The versioned quantity contract rejects mismatched product/revision/pack.
    const view=projectTileStockView(lot.catalog,lot.measurement,lot.remainingPcs);
    if(view.productId!==productId)
      throw new TypeError('Historical tile lot product identity mismatch');

    lotStock+=remaining;
    if(lotStock>MAX_PCS||lotStock< -MAX_PCS)
      throw new RangeError('Tile lot stock summation exceeds safe integer range');
    amount=addExact(amount,view.actualSqft);
    const currentSignature=areaIdentity(view.measurementSnapshot);
    if(signature===null)signature=currentSignature;
    else if(currentSignature!==signature)mixed=true;
    if(remaining>0n&&lot.status.toLowerCase()==='deleted')
      issues.push({code:'DELETED_POSITIVE_LOT',lotId});
    lotViews.push({lotId,status:lot.status,remainingPcs:lot.remainingPcs,view});
  }

  const difference=lotStock-cached;
  let status;
  if(lots.length===0){
    status=cached===0n?'NO_LOTS_ZERO':'NO_LOTS_NONZERO';
    if(cached!==0n)issues.push({code:status,productId});
  }else{
    status=difference===0n?'MATCH':'MISMATCH';
    if(difference!==0n)issues.push({code:'STOCK_MISMATCH',productId});
  }
  const areaState=lots.length===0?'NO_LOTS':
    mixed?'MIXED_MEASUREMENTS':'UNIFORM_MEASUREMENT';
  return {
    mode:'read-only-tile-lot-audit',productId,cachedStockPcs:s.cachedStockPcs,
    lotStockPcs:String(lotStock),differencePcs:String(difference),status,
    areaState,aggregateSqft:areaState==='UNIFORM_MEASUREMENT'
      ?{numerator:String(amount.n),denominator:String(amount.d)}:null,
    lotViews,issues,ready:issues.length===0,postingAllowed:false
  };
}
