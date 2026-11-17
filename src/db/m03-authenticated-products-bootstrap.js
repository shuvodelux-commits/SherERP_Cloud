/**
 * M03 #621 — private, SELECT-only authenticated Products bootstrap read proof.
 * Tenant mapping, stocks, lots, tile measurements and display settings here
 * are disposable *synthetic_m03_* D1 fixtures, not production migrations.
 * Never import from src/index.js or register public RPC before M02/M04 gates.
 */
import {requireD1Binding} from './d1-binding.js';
import {AUTH_POLICY} from '../auth/d1-auth-core.js';
import {projectProductsBootstrap}
 from '../modules/m05-product-bootstrap-valuation.js';
import {attachM05ProductStockMetadata}
 from '../modules/m05-products-ui-metadata-read.js';

const DENIED='M03 authenticated Products bootstrap rejected';
const fail=()=>{throw new Error(DENIED);};
const TOKEN=/^[0-9a-f]{64}$/;
const INTEGER=/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const POSITIVE=/^[1-9][0-9]*$/;
const MAX_ROWS=1000;

// Identical active session/version/literal-boolean role gates to the
// merged M04 SQL-current role predicate. The tenant comes ONLY from this
// session's D1 link. No client-supplied tenant, actor, role, or Product ID.
const AUTH='SELECT t.tenant_id FROM auth_sessions s '+
 'JOIN auth_users u ON u.user_id=s.user_id '+
 'LEFT JOIN auth_roles r ON r.role_name=u.role_name '+
 'JOIN synthetic_m03_session_tenants t ON t.token_hash=s.token_hash '+
 'WHERE s.token_hash=? AND s.revoked_at_ms IS NULL '+
 'AND s.created_at_ms<=? AND s.expires_at_ms>? '+
 'AND s.last_activity_at_ms>? AND s.last_activity_at_ms<=? '+
 "AND u.status='Active' AND u.credential_state='Modern' "+
 'AND u.auth_version=s.user_auth_version '+
 'AND u.credential_version=s.credential_version '+
 "AND ((u.role_name='Administrator' AND s.role_auth_version IS NULL) "+
 "OR (u.role_name<>'Administrator' AND r.status='Active' "+
 'AND r.auth_version=s.role_auth_version AND length(r.permissions_json)<=65536 '+
 'AND CASE WHEN json_valid(r.permissions_json) THEN '+
 "json_type(r.permissions_json)='object' "+
 "AND json_type(r.permissions_json,'$.products')='object' "+
 "AND json_type(r.permissions_json,'$.products.view')='true' "+
 'ELSE 0 END)) LIMIT 2';
const SCOPE='WITH authorized AS ('+AUTH+') ';
// All underlying Products/catalog/stock reads join the same live session
// authorization CTE, so no later unguarded SELECT uses a stale JS tenant.
const READ_PRODUCTS=SCOPE+
 'SELECT p.product_id,p.source_profile,p.source_snapshot_row_id,p.legacy_sheet_row,'+
 'p.product_name,p.brand_text,p.category_name,p.base_unit_name,p.base_unit_id,'+
 'p.purchase_price_text,p.selling_price_text,p.minimum_stock_text,'+
 'p.product_type_text,p.bundle_revision_text,p.status,p.is_deleted,'+
 'p.current_unit_revision,p.record_version,'+
 's.physical_qty_text,s.is_tile,'+
 'arch.product_id AS archive_product_id,'+
 'arch.legacy_sheet_row AS archive_sheet_row,'+
 'arch.unit_text AS archive_unit,arch.source_profile AS archive_profile '+
 'FROM authorized auth '+
 'JOIN synthetic_m03_product_tenants owner ON owner.tenant_id=auth.tenant_id '+
 'JOIN products p ON p.product_id=owner.product_id '+
 'LEFT JOIN synthetic_m03_product_stock s '+
 'ON s.tenant_id=auth.tenant_id AND s.product_id=p.product_id '+
 'LEFT JOIN legacy_product_snapshots arch ON arch.row_id=p.source_snapshot_row_id '+
 'ORDER BY p.legacy_sheet_row,p.product_id LIMIT 1001';
