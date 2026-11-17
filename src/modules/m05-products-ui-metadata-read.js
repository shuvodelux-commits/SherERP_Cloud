/**
 * M05 PRIVATE read-only adapter for an already authenticated, tenant-scoped
 * projectProductsBootstrap result plus its current unit/Tile source snapshots.
 *
 * M03 must query and authorize every Product, unit and revision in one tenant.
 * Nothing here reads D1, issues a Product ID, authorizes posting or exposes RPC.
 * The M01 Products table consumes only the optional 'M05 Stock Preview' value.
 */
import {formatM05ProductStockCell} from './m05-product-form-stock-preview.js';

const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const SIGNED=/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u;
const REVISION=/^[1-9][0-9]*$/u;

function plain(value,label){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Invalid trusted '+label+' record');
  for(const key of Reflect.ownKeys(value)){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string'||!d.enumerable||!Object.hasOwn(d,'value'))
      throw new TypeError('Invalid trusted '+label+' accessor or source field');
  }
  return value;
}
function exact(value,keys,required,label){
  plain(value,label);
  for(const key of Reflect.ownKeys(value)){
    if(!keys.includes(key))
      throw new TypeError('Unsupported '+label+' field: '+key);
  }
  for(const key of required){
    if(!Object.hasOwn(value,key))
      throw new TypeError('Missing '+label+' field: '+key);
  }
  return value;
}
function array(value,label,max=10000){
  if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||
     value.length>max)
    throw new TypeError('Invalid '+label+' source array');
  const desc=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(desc)){
    if(key==='length')continue;
    if(typeof key!=='string'||!/^(?:0|[1-9][0-9]*)$/u.test(key)||
       Number(key)>=value.length||!Object.hasOwn(desc[key],'value'))
      throw new TypeError('Invalid '+label+' array accessor');
  }
  for(let i=0;i<value.length;i++){
    if(!Object.hasOwn(desc,String(i)))
      throw new TypeError('Sparse '+label+' source array');
  }
  return value;
}
function identity(value,label){
  if(typeof value!=='string'||!value||value!==value.trim()||
     value.length>256||/[\u0000-\u001f\u007f]/u.test(value)||
     ['__proto__','constructor','prototype'].includes(value))
    throw new TypeError('Invalid original '+label+' identity');
  return value;
}
function revision(value,label){
  if(typeof value!=='string'||!REVISION.test(value)||
    BigInt(value)>MAX)
    throw new TypeError('Invalid canonical '+label+' revision');
  return value;
}
function stock(value){
  const text=typeof value==='number'&&Number.isSafeInteger(value)?
    String(value):value;
  if(typeof text!=='string'||!SIGNED.test(text))
    throw new TypeError('Invalid canonical physical Current Stock integer');
  const quantity=BigInt(text);
  if(quantity>MAX||quantity< -MAX)
    throw new RangeError('Current Stock exceeds safe integer range');
  return text;
}
function unitsFromSource(sourceUnits){
  const seenNames=new Set(),seenIds=new Set();
  return array(sourceUnits,'active unit masters',500).map(row=>{
    exact(row,['id','name'],['id','name'],'unit master');
    const name=identity(row.name,'unit name');
    const id=identity(row.id,'Unit ID');
    const key=name.toLowerCase();
    if(seenNames.has(key)||seenIds.has(id))
      throw new TypeError('Duplicate active unit name or ID');
    seenNames.add(key);seenIds.add(id);
    return {'Unit ID':id,'Unit Name':name,Status:'Active'};
  });
}
function sourceRelations(value){
  return array(value,'unit relationships',12).map(row=>{
    exact(row,['leftQty','leftUnit','rightQty','rightUnit'],
      ['leftQty','leftUnit','rightQty','rightUnit'],'unit relationship');
    identity(row.leftUnit,'left unit');identity(row.rightUnit,'right unit');
    return {leftQty:row.leftQty,leftUnit:row.leftUnit,
      rightQty:row.rightQty,rightUnit:row.rightUnit};
  });
}

