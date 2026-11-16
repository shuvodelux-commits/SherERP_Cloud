/**
 * M10-09 — OFFLINE, six-reviewed-group source↔D1 summary parity only.
 *
 * Five groups have authentic original source IDs; legacy LOGS has only
 * physical sheet-row provenance. Never invent LOGS.idDigest or submit its
 * positionDigest to M10-01 as an original identifier. This proof cannot
 * authorize any of the 49-group business-data import or cutover gates.
 */
import {verifyCatalogMapping} from '../db/catalog-mapping.js';
import {verifyExpenseCategoryMapping} from '../db/expense-category-mapping.js';
import {verifyDeleteLogMapping} from '../db/delete-log-mapping.js';
import {verifySalesDraftAuditMapping} from '../db/sales-draft-audit-mapping.js';
import {verifyLegacyErrorLogMapping} from '../db/legacy-error-log-mapping.js';

const BAD='M10 reviewed group parity evidence invalid';
const ID_GROUPS=Object.freeze([
  'PRODUCT_CATEGORIES','PRODUCT_UNITS','EXPENSE_CATEGORIES',
  'DELETE_LOG','SALES_DRAFT_AUDIT'
]);
const REVIEWED=Object.freeze([...ID_GROUPS,'LOGS']);
const NAMES=new Set(REVIEWED);
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const HEX=/^[0-9a-f]{64}$/;
const ID_FIELDS=Object.freeze(['sheetKey','rowCount','rowDigest','idDigest']);
const LOGS_FIELDS=Object.freeze([
  'sheetKey','rowCount','rowDigest','positionDigest','identityKind'
]);

function ownValuesOnly(value,fields){
  if(value===null||typeof value!=='object'||
     Object.getPrototypeOf(value)!==Object.prototype)return false;
  const names=Reflect.ownKeys(value);
  if(names.length!==fields.length||names.some(name=>
    typeof name!=='string'||!fields.includes(name)))return false;
  return fields.every(name=>{
    const descriptor=Object.getOwnPropertyDescriptor(value,name);
    return descriptor?.enumerable===true&&Object.hasOwn(descriptor,'value');
  });
}

function validateInventory(inventory){
  if(!inventory||typeof inventory!=='object'||Array.isArray(inventory)||
     inventory.formatVersion!==1||!Array.isArray(inventory.tables)||
     inventory.tables.length!==49)throw new Error('source inventory invalid');
  const keys=inventory.tables.map(table=>table?.sheetKey);
  if(keys.some(key=>typeof key!=='string'||!GROUP.test(key))||
     new Set(keys).size!==49||REVIEWED.some(key=>!keys.includes(key)))
    throw new Error('source inventory keys invalid');
  verifyCatalogMapping(inventory);
  verifyExpenseCategoryMapping(inventory);
  verifyDeleteLogMapping(inventory);
  verifySalesDraftAuditMapping(inventory);
  verifyLegacyErrorLogMapping(inventory);
}

/** Returns a map of supplied strictly-shaped digest evidence, never raw data. */
function parseSummaries(rows,side,add){
  if(rows===undefined){
    add(side==='SOURCE'?'REVIEWED_SOURCE_EVIDENCE_MISSING':'REVIEWED_D1_EVIDENCE_MISSING');
    return new Map();
  }
  if(!Array.isArray(rows))throw new Error('invalid summary list');
  const parsed=new Map();
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row))
      throw new Error('invalid group summary');
    // Descriptors must be checked before reading any potentially private
    // property, including an attacker-controlled getter for sheetKey.
    const keyDescriptor=Object.getOwnPropertyDescriptor(row,'sheetKey');
    if(!keyDescriptor||!Object.hasOwn(keyDescriptor,'value')||
       typeof keyDescriptor.value!=='string'||!GROUP.test(keyDescriptor.value))
      throw new Error('invalid group key');
    const key=keyDescriptor.value;
    const isIdless=key==='LOGS';
    if(!ownValuesOnly(row,isIdless?LOGS_FIELDS:ID_FIELDS))
      throw new Error('invalid group evidence shape');
    if(!Number.isSafeInteger(row.rowCount)||row.rowCount<0||
       typeof row.rowDigest!=='string'||!HEX.test(row.rowDigest))
      throw new Error('invalid group row evidence');
    if(isIdless){
      if(typeof row.positionDigest!=='string'||!HEX.test(row.positionDigest)||
         row.identityKind!=='SOURCE_ROW_POSITION_ONLY')
        throw new Error('invalid positional provenance');
    }else if(typeof row.idDigest!=='string'||!HEX.test(row.idDigest)){
      throw new Error('invalid original source ID evidence');
    }
    if(!NAMES.has(key)){
      add('REVIEWED_UNEXPECTED_'+side);
      continue;
    }
    if(parsed.has(key)){
      add('REVIEWED_DUPLICATE_'+side);
      continue;
    }
    parsed.set(key,row);
  }
  for(const key of REVIEWED){
    if(!parsed.has(key))add('REVIEWED_MISSING_'+side);
  }
  return parsed;
}

/**
 * Compares externally supplied reviewed-group summaries. No Sheet capture,
 * D1 read, authenticated provenance, source freeze or release authorization.
 * The five original IDs and single LOGS position-only group stay distinct.
 *
 * @returns {{formatVersion:1,phase:'M10_REVIEWED_GROUP_PARITY',
 *   reviewedGroups:6,originalIdGroups:5,positionOnlyGroups:1,
 *   comparisonsComplete:boolean,groupsMatched:boolean,
 *   authorizesImport:false,productionReady:false,
 *   issues:Array<{code:string,count:number}>}}
 */
export function assessM10ReviewedGroupParity({
  inventory,sourceSummaries,d1Summaries
}={}){
  try{
    validateInventory(inventory);
    const issues=new Map();
    const add=code=>issues.set(code,(issues.get(code)||0)+1);
    const source=parseSummaries(sourceSummaries,'SOURCE',add);
    const d1=parseSummaries(d1Summaries,'D1',add);
    for(const key of REVIEWED){
      const a=source.get(key),b=d1.get(key);
      if(!a||!b)continue;
      if(a.rowCount!==b.rowCount)add('REVIEWED_ROW_COUNT_MISMATCH');
      if(a.rowDigest!==b.rowDigest)add('REVIEWED_ROW_DIGEST_MISMATCH');
      if(key==='LOGS'){
        if(a.positionDigest!==b.positionDigest)
          add('REVIEWED_POSITION_PROVENANCE_MISMATCH');
      }else if(a.idDigest!==b.idDigest){
        add('REVIEWED_ORIGINAL_ID_MISMATCH');
      }
    }
    const comparisonsComplete=source.size===6&&d1.size===6&&
      ![...issues.keys()].some(code=>
        code.startsWith('REVIEWED_MISSING_')||
        code.startsWith('REVIEWED_DUPLICATE_')||
        code.startsWith('REVIEWED_UNEXPECTED_')||
        code.endsWith('_EVIDENCE_MISSING'));
    const sorted=[...issues].sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_REVIEWED_GROUP_PARITY',
      reviewedGroups:6,originalIdGroups:5,positionOnlyGroups:1,
      comparisonsComplete,groupsMatched:comparisonsComplete&&sorted.length===0,
      authorizesImport:false,productionReady:false,issues:sorted
    };
  }catch{
    // Source rows, IDs, hashes, private data, malicious getters and SQL
    // implementation details must never reach reports or CI logs.
    throw new Error(BAD);
  }
}