const READ_UNITS=SCOPE+
 'SELECT u.unit_id,u.unit_name,u.status FROM authorized auth '+
 'JOIN synthetic_m03_unit_tenants owner ON owner.tenant_id=auth.tenant_id '+
 'JOIN product_units u ON u.unit_id=owner.unit_id '+
 'ORDER BY u.legacy_sheet_row,u.unit_id LIMIT 1001';
const READ_CATEGORIES=SCOPE+
 'SELECT c.category_id,c.category_name,c.status FROM authorized auth '+
 'JOIN synthetic_m03_category_tenants owner ON owner.tenant_id=auth.tenant_id '+
 'JOIN product_categories c ON c.category_id=owner.category_id '+
 'ORDER BY c.legacy_sheet_row,c.category_id LIMIT 1001';
const READ_PROFILES=SCOPE+
 'SELECT profile.product_id,profile.revision,profile.stock_unit_name '+
 'FROM authorized auth '+
 'JOIN synthetic_m03_product_tenants owner ON owner.tenant_id=auth.tenant_id '+
 'JOIN products p ON p.product_id=owner.product_id '+
 'JOIN product_unit_profiles profile ON profile.product_id=p.product_id '+
 'AND profile.revision=p.current_unit_revision '+
 'WHERE p.current_unit_revision>0 ORDER BY profile.product_id LIMIT 1001';
const READ_RELATIONS=SCOPE+
 'SELECT c.product_id,c.revision,c.conversion_id,c.unit_name,'+
 'c.reviewed_unit_master_id,c.relation_qty_text,c.relation_unit_name,'+
 'c.factor_text,c.status,c.sort_order '+
 'FROM authorized auth '+
 'JOIN synthetic_m03_product_tenants owner ON owner.tenant_id=auth.tenant_id '+
 'JOIN products p ON p.product_id=owner.product_id '+
 'JOIN product_unit_conversions c ON c.product_id=p.product_id '+
 'AND c.revision=p.current_unit_revision '+
 'ORDER BY c.product_id,c.sort_order,c.conversion_id LIMIT 1001';
const READ_TILE=SCOPE+
 'SELECT t.product_id,t.unit_revision,t.current_measurement_revision,'+
 't.measurement_json FROM authorized auth '+
 'JOIN synthetic_m03_tile_current t ON t.tenant_id=auth.tenant_id '+
 'JOIN synthetic_m03_product_tenants owner ON owner.tenant_id=auth.tenant_id '+
 'AND owner.product_id=t.product_id '+
 'ORDER BY t.product_id LIMIT 1001';
const READ_STOCK_LOTS=SCOPE+
 'SELECT l.lot_id,l.product_id,l.remaining_qty_text,l.purchase_price_text,'+
 'l.purchase_id FROM authorized auth '+
 'JOIN synthetic_m03_stock_lots l ON l.tenant_id=auth.tenant_id '+
 'JOIN synthetic_m03_product_tenants owner ON owner.tenant_id=auth.tenant_id '+
 'AND owner.product_id=l.product_id '+
 'ORDER BY l.lot_id LIMIT 1001';
const READ_BUNDLE_PARTS=SCOPE+
 'SELECT b.bundle_id,b.component_id,b.qty_per_set_text,b.unit_name,'+
 'b.revision,b.status FROM authorized auth '+
 'JOIN synthetic_m03_bundle_components b ON b.tenant_id=auth.tenant_id '+
 'JOIN synthetic_m03_product_tenants owner ON owner.tenant_id=auth.tenant_id '+
 'AND owner.product_id=b.bundle_id '+
 'JOIN synthetic_m03_product_tenants component ON component.tenant_id=auth.tenant_id '+
 'AND component.product_id=b.component_id '+
 'ORDER BY b.bundle_id,b.component_id,b.revision LIMIT 1001';
const READ_SETTINGS=SCOPE+
 'SELECT v.currency_symbol,v.low_stock_threshold_text FROM authorized auth '+
 'JOIN synthetic_m03_tenant_settings v ON v.tenant_id=auth.tenant_id LIMIT 2';

