import {createLegacyCatalogReadAdapter} from '../db/legacy-catalog-read.js';

const GROUPS=Object.freeze({
  category:Object.freeze({
    sheet:'PRODUCT_CATEGORIES',
    id:'Category ID',label:'Category Name',
    required:'Category name is required.',
    duplicate:'A category with this name already exists.'
  }),
  unit:Object.freeze({
    sheet:'PRODUCT_UNITS',
    id:'Unit ID',label:'Unit Name',
    required:'Unit name is required.',
    duplicate:'A unit with this name already exists.'
  })
});

/**
 * Read-only M03 source-shaped creation decision for the original
 * ProductSettings.gs category/unit masters.
 *
 * This preflight is advisory only. It MUST NOT be used to delete records
 * or allocate IDs without repeating the duplicate/preimage checks inside
 * the future single atomic D1 create+cleanup+ID-allocation transaction.
 * Public methods remain disabled until M04 products.add authorization.
 */
export function createProductMasterCreatePreflight(env){
  const read=createLegacyCatalogReadAdapter(env);

  const check=async(group,name)=>{
    if(typeof name!=='string')
      throw new TypeError('Invalid ProductSettings name: expected string');
    // Frozen Utils.gs#sanitizeInput_ trims names. Source allows non-string
    // coercion, but the internal D1 API deliberately refuses objects.
    const trimmed=name.trim();
    if(!trimmed)
      return {canCreate:false,message:group.required,name:'',cleanup:[]};

    const rows=await read.getAllRows_(group.sheet);
    const folded=trimmed.toLowerCase();
    const matches=rows.filter(row=>
      String(row[group.label]).trim().toLowerCase()===folded
    );
    // Source's String(Status || 'Active') treats a blank status as Active.
    // The active check precedes any cleanup in the frozen original.
    if(matches.some(row=>
      String(row.Status||'Active').toLowerCase()==='active'
    )){
      return {canCreate:false,message:group.duplicate,name:trimmed,cleanup:[]};
    }

    const ids=new Set();
    const cleanup=matches.map(row=>{
      const sourceId=row[group.id];
      if(typeof sourceId!=='string'||!sourceId.trim()||ids.has(sourceId)||
         !Number.isInteger(row._rowIndex)||row._rowIndex<2 ||
         typeof row[group.label]!=='string'||!row[group.label].trim()||
         typeof row.Status!=='string'){
        throw new Error('Unsafe or duplicate ProductSettings original source ID or row');
      }
      ids.add(sourceId);
      return {
        sourceId,rowIndex:row._rowIndex,
        name:row[group.label],status:row.Status
      };
    });
    return {canCreate:true,name:trimmed,cleanup};
  };

  return Object.freeze({
    checkCategoryName_(name){return check(GROUPS.category,name);},
    checkUnitName_(name){return check(GROUPS.unit,name);}
  });
}
