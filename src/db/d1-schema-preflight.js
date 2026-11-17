import {requireD1Binding} from './d1-binding.js';

/**
 * M03 Run1 static, REVIEW-ONLY repository metadata requirements.
 * These are already-approved 0001/0002/0012–0014 fields used by M03
 * catalog, Party, product/unit and tile readers; NOT the complete 659-field
 * source inventory and NOT permission to import or post business data.
 *
 * Table names and field names are CODE constants, never client parameters.
 * Additive M02-reviewed columns are permitted. Changes to one of these
 * foundational column types/identities require explicit repository review.
 */
const REQUIRED=Object.freeze({
  settings:Object.freeze({
    row_id:'INTEGER',legacy_sheet_row:'INTEGER',key:'TEXT',value:'TEXT'
  }),
  product_categories:Object.freeze({
    row_id:'INTEGER',legacy_sheet_row:'INTEGER',category_id:'TEXT',
    category_name:'TEXT',status:'TEXT',created_at:'TEXT'
  }),
  product_units:Object.freeze({
    row_id:'INTEGER',legacy_sheet_row:'INTEGER',unit_id:'TEXT',
    unit_name:'TEXT',status:'TEXT',created_at:'TEXT'
  }),
  parties:Object.freeze({
    party_id:'TEXT',display_name:'TEXT',status:'TEXT'
  }),
  party_roles:Object.freeze({
    party_id:'TEXT',role:'TEXT',status:'TEXT'
  }),
  party_legacy_links:Object.freeze({
    link_id:'INTEGER',source_group:'TEXT',source_id:'TEXT',
    legacy_sheet_row:'INTEGER',party_id:'TEXT',link_basis:'TEXT',status:'TEXT'
  }),
  party_identity_review:Object.freeze({
    review_id:'TEXT',source_group:'TEXT',source_id:'TEXT',
    reason:'TEXT',status:'TEXT'
  }),
  legacy_product_snapshots:Object.freeze({
    source_profile:'TEXT',legacy_sheet_row:'INTEGER',product_id:'TEXT',unit_text:'TEXT'
  }),
  legacy_product_unit_conversion_snapshots:Object.freeze({
    source_profile:'TEXT',legacy_sheet_row:'INTEGER',
    conversion_id:'TEXT',product_id:'TEXT'
  }),
  products:Object.freeze({
    product_id:'TEXT',source_profile:'TEXT',source_snapshot_row_id:'INTEGER',
    legacy_sheet_row:'INTEGER',base_unit_name:'TEXT',
    current_unit_revision:'INTEGER',record_version:'INTEGER'
  }),
  product_unit_profiles:Object.freeze({
    product_id:'TEXT',revision:'INTEGER',stock_unit_name:'TEXT'
  }),
  product_unit_conversions:Object.freeze({
    product_id:'TEXT',revision:'INTEGER',conversion_id:'TEXT',
    unit_name:'TEXT',factor_text:'TEXT',reviewed_unit_master_id:'TEXT'
  }),
  product_tile_measurement_revisions:Object.freeze({
    product_id:'TEXT',revision:'INTEGER',box_conversion_id:'TEXT',
    length_text:'TEXT',width_text:'TEXT',
    pieces_per_box:'INTEGER',source_evidence_ref:'TEXT'
  })
});
const failure=()=>new Error('NEEDS_REVIEW: M03 D1 structural schema incompatible or unavailable');
const TABLES=Object.keys(REQUIRED);
const totalColumns=TABLES.reduce((n,table)=>n+Object.keys(REQUIRED[table]).length,0);

function literalValue(row,key){
  if(row===null||typeof row!=='object'||Array.isArray(row))throw failure();
  const desc=Object.getOwnPropertyDescriptor(row,key);
  if(!desc?.enumerable || !Object.hasOwn(desc,'value'))throw failure();
  return desc.value;
}
async function schemaRows(DB,sql){
  const result=await DB.prepare(sql).all();
  if(result?.success!==true||!Array.isArray(result.results)||
     result.results.length>1024)throw failure();
  return result.results;
}

/**
 * Verify ONLY immutable structural compatibility against real D1 SQLite.
 * Never inspect stored Settings/Party/Product rows or contents. No remote
 * binding, HTTP endpoint, startup activation or financial authority exists.
 *
 * This is deliberately NOT M03/M02 migration readiness: source counts,
 * provenance reviewer evidence, FK constraints, data parity, M04 authority
 * and atomic financial postings remain separate signed integration gates.
 */
export async function verifyM03D1FoundationSchema(env){
  const DB=requireD1Binding(env);
  try{
    const names=new Set();
    for(const row of await schemaRows(DB,'PRAGMA table_list')){
      const name=literalValue(row,'name');
      if(typeof name!=='string'||!Object.hasOwn(REQUIRED,name))continue;
      if(names.has(name)||
         literalValue(row,'schema')!=='main' ||
         literalValue(row,'type')!=='table' ||
         literalValue(row,'strict')!==1)throw failure();
      names.add(name);
    }
    if(names.size!==TABLES.length)throw failure();

    for(const table of TABLES){
      const found=new Map();
      // All identifiers originate exclusively from the literal REQUIRED map.
      const query="PRAGMA table_info('"+table+"')";
      for(const row of await schemaRows(DB,query)){
        const name=literalValue(row,'name');
        const type=literalValue(row,'type');
        if(typeof name!=='string'||!name ||
           typeof type!=='string'||!type||found.has(name))throw failure();
        found.set(name,type);
      }
      for(const [key,type] of Object.entries(REQUIRED[table])){
        if(found.get(key)!==type)throw failure();
      }
    }
    return Object.freeze({
      scope:'read-only-structural-metadata',status:'STRUCTURAL_ONLY',
      requiredTables:TABLES.length,requiredColumns:totalColumns
    });
  }catch{
    // Do not expose D1 SQL, Settings, Party, audit or driver error content.
    throw failure();
  }
}