/**
 * Input is already tenant-scoped and authorized by M03/M04, not the browser.
 * Configs MUST come from an independently reviewed current source revision,
 * not from client-supplied proposed Product Add form values.
 */
export function attachM05ProductStockMetadata(input){
  exact(input,['bootstrap','configs'],['bootstrap','configs'],'metadata input');
  const bootstrap=exact(input.bootstrap,
    ['products','categories','units','currencySymbol','lowStockThreshold'],
    ['products','categories','units','currencySymbol','lowStockThreshold'],
    'source Products bootstrap');

  const products=array(bootstrap.products,'products');
  array(bootstrap.categories,'categories');
  const activeUnits=unitsFromSource(bootstrap.units);
  const byId=new Map();
  for(const row of products){
    plain(row,'source product');
    const id=identity(row['Product ID'],'Product ID');
    if(byId.has(id))throw new TypeError('Duplicate original Product ID: '+id);
    byId.set(id,row);
  }

  const configs=array(input.configs,'M05 product configuration');
  const configured=new Map();
  for(const cfg of configs){
    exact(cfg,['productId','unitRelations','unitRevision','currentUnitRevision',
      'tileMeasurement','currentTileRevision'],
      ['productId','unitRelations','unitRevision','currentUnitRevision'],
      'M05 product config');
    const productId=identity(cfg.productId,'configured Product ID');
    if(configured.has(productId))
      throw new TypeError('Duplicate Product config ID: '+productId);
    const row=byId.get(productId);
    if(!row)
      throw new Error('Unknown source Product ID in current tenant snapshot: '+productId);
    if(row['Product Type']==='Bundle')
      throw new Error('Bundle is a virtual product; no physical unit config');
    if(Object.hasOwn(row,'M05 Stock Preview'))
      throw new Error('Existing M05 Stock Preview metadata must not be overwritten');

    const unitRev=revision(cfg.unitRevision,'unit snapshot');
    const activeUnitRev=revision(cfg.currentUnitRevision,'current unit');
    if(unitRev!==activeUnitRev)
      throw new Error('Stale unit revision for Product: '+productId);

    const relations=sourceRelations(cfg.unitRelations);
    if(relations.length===0)
      throw new Error('Unit relationship config required for physical multi-unit stock');
    let measurement;
    if(Object.hasOwn(cfg,'tileMeasurement')){
      plain(cfg.tileMeasurement,'tile measurement');
      const current=revision(cfg.currentTileRevision,'current Tile measurement');
      if(revision(cfg.tileMeasurement.revision,'Tile snapshot')!==current)
        throw new Error('Stale Tile measurement revision: '+productId);
      if(cfg.tileMeasurement.productId!==productId)
        throw new TypeError('Tile measurement Product ID mismatch');
      measurement={...cfg.tileMeasurement};
    }else if(Object.hasOwn(cfg,'currentTileRevision')){
      throw new TypeError('Current Tile revision requires a Tile measurement snapshot');
    }

    const originalBase=stock(row['Current Stock']);
    const candidate={
      productId,
      unitMasters:activeUnits.map(u=>({...u})),
      unitRelations:relations,
      ...(measurement?{tileMeasurement:measurement}:{})
    };

    // Source-backed validator also tests active units, connected conversion,
    // current pack/revision, exact rational Sqft and manufacturer evidence.
    const preview=formatM05ProductStockCell({
      ...candidate,baseStockText:originalBase
    });
    if(preview.productId!==productId||preview.postingAllowed!==false)
      throw new Error('M05 stock metadata must never grant posting authority');
    if(row.Unit!==preview.stockUnit)
      throw new Error('Product source Unit/base unit mismatch: '+productId);
    configured.set(productId,candidate);
  }

  return {
    ...bootstrap,
    products:products.map(row=>{
      const cfg=configured.get(row['Product ID']);
      return cfg?{...row,'M05 Stock Preview':cfg}:{...row};
    }),
    postingAllowed:false
  };
}
