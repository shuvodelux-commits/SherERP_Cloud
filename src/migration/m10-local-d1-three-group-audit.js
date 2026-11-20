/**
 * M10 Run 6: independent fixed-SQL, read-only 3/49 local D1 reconciliation.
 * Caller supplies source-shaped snapshots; this never exports/imports data.
 * This module has no Worker route, original source access or D1 credentials.
 */
import {prepareSourceProductCategories} from '../db/product-category-source-import.js';
import {prepareSourceProductUnits} from '../db/product-unit-source-import.js';
import {prepareSourceExpenseCategories} from '../db/expense-category-source-import.js';
import {summarizeM10Catalog} from './m10-catalog-digest.js';

const BAD='M10 local D1 three-group audit rejected';
const LIMIT=1001;
const CATALOG=Object.freeze([
  Object.freeze({
    key:'PRODUCT_CATEGORIES',id:'category_id',
    fields:Object.freeze(['category_name','status','created_at']),
    prepare:prepareSourceProductCategories,
    sql:'SELECT legacy_sheet_row, category_id, category_name, status, created_at FROM product_categories ORDER BY legacy_sheet_row LIMIT ?'
  }),
  Object.freeze({
    key:'PRODUCT_UNITS',id:'unit_id',
    fields:Object.freeze(['unit_name','status','created_at']),
    prepare:prepareSourceProductUnits,
    sql:'SELECT legacy_sheet_row, unit_id, unit_name, status, created_at FROM product_units ORDER BY legacy_sheet_row LIMIT ?'
  }),
  Object.freeze({
    key:'EXPENSE_CATEGORIES',id:'category_id',
    fields:Object.freeze(['category_name','description','status','created_at']),
    prepare:prepareSourceExpenseCategories,
    sql:'SELECT legacy_sheet_row, category_id, category_name, description, status, created_at FROM expense_categories ORDER BY legacy_sheet_row LIMIT ?'
  })
]);
const KEYS=new Set(CATALOG.map(x=>x.key));
const fail=()=>{throw new Error(BAD);};

function root(input){
  if(input===null||typeof input!=='object'||Array.isArray(input)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail();
  const names=Reflect.ownKeys(input);
  if(names.length!==3||names.some(name=>typeof name!=='string'||!KEYS.has(name)))fail();
  for(const key of KEYS){
    const descriptor=Object.getOwnPropertyDescriptor(input,key);
    if(descriptor?.enumerable!==true||!Object.hasOwn(descriptor,'value'))fail();
  }
  return input;
}
function rowShape(row,config){
  if(row===null||typeof row!=='object'||Array.isArray(row)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(row)))fail();
  const columns=['legacy_sheet_row',config.id,...config.fields];
  const names=Reflect.ownKeys(row);
  if(names.length!==columns.length||names.some(x=>
    typeof x!=='string'||!columns.includes(x)))fail();
  for(const col of columns){
    const descriptor=Object.getOwnPropertyDescriptor(row,col);
    if(descriptor?.enumerable!==true||!Object.hasOwn(descriptor,'value'))fail();
  }
  if(!Number.isSafeInteger(row.legacy_sheet_row)||row.legacy_sheet_row<2)fail();
  if(typeof row[config.id]!=='string'||!row[config.id])fail();
  if(config.fields.some(col=>typeof row[col]!=='string'))fail();
}
function compare(actual,expected,config,add){
  const source=new Map(expected.map(row=>[row.legacy_sheet_row,row]));
  const readback=new Map();
  for(const row of actual){
    rowShape(row,config);
    const position=row.legacy_sheet_row;
    if(readback.has(position)){
      add('DUPLICATE_POSITION');
      continue;
    }
    readback.set(position,row);
    const before=source.get(position);
    if(!before){
      add('EXTRA_ROW');
      continue;
    }
    if(before[config.id]!==row[config.id])add('SOURCE_ID_MISMATCH');
    if(config.fields.some(field=>before[field]!==row[field]))
      add('FIELD_MISMATCH');
  }
  for(const key of source.keys())
    if(!readback.has(key))add('MISSING_ROW');
}

/**
 * Redacted independent readback for only three reviewed nonfinancial groups.
 * SQL is fixed and SELECT-only; DB.batch obtains one coherent local D1 read.
 * A matching synthetic packet never grants historical/production readiness.
 */
export async function assessM10LocalD1ThreeGroup({DB,inventory,sourceRows}={}){
  try{
    const source=root(sourceRows);
    const prepared=CATALOG.map(config=>{
      // Reuse M02's exact original column/physical-row preflight and M10's
      // pinned Config inventory mapping. Do this BEFORE any D1 calls.
      summarizeM10Catalog({inventory,sheetKey:config.key,rows:source[config.key]});
      return config.prepare(source[config.key]);
    });
    if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')fail();
    const statements=CATALOG.map(config=>DB.prepare(config.sql).bind(LIMIT));
    const envelope=await DB.batch(statements);
    if(!Array.isArray(envelope)||envelope.length!==CATALOG.length)fail();

    const issues=new Map();
    const add=code=>issues.set(code,(issues.get(code)||0)+1);
    let expectedRows=0,observedRows=0;
    for(let index=0;index<CATALOG.length;index++){
      const packet=envelope[index],expected=prepared[index];
      if(packet===null||typeof packet!=='object'||
         packet.success!==true||!Array.isArray(packet.results)||
         packet.results.length>1000)fail();
      expectedRows+=expected.length;
      observedRows+=packet.results.length;
      compare(packet.results,expected,CATALOG[index],add);
    }
    const ordered=[...issues].sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_LOCAL_D1_THREE_GROUP_RECONCILIATION',
      reviewedGroups:CATALOG.length,expectedRows,observedRows,
      readbackPerformed:true,candidateLocalReadbackParity:ordered.length===0,
      authorizesRealImport:false,authorizesRemoteD1Write:false,
      authorizesCutover:false,productionReady:false,issues:ordered,
      limitations:'Local fabricated D1 evidence covers only 3 of 49 original groups; not actual historical source reconciliation, accounting approval or production authorization'
    };
  }catch{
    // Never leak original IDs, source rows, SQL, credentials or driver errors.
    throw new Error(BAD);
  }
}
