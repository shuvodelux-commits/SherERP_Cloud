/**
 * First-Shop M03: exact additive schema compatibility after M08 0010+0011.
 *
 * The 13 OWNER_READY_SHOP_MIGRATION_PLAN receipts remain immutable. These
 * object digests pin the SQL produced by the merged, reviewed 0010 and 0011
 * migrations. No runtime SQL, migrations or remote D1 writes take place here.
 *
 * This is NOT the Option A multi-Shop publisher's schema revision and does
 * not authorize a Worker deployment or financial feature toggle.
 */
const approvedSqlObjects=Object.freeze({
  owner_mvp_cash_close_guard:['trigger','owner_mvp_cash_sessions','23374efada145243917cc01fc3482b875f7858d8c11029b320b6054c29dc4e9d'],
  owner_mvp_cash_return_drawer_guard:['trigger','owner_mvp_sale_return_receipts','68b6ecf7e87cfa1f1c83d15f1fa0683d7e8233db8f8ff34f67923673f83a10c1'],
  owner_mvp_supplier_cash_book_no_delete:['trigger','owner_mvp_supplier_payment_cash_book','7751ec9c5585ac039cd30cdf1baaa096d01f5cbf95efa58f4c2bf8b09ecf95b5'],
  owner_mvp_supplier_cash_book_no_update:['trigger','owner_mvp_supplier_payment_cash_book','2e52072cee0f4ecdf70f642db5dbf184b06d86482979f4092cd69438e0223e49'],
  owner_mvp_supplier_cash_ledger_no_delete:['trigger','owner_mvp_supplier_payment_ledger','fe752bcb503b50dabacefe4c11ab4008d3decd9c4bf315109224caa14a4e5fe4'],
  owner_mvp_supplier_cash_ledger_no_update:['trigger','owner_mvp_supplier_payment_ledger','5dae74bba8e5bd98726edb2f80c0c7530359eb0a96b548010b30938db6fa737c'],
  owner_mvp_supplier_cash_payment_receipts:['table','owner_mvp_supplier_cash_payment_receipts','e6a403486df546644689aee405d6fd2fce672c8282e70d879c64a44ea3e3fd2f'],
  owner_mvp_supplier_cash_payment_supplier_idx:['index','owner_mvp_supplier_cash_payment_receipts','149d8660fba0f87931537bd8ee7c7b01e3f92553aca6a2621b1a7162a74a49ed'],
  owner_mvp_supplier_cash_post:['trigger','owner_mvp_supplier_cash_payment_receipts','694d2f68f2c2f3175c042891e7816202c7161bf7f98a5b2d779dcf20e72444b4'],
  owner_mvp_supplier_cash_receipt_no_delete:['trigger','owner_mvp_supplier_cash_payment_receipts','161b5ccfa970c503c387c4b9b481fd00241ceae602519a4ce096dcfcb9dfaaaf'],
  owner_mvp_supplier_cash_receipt_no_update:['trigger','owner_mvp_supplier_cash_payment_receipts','c61ad0153810e29ab9095d1870b6a90f30c861ae2cf438e47ab10fec7d6d062f'],
  owner_mvp_supplier_cash_validate:['trigger','owner_mvp_supplier_cash_payment_receipts','bc8908ede79fd1199179480ed1913cd9957ecd5cd7617f64c7552afdb1e66cac'],
  owner_mvp_supplier_payment_cash_book:['table','owner_mvp_supplier_payment_cash_book','14df23e44bf565bad237000a76eae78ba70c6cbe40b0e152919a2af739f9972a'],
  owner_mvp_supplier_payment_cash_session_idx:['index','owner_mvp_supplier_payment_cash_book','a704785d4f59842ea02276dfd89b8e56760e5020d476328949e72ed5fd4dff0c'],
  owner_mvp_supplier_payment_ledger:['table','owner_mvp_supplier_payment_ledger','177559d7b84e8c30639684f6d83cdbd218626fac9fa47b2010e15f132e01073b']
});
const modifiedBaseObject='owner_mvp_cash_close_guard';
const isObjectRow=row=>Array.isArray(row)&&row.length===4 &&
  ['table','index','trigger','view'].includes(row[0]) &&
  typeof row[1]==='string'&&row[1].length>0 &&
  typeof row[2]==='string'&&row[2].length>0&&
  typeof row[3]==='string'&&row[3].length>0;
const toMap=rows=>{
  if(!Array.isArray(rows)||rows.length<1||rows.length>2500)return null;
  const out=new Map();
  for(const row of rows){
    if(!isObjectRow(row)||out.has(row[1]))return null;
    out.set(row[1],row);
  }
  return out;
};
async function sha256Sql(sql){
  const normalized=sql.trim().replace(/\s+/g,' ');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}

/**
 * Strictly allow unchanged 13-step baseline schema plus exactly 14 added
 * objects and one replaced Cash Close guard; never tolerate arbitrary DDL.
 * All comparisons are against the SAME D1's own baseline receipt, not a
 * SQLite export/reimport (which can normalize CREATE SQL differently).
 */
export async function matchesApprovedSupplierCashSchemaOverlay(baselineSchema,currentSchema){
  if(typeof baselineSchema!=='string'||typeof currentSchema!=='string'||
     baselineSchema.length>1_000_000||currentSchema.length>1_000_000||
     !baselineSchema||!currentSchema)return false;
  try{
    const base=toMap(JSON.parse(baselineSchema));
    const current=toMap(JSON.parse(currentSchema));
    if(!base||!current||!base.has(modifiedBaseObject)||
       current.size!==base.size+Object.keys(approvedSqlObjects).length-1)return false;
    // Preserve every original Product/Party/Stock/Owner schema object exactly.
    for(const [name,oldRow] of base){
      const newRow=current.get(name);
      if(!newRow)return false;
      if(name!==modifiedBaseObject&&JSON.stringify(newRow)!==JSON.stringify(oldRow))
        return false;
    }
    // No unreviewed tables, triggers, indexes, or schema substitutions.
    for(const [name,newRow] of current){
      const pin=approvedSqlObjects[name];
      if(base.has(name)&&name!==modifiedBaseObject)continue;
      if(!pin||newRow[0]!==pin[0]||newRow[2]!==pin[1]||
         await sha256Sql(newRow[3])!==pin[2])return false;
    }
    return true;
  }catch{
    // Corrupt receipt, foreign schema, missing WebCrypto or SQL mismatch.
    return false;
  }
}
