/**
 * M05 PRIVATE Add Product and Products stock-cell preview.
 *
 * Reuses the approved source multi-unit chain/price resolver and exact Tiles
 * stock projection. All values are from caller-supplied source-shaped
 * snapshots. No Product ID issuance, D1 writes, RPC, stock movement, receipt,
 * permission check, Cash Session or Party accounting is performed here.
 *
 * Original source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * Approved multi-unit: sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c
 */
import {normalizeProductUnitChain_} from './product-unit-conversions.js';
import {normalizeProductPriceProfile_} from './m05-product-unit-price-profile.js';
import {resolveTileQuantityFromCatalog} from './tile-quantity-contract.js';
import {projectTileStockView} from './m05-tile-stock-view.js';

const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const WHOLE=/^(?:0|[1-9][0-9]*)$/u;
const SIGNED=/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u;
const MEASURE_KEYS=[
  'productId','revision','baseUnit','boxConversionId','boxUnitName',
  'length','width','dimensionUnit','piecesPerBox','coveragePolicy',
  'manufacturerSqftPerBox','manufacturerEvidence'
];

function record(value,allowed,required,label){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid '+label+' record');
  for(const key of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!allowed.includes(key)||!d.enumerable||
       !Object.hasOwn(d,'value'))
      throw new TypeError('Unsupported '+label+' field or accessor');
  }
  for(const key of required)
    if(!Object.hasOwn(value,key))
      throw new TypeError('Missing '+label+' field: '+key);
  return value;
}
function rows(value,label,min=0,max=100){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
      value.length<min||value.length>max)
    throw new TypeError('Invalid '+label+' array');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors)){
    if(key==='length')continue;
    if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/u.test(key)||
      Number(key)>=value.length||!Object.hasOwn(descriptors[key],'value'))
      throw new TypeError('Invalid '+label+' array accessor');
  }
  for(let i=0;i<value.length;i++)
    if(!Object.hasOwn(descriptors,String(i)))
      throw new TypeError('Invalid sparse '+label+' array');
  return value;
}
function identity(value,label){
  if(typeof value!=='string'||!value||value!==value.trim()||
    value.length>256||/[\u0000-\u001f\u007f]/u.test(value)||
    ['__proto__','constructor','prototype'].includes(value))
    throw new TypeError('Invalid '+label+' identity');
  return value;
}
function quantity(value,label,signed=false){
  if(typeof value!=='string'||!(signed?SIGNED:WHOLE).test(value))
    throw new TypeError('Invalid canonical whole '+label+' quantity');
  const amount=BigInt(value);
  if(amount>MAX||amount< -MAX)
    throw new RangeError(label+' quantity exceeds safe integer range');
  return amount;
}
function managedUnitNames(unitMasters){
  const list=rows(unitMasters,'unit master',1,500);
  const byName=new Map();
  for(const unit of list){
    record(unit,['Unit ID','Unit Name','Status','_rowIndex'],['Unit Name'],'unit master');
    const name=identity(unit['Unit Name'],'Unit');
    const key=name.toLowerCase();
    if(byName.has(key))throw new TypeError('Duplicate managed unit name: '+name);
    byName.set(key,unit);
  }
  return byName;
}
function activeUnit(name,names){
  identity(name,'unit');
  const row=names.get(name.toLowerCase());
  if(!row||row.Status==='Inactive')
    throw new TypeError(name+': unit must be an active Product Unit.');
  return name;
}
function chain(input){
  const id=identity(input.productId,'Product');
  const names=managedUnitNames(input.unitMasters);
  const relations=rows(input.unitRelations,'unit relations',0,12);
  for(const relation of relations)
    record(relation,['leftQty','leftUnit','rightQty','rightUnit'],
      ['leftQty','leftUnit','rightQty','rightUnit'],'unit relationship');
  const normalized=normalizeProductUnitChain_(relations,input.unitMasters,[]);
  const stockUnit=normalized.stockUnit||
    activeUnit(input.baseUnit,names);
  activeUnit(stockUnit,names);

  const tiers=[];
  const used=new Set();
  for(const item of normalized.conversions){
    activeUnit(item.unitName,names);
    const key=item.unitName.toLowerCase();
    if(used.has(key))throw new TypeError('Duplicate configured unit: '+item.unitName);
    used.add(key);
    if(!Number.isSafeInteger(item.factor)||item.factor<1)
      throw new TypeError('Invalid canonical whole-unit conversion factor');
    tiers.push({unitName:item.unitName,factor:item.factor});
  }
  tiers.sort((a,b)=>b.factor-a.factor);
  return {productId:id,names,stockUnit,tiers,normalized};
}
function catalogForTile(productId,stockUnit,tiers,measurement){
  record(measurement,MEASURE_KEYS,
    ['productId','revision','baseUnit','boxConversionId','length','width',
      'dimensionUnit','piecesPerBox','coveragePolicy'],'Tile measurement');
  if(measurement.productId!==productId||stockUnit!=='Pcs')
    throw new TypeError('Tile product identity or Pcs stock unit mismatch');
  if(measurement.coveragePolicy==='manufacturer'&&
      (!Object.hasOwn(measurement,'manufacturerSqftPerBox')||
        !Object.hasOwn(measurement,'manufacturerEvidence')))
    throw new TypeError('Manufacturer coverage requires verified evidence');
  const conversionId=identity(measurement.boxConversionId,'Tile box conversion');
  const boxName=measurement.boxUnitName||'Box';
  const matched=tiers.filter(x=>x.unitName===boxName);
  if(matched.length!==1||tiers.length!==1)
    throw new TypeError('Tile pack mismatch: configure exactly Box to Pcs');
  const factor=matched[0].factor;
  if(String(factor)!==measurement.piecesPerBox)
    throw new TypeError('Tile pack mismatch against conversion factor');
  if(typeof measurement.revision!=='string'||!WHOLE.test(measurement.revision)||
      !Number.isSafeInteger(Number(measurement.revision))||Number(measurement.revision)<=0)
    throw new TypeError('Invalid Tile measurement revision');
  return {
    productId,baseUnitName:'Pcs',
    unitConfig:{
      revision:Number(measurement.revision),
      stockUnitName:'Pcs',
      conversions:[{conversionId,unitName:boxName,factorText:String(factor)}]
    }
  };
}
function unitLabel(stock,tiers,baseUnit){
  let rem=stock;
  const parts=[];
  for(const tier of tiers){
    const factor=BigInt(tier.factor);
    const count=rem/factor;
    rem%=factor;
    if(count>0n)parts.push(String(count)+' '+tier.unitName);
  }
  if(rem>0n||parts.length===0)
    parts.push(String(rem)+' '+baseUnit);
  return parts.join(' ');
}
function project(input,stock){
  const c=chain(input);
  const negative=stock<0n;
  const magnitude=negative?-stock:stock;
  let text=unitLabel(magnitude,c.tiers,c.stockUnit);
  let tile;
  if(Object.hasOwn(input,'tileMeasurement')){
    const catalog=catalogForTile(c.productId,c.stockUnit,c.tiers,input.tileMeasurement);
    tile=projectTileStockView(catalog,input.tileMeasurement,String(stock));
    // The source product Stock cell is a compact, human-readable display.
    // The exact rational area stays separate; the display is never authority.
    if(tile.stockState!=='zero')
      text+=' · '+(negative?tile.displaySqft.slice(1):tile.displaySqft)+' Sqft';
    else text+=' · 0.00 Sqft';
  }
  if(negative)text='Shortage: '+text;
  return {
    productId:c.productId,
    stockUnit:c.stockUnit,
    conversions:c.normalized.conversions,
    baseStock:String(stock),stockState:stock===0n?'zero':negative?'oversold':'available',
    stockCellText:text,
    ...(tile?{tile}:{}),
    stockAuthority:'snapshot-only',
    postingAllowed:false
  };
}
/** A read-only row projection of an already trusted Product.Current Stock. */
export function formatM05ProductStockCell(input){
  record(input,['productId','unitRelations','unitMasters','baseUnit',
    'baseStockText','tileMeasurement'],
    ['productId','unitRelations','unitMasters','baseStockText'],'Product stock cell');
  const stock=quantity(input.baseStockText,'base stock',true);
  return project(input,stock);
}
/** Proposed original-source Add Product configuration and opening-stock math. */
export function previewM05ProductAddForm(input){
  record(input,['productId','unitRelations','unitMasters','baseUnit',
    'openingUnits','prices','tileMeasurement'],
    ['productId','unitRelations','unitMasters','openingUnits','prices'],
    'Product Add');
  const c=chain(input);
  const prices=record(input.prices,
    ['purchasePrice','sellingPrice','purchasePriceUnit','sellingPriceUnit',
      'unitPriceOverrides'],
    ['purchasePrice','sellingPrice'],'Product price');
  for(const key of ['purchasePrice','sellingPrice'])
    if(typeof prices[key]!=='number'||!Number.isFinite(prices[key])||prices[key]<0)
      throw new TypeError('Invalid Product '+key+' price');
  const overrides=Object.hasOwn(prices,'unitPriceOverrides')?
    rows(prices.unitPriceOverrides,'price overrides'):rows([],'price overrides');
  for(const row of overrides)
    record(row,['unitName','purchasePrice','sellingPrice'],['unitName'],'price override');
  const priceSnapshot=normalizeProductPriceProfile_(
    c.stockUnit,c.normalized.conversions,{...prices,unitPriceOverrides:overrides}
  );
  const opening=rows(input.openingUnits,'opening units',1,20);
  const seen=new Set(),openingSnapshot=[];
  let stock=0n;
  const factors=new Map(c.tiers.map(x=>[x.unitName.toLowerCase(),BigInt(x.factor)]));
  factors.set(c.stockUnit.toLowerCase(),1n);
  for(const entry of opening){
    record(entry,['unitName','qtyText'],['unitName','qtyText'],'opening unit');
    const unitName=activeUnit(entry.unitName,c.names);
    const nameKey=unitName.toLowerCase();
    if(seen.has(nameKey))throw new TypeError('Duplicate opening unit: '+unitName);
    seen.add(nameKey);
    const factor=factors.get(nameKey);
    if(!factor)throw new TypeError('Opening unit is not configured');
    const count=quantity(entry.qtyText,'opening stock');
    stock+=count*factor;
    if(stock>MAX)throw new RangeError('Opening stock exceeds safe integer range');
    openingSnapshot.push({unitName,qtyText:String(count),factor:String(factor)});
  }
  const projected=project(input,stock);
  return {
    ...projected,mode:'read-only-product-add-preview',
    openingSnapshot,priceSnapshot,
    postingAllowed:false
  };
}
/** Enter Sqft, round UP to physical Pcs and show actually fulfilled area. */
export function previewM05TileAreaOpening(input){
  record(input,['productId','unitRelations','unitMasters','baseUnit',
    'tileMeasurement','requestedSqft','fulfillment'],
    ['productId','unitRelations','unitMasters','tileMeasurement',
      'requestedSqft','fulfillment'],'Tile area opening');
  const c=chain(input);
  const catalog=catalogForTile(c.productId,c.stockUnit,c.tiers,input.tileMeasurement);
  const quantityResult=resolveTileQuantityFromCatalog(catalog,input.tileMeasurement,{
    mode:'area',requestedSqft:input.requestedSqft,fulfillment:input.fulfillment
  });
  return {
    ...project(input,BigInt(quantityResult.pieces)),
    mode:'read-only-tile-area-opening-preview',
    requestedSqft:input.requestedSqft,
    requestedAreaExact:quantityResult.requestedSqft,
    postingAllowed:false
  };
}
