import {createLegacyCatalogReadAdapter} from '../db/legacy-catalog-read.js';
import {createGuardedCatalogUpdateAdapter} from '../db/legacy-catalog-update.js';
import {createGuardedCatalogDeleteAdapter} from '../db/legacy-catalog-delete.js';

const MASTER=Object.freeze({
  category:Object.freeze({
    sheet:'PRODUCT_CATEGORIES',id:'Category ID',name:'Category Name',
    missing:'Category not found.'
  }),
  unit:Object.freeze({
    sheet:'PRODUCT_UNITS',id:'Unit ID',name:'Unit Name',
    missing:'Unit not found.'
  })
});
const SOURCE_ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function checkedInput(sourceId,status){
  if(typeof sourceId!=='string'||!SOURCE_ID.test(sourceId))
    throw new TypeError('Invalid original master source ID');
  // Unexpected values must not invoke the source's broad deletion branch.
  if(status!=='Active'&&status!=='Inactive')
    throw new TypeError('Invalid ProductSettings Status');
}

/**
 * Privileged internal M03 ProductSettings status slice. These methods MUST
 * NOT be put in public RPC before M04 products.edit authentication/authorization.
 * Read gives a source ID + physical row preimage; existing SQL adapters enforce
 * that same preimage at the atomic write point, including row compaction.
 */
export function createProductMasterStatusWorkflow(env){
  const read=createLegacyCatalogReadAdapter(env);
  const update=createGuardedCatalogUpdateAdapter(env);
  const deletion=createGuardedCatalogDeleteAdapter(env);

  const change=async(config,sourceId,status)=>{
    checkedInput(sourceId,status);
    const match=await read.findRow_(config.sheet,config.id,sourceId);
    if(match===null)return {success:false,message:config.missing};

    const row=match.row;
    if(row?.[config.id]!==sourceId ||
       typeof row[config.name]!=='string'||!row[config.name].trim() ||
       typeof row.Status!=='string'||!row.Status){
      throw new Error('Invalid original ProductSettings source preimage');
    }
    const preimage={
      sourceId,name:row[config.name],status:row.Status
    };
    if(status==='Active'){
      await update.updateRowFields_(
        config.sheet,match.rowIndex,{Status:'Active'},preimage
      );
      return {success:true,data:{id:sourceId,status:'Active'}};
    }

    await deletion.deleteRow_(config.sheet,match.rowIndex,preimage);
    return {success:true,data:{id:sourceId,deleted:true}};
  };

  return Object.freeze({
    setCategoryStatus_(sourceId,status){
      return change(MASTER.category,sourceId,status);
    },
    setUnitStatus_(sourceId,status){
      return change(MASTER.unit,sourceId,status);
    }
  });
}
