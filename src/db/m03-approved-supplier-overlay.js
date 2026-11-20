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
  owner_mvp_cash_close_guard:['trigger','owner_mvp_cash_sessions','0f857bf47f7828709db4a31150fd3a74ca476764e85d088e136385d2f692456b'],
  owner_mvp_cash_return_drawer_guard:['trigger','owner_mvp_sale_return_receipts','f410b2b5afbf30bbe6df1346b96ae8d0f72ca2bb10da235e697086875b7194a6'],
  owner_mvp_supplier_cash_book_no_delete:['trigger','owner_mvp_supplier_payment_cash_book','5f66cfb1be24d7e1b50bf6d0b48e9e68d486ae71399bf22ec32eff11f9c1428d'],
  owner_mvp_supplier_cash_book_no_update:['trigger','owner_mvp_supplier_payment_cash_book','90d3869af4351ce530568e0b6314403e23e0ba3b85c7034b2ab289d4b255bf96'],
  owner_mvp_supplier_cash_ledger_no_delete:['trigger','owner_mvp_supplier_payment_ledger','2b622d6ae0f50f4342787f29d24579c0e163fdb92bf5209153ddd4bdd45b0a7d'],
  owner_mvp_supplier_cash_ledger_no_update:['trigger','owner_mvp_supplier_payment_ledger','9dea5d5ae0b0ab3eefc09d37b087d522e46f4a70bcfe3f4d38c37b3c2bbe4133'],
  owner_mvp_supplier_cash_payment_receipts:['table','owner_mvp_supplier_cash_payment_receipts','5f21ee19b51c74482222e506ec529eb4570c7811ac8b064e53608bfbcc1bc1dd'],
  owner_mvp_supplier_cash_payment_supplier_idx:['index','owner_mvp_supplier_cash_payment_receipts','8cd3e5ee5a80a9ad2ac5dc95d19eb3527b310692108f01b1ff12ed8059981382'],
  owner_mvp_supplier_cash_post:['trigger','owner_mvp_supplier_cash_payment_receipts','4944af13d301ee7085358612bff125f8d3c8d0d4ab1652e7b241107c4c94d686'],
  owner_mvp_supplier_cash_receipt_no_delete:['trigger','owner_mvp_supplier_cash_payment_receipts','21fb1e71961f0f3172dd12b6c642050b679cf1f75992633de4ad9ee1b4f13287'],
  owner_mvp_supplier_cash_receipt_no_update:['trigger','owner_mvp_supplier_cash_payment_receipts','b8b4f3acc792149d4908fa14b19eb9d9b764f4dfac3622d01de4fac134c4e1b1'],
  owner_mvp_supplier_cash_validate:['trigger','owner_mvp_supplier_cash_payment_receipts','97be4fc51c8daf8bcf49256acbab0a3056a4e4615cf05f54128e554d49a00d28'],
  owner_mvp_supplier_payment_cash_book:['table','owner_mvp_supplier_payment_cash_book','4586b77e6b91235a101c60d5fccd10966297cc8406f4ec165f65a8df195e7823'],
  owner_mvp_supplier_payment_cash_session_idx:['index','owner_mvp_supplier_payment_cash_book','73e1327b80f42fc73f6368fc2f8b28197319eef8f230d05ac591b0e2da0fec9d'],
  owner_mvp_supplier_payment_ledger:['table','owner_mvp_supplier_payment_ledger','3b0c6529345b5b20f4c78f42ab2b1b3e755b4484f1823ee2e2cd2d490606bc80']
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
  // Hash the exact SQLite-stored SQL, not whitespace-collapsed text: SQL
  // literals such as 'Supplier Payment' can change meaning with spaces.
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sql.trim()));
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