function exact(record,names){
 if(!record||typeof record!=='object'||Array.isArray(record)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(record)))fail();
 const descriptors=Object.getOwnPropertyDescriptors(record);
 const fields=Reflect.ownKeys(descriptors);
 if(fields.length!==names.length||
    fields.some(k=>typeof k!=='string'||!names.includes(k))||
    names.some(k=>!descriptors[k]?.enumerable||
      !Object.hasOwn(descriptors[k],'value')))fail();
 return Object.fromEntries(names.map(k=>[k,descriptors[k].value]));
}
function expectedRows(result,columns,max=MAX_ROWS){
 if(result?.success!==true||!Array.isArray(result.results)||
    result.results.length>max)fail();
 return result.results.map(r=>exact(r,columns));
}
const ids=(rows,key)=>{
 const seen=new Set();
 for(const row of rows){
  const id=row[key];
  if(typeof id!=='string'||!id||id!==id.trim()||seen.has(id))fail();
  seen.add(id);
 }
 return seen;
};
function revision(value,allowZero=false){
 if(!Number.isSafeInteger(value)||value<0||
    (!allowZero&&value===0))fail();
 return value;
}
function canonicalSigned(text){
 if(typeof text!=='string'||!INTEGER.test(text)||!Number.isSafeInteger(Number(text)))fail();
 return Number(text);
}
function canonicalPositive(text){
 if(typeof text!=='string'||!POSITIVE.test(text)||!Number.isSafeInteger(Number(text)))fail();
 return text;
}
function safeText(v){
 if(typeof v!=='string'||v.length>4096)fail();
 return v;
}
function masterRows(rows,id,name,type){
 ids(rows,id);
 return rows.map(row=>{
  if(!['Active','Inactive'].includes(row.status))fail();
  return {[(type==='unit'?'Unit ID':'Category ID')]:row[id],
   [(type==='unit'?'Unit Name':'Category Name')]:safeText(row[name]),
   Status:row.status};
 });
}
function compose(snapshot){
 const [products,units,categories,profiles,conversions,tiles,lots,bundles,settings]=snapshot;
 if(settings.length!==1)fail();
 const seen=ids(products,'product_id'),profilesById=new Map();
 const activeUnits=new Map();
 for(const unit of units){
  if(unit.status!=='Active')continue;
  if(activeUnits.has(unit.unit_name.toLowerCase()))fail();
  activeUnits.set(unit.unit_name.toLowerCase(),unit.unit_id);
 }
 for(const profile of profiles){
  if(!seen.has(profile.product_id)||profilesById.has(profile.product_id))fail();
  revision(profile.revision);
  profilesById.set(profile.product_id,profile);
 }
 const relById=new Map(),tileById=new Map();
 for(const c of conversions){
  if(!seen.has(c.product_id)||c.status!=='Active'||
     typeof c.conversion_id!=='string'||!c.conversion_id.trim()||
     !c.reviewed_unit_master_id||
     activeUnits.get(c.unit_name.toLowerCase())!==c.reviewed_unit_master_id||
     !activeUnits.has(c.relation_unit_name.toLowerCase())||
     typeof c.factor_text!=='string'||!c.factor_text.trim())fail();
  revision(c.revision);
  const row=products.find(p=>p.product_id===c.product_id);
  if(c.revision!==row.current_unit_revision)fail();
  const relations=relById.get(c.product_id)||[];
  relations.push({leftQty:1,leftUnit:c.unit_name,
   rightQty:canonicalPositive(c.relation_qty_text),rightUnit:c.relation_unit_name});
  relById.set(c.product_id,relations);
 }
 for(const t of tiles){
  if(!seen.has(t.product_id)||tileById.has(t.product_id))fail();
  revision(t.unit_revision);revision(t.current_measurement_revision);
  if(typeof t.measurement_json!=='string'||t.measurement_json.length>4096)fail();
  let measurement;
  try{measurement=JSON.parse(t.measurement_json);}catch{fail();}
  const required=['productId','revision','baseUnit','boxConversionId',
   'boxUnitName','length','width','dimensionUnit','piecesPerBox','coveragePolicy'];
  const allowed=[...required,'manufacturerSqftPerBox','manufacturerEvidence'];
  const properties=Object.getOwnPropertyDescriptors(measurement);
  if(!measurement||typeof measurement!=='object'||Array.isArray(measurement)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(measurement))||
     Reflect.ownKeys(properties).some(key=>typeof key!=='string'||!allowed.includes(key)||
       !properties[key]?.enumerable||!Object.hasOwn(properties[key],'value'))||
     required.some(key=>!Object.hasOwn(properties,key)))fail();
  if(measurement.productId!==t.product_id||
     measurement.revision!==String(t.current_measurement_revision))fail();
  tileById.set(t.product_id,t);
 }
 const cfgs=[];
 const sourceProducts=products.map(p=>{
  if(!/^PRD-[0-9]{6,}$/.test(p.product_id)||
     p.source_profile!=='canonical'||p.archive_profile!=='canonical'||
     p.archive_product_id!==p.product_id||
     p.archive_sheet_row!==p.legacy_sheet_row||
     p.archive_unit!==p.base_unit_name||
     !Number.isSafeInteger(p.source_snapshot_row_id)||
     !Number.isSafeInteger(p.legacy_sheet_row)||p.legacy_sheet_row<2||
     (p.is_deleted!==0&&p.is_deleted!==1)||
     !['Active','Inactive'].includes(p.status)||
     (p.is_tile!==0&&p.is_tile!==1)||
     typeof p.product_name!=='string'||!p.product_name.trim())fail();
  const stock=canonicalSigned(p.physical_qty_text);
  const unitRevision=revision(p.current_unit_revision,true);
  const profile=profilesById.get(p.product_id);
  const relations=relById.get(p.product_id)||[];
  const tile=tileById.get(p.product_id);
  if(p.product_type_text==='Bundle'&&
     (unitRevision!==0||tile||stock!==0))fail();
  if(unitRevision===0){
   if(profile||relations.length||tile||p.is_tile===1)fail();
  }else{
   if(!profile||profile.revision!==unitRevision||
      profile.stock_unit_name!==p.base_unit_name||relations.length===0||
      activeUnits.get(p.base_unit_name.toLowerCase())!==p.base_unit_id)fail();
   const cfg={productId:p.product_id,unitRelations:relations,
    unitRevision:String(unitRevision),currentUnitRevision:String(unitRevision)};
   if(p.is_tile===1){
    if(!tile||tile.unit_revision!==unitRevision)fail();
    cfg.currentTileRevision=String(tile.current_measurement_revision);
    cfg.tileMeasurement=JSON.parse(tile.measurement_json);
   }else if(tile)fail();
   cfgs.push(cfg);
  }
  return {'Product ID':p.product_id,'Product Name':p.product_name,
   Brand:p.brand_text,Category:p.category_name,Unit:p.base_unit_name,
   'Current Stock':stock,'Purchase Price':safeText(p.purchase_price_text),
   'Selling Price':safeText(p.selling_price_text),
   'Minimum Stock':safeText(p.minimum_stock_text),
   'Product Type':p.product_type_text==='Bundle'?'Bundle':'Standard',
   'Bundle Revision':p.bundle_revision_text,'Is Deleted':p.is_deleted===1?'TRUE':'FALSE',
   Status:p.status};
 });
 ids(lots,'lot_id');
 for(const lot of lots)if(!seen.has(lot.product_id))fail();
 for(const bundle of bundles)if(!seen.has(bundle.bundle_id)||
   !seen.has(bundle.component_id))fail();
 const source={
  productRows:sourceProducts,
  categoryRows:masterRows(categories,'category_id','category_name','category'),
  unitRows:masterRows(units,'unit_id','unit_name','unit'),
  stockLots:lots.map(l=>({
   'Lot ID':l.lot_id,'Product ID':l.product_id,
   'Remaining Quantity':safeText(l.remaining_qty_text),
   'Purchase Price':safeText(l.purchase_price_text),
   'Purchase ID':safeText(l.purchase_id)
  })),
  bundleComponentRows:bundles.map(b=>({
   'Bundle Product ID':b.bundle_id,'Component Product ID':b.component_id,
   'Quantity Per Set':safeText(b.qty_per_set_text),
   Unit:safeText(b.unit_name),Revision:b.revision,Status:safeText(b.status)
  })),
  settings:{'Currency Symbol':safeText(settings[0].currency_symbol),
   'Low Stock Threshold':safeText(settings[0].low_stock_threshold_text)}
 };
 const bootstrap=projectProductsBootstrap(source);
 return attachM05ProductStockMetadata({bootstrap,configs:cfgs});
}
async function hashToken(token){
 const bytes=new Uint8Array(32);
 for(let i=0;i<32;i++)
  bytes[i]=Number.parseInt(token.slice(i*2,i*2+2),16);
 const sum=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return Array.from(sum,b=>b.toString(16).padStart(2,'0')).join('');
}
async function all(DB,sql,bindings,columns,max){
 const result=await DB.prepare(sql).bind(...bindings).all();
 return expectedRows(result,columns,max);
}
const fields={
 products:['product_id','source_profile','source_snapshot_row_id','legacy_sheet_row',
  'product_name','brand_text','category_name','base_unit_name','base_unit_id',
  'purchase_price_text','selling_price_text','minimum_stock_text',
  'product_type_text','bundle_revision_text','status','is_deleted',
  'current_unit_revision','record_version','physical_qty_text','is_tile',
  'archive_product_id','archive_sheet_row','archive_unit','archive_profile'],
 units:['unit_id','unit_name','status'],
 categories:['category_id','category_name','status'],
 profiles:['product_id','revision','stock_unit_name'],
 conversions:['product_id','revision','conversion_id','unit_name',
  'reviewed_unit_master_id','relation_qty_text','relation_unit_name',
  'factor_text','status','sort_order'],
 tiles:['product_id','unit_revision','current_measurement_revision','measurement_json'],
 lots:['lot_id','product_id','remaining_qty_text','purchase_price_text','purchase_id'],
 bundles:['bundle_id','component_id','qty_per_set_text','unit_name','revision','status'],
 settings:['currency_symbol','low_stock_threshold_text']
};
const statements=[READ_PRODUCTS,READ_UNITS,READ_CATEGORIES,READ_PROFILES,
 READ_RELATIONS,READ_TILE,READ_STOCK_LOTS,READ_BUNDLE_PARTS,READ_SETTINGS];
