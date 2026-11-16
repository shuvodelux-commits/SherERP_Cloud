/**
 * M10-02 — pure, OFFLINE digest for the two reviewed catalog masters only.
 *
 * Inputs must be original Config.gs source-shaped rows, independently
 * captured by source and D1 readers. No source access, D1 access, public RPC,
 * remote migration, financial posting or permission to cut over.
 */
import {createHash} from 'node:crypto';
import {verifyCatalogMapping} from '../db/catalog-mapping.js';
import {prepareSourceProductCategories} from '../db/product-category-source-import.js';
import {prepareSourceProductUnits} from '../db/product-unit-source-import.js';

const INVALID='M10 catalog digest invalid';
const hash=bytes=>createHash('sha256').update(bytes,'utf8').digest('hex');

const GROUPS=Object.freeze({
  PRODUCT_CATEGORIES:Object.freeze({
    prepare:prepareSourceProductCategories,
    id:'category_id',
    fields:Object.freeze(['category_id','category_name','status','created_at'])
  }),
  PRODUCT_UNITS:Object.freeze({
    prepare:prepareSourceProductUnits,
    id:'unit_id',
    fields:Object.freeze(['unit_id','unit_name','status','created_at'])
  })
});

/**
 * Returns only {sheetKey,rowCount,rowDigest,idDigest} for M10-01.
 * Hash input serialization:
 *   ROW = JSON.stringify(['M10-ROW-v1',group,[[physical_row,...ordered_source_fields],...]])
 *   ID  = JSON.stringify(['M10-ID-v1',group,[[physical_row,original_source_id],...]])
 * Internal digest bytes may only be compared in memory; do not log them.
 */
export function summarizeM10Catalog({inventory,sheetKey,rows}={}){
  try {
    if(!inventory || inventory.formatVersion!==1||
       !Array.isArray(inventory.tables)||inventory.tables.length!==49)
      throw new Error('unreviewed source inventory');
    verifyCatalogMapping(inventory);
    if(typeof sheetKey!=='string'||!Object.hasOwn(GROUPS,sheetKey))
      throw new Error('unsupported source group');

    const config=GROUPS[sheetKey];
    const records=config.prepare(rows); // already enforces exact source columns,
    // original physical row ordering, unique source IDs and valid date types.
    const sourceRows=records.map(row=>[
      row.legacy_sheet_row,...config.fields.map(field=>row[field])
    ]);
    const identities=records.map(row=>[row.legacy_sheet_row,row[config.id]]);
    return {
      sheetKey,rowCount:records.length,
      rowDigest:hash(JSON.stringify(['M10-ROW-v1',sheetKey,sourceRows])),
      idDigest:hash(JSON.stringify(['M10-ID-v1',sheetKey,identities]))
    };
  }catch{
    // Neither original identifiers, content, hash bytes, nor driver internals
    // may escape through error messages or logs.
    throw new Error(INVALID);
  }
}