const names=Object.values(fields);

/** Trusted invocation accepts a bearer only; the server supplies the clock. */
export function createM03AuthenticatedProductsBootstrap(env,{now=Date.now}={}){
 const DB=requireD1Binding(env);
 if(typeof now!=='function')fail();
 return Object.freeze({
  async getProductsBootstrap_(...args){
   try{
    if(args.length!==1)fail();
    const req=exact(args[0],['token']);
    if(typeof req.token!=='string'||!TOKEN.test(req.token))fail();
    const time=now();
    if(!Number.isSafeInteger(time)||time<0||
       !Number.isSafeInteger(time+AUTH_POLICY.sessionMaxMs))fail();
    const digest=await hashToken(req.token);
    const binds=[digest,time,time,time-AUTH_POLICY.sessionIdleMs,time];
    // Never issue a Products SELECT for unauthorized/expired/revoked actors.
    const authorized=await all(DB,AUTH,binds,['tenant_id'],1);
    if(authorized.length!==1||typeof authorized[0].tenant_id!=='string'||
       !authorized[0].tenant_id.trim())fail();
    const result=await Promise.all(statements.map((sql,i)=>
      all(DB,sql,binds,names[i],i===8?1:MAX_ROWS)));
    // Reject a session/role/tenant revoked while the awaited reads ran.
    const final=await all(DB,AUTH,binds,['tenant_id'],1);
    if(final.length!==1||final[0].tenant_id!==authorized[0].tenant_id)fail();
    return compose(result);
   }catch{fail();}
  }
 });
}
