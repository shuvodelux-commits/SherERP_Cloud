/**
 * M03 MVP — original Purchase read/bootstrap on actual clean Shop D1.
 *
 * READ ONLY. No purchase posting, receiving stock/lot mutation, bank, cash,
 * Customer/Supplier ledger write, operation ID issuance, or invoice creation.
 * Only a verified empty new Shop with approved Product/Supplier masters may
 * open the original Purchase picker without inventing transaction history.
 */
import {pilotShopIdentityMatches} from '../auth/platform-shop-binding.js';
import {readCleanOwnerCatalog} from './m03-owner-catalog-read.js';
import {readOwnerSupplierBootstrap} from './m03-owner-supplier-create.js';

const DECIMAL=/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,2})?$/;
const MAX_PRODUCTS=1000;
const MAX_CATEGORIES=1000;

// A future canonical Purchase/Bank/Stock posting migration changes these
// assumptions. Until M03 writer+read models ship, fail closed instead of
// returning an empty history for a shop with trade tables.
async function assertNoPurchaseTransactionHistory(DB){
  const rows=await DB.prepare(`SELECT name FROM sqlite_schema
    WHERE type='table' AND (
      lower(name) LIKE '%purchase%' OR lower(name) LIKE '%bank_book%'
      OR lower(name) LIKE '%stock_lot%' OR lower(name) LIKE '%supplier_ledger%'
    ) LIMIT 1`).all();
  if(rows?.success!==true||!Array.isArray(rows.results)||rows.results.length)
    throw new Error('MVP Purchase transaction history is unavailable');
}

async function readVerifiedCleanScope(scope){
  if(!scope||typeof scope.shopDb?.batch!=='function'||
     !await pilotShopIdentityMatches(scope))
    throw new Error('MVP Purchase Shop identity unavailable');
  await assertNoPurchaseTransactionHistory(scope.shopDb);
  const [catalog,suppliers]=await Promise.all([
    readCleanOwnerCatalog(scope.shopDb),
    readOwnerSupplierBootstrap(scope.shopDb),
  ]);
  if(catalog?.mode!=='operational'||!Array.isArray(catalog.data)||
     catalog.data.length>MAX_PRODUCTS||!Array.isArray(suppliers.suppliers)||
     suppliers.suppliers.length>1000||suppliers.bankAccounts?.length)
    throw new Error('MVP Purchase source masters unavailable');
  return {catalog,suppliers};
}

export async function readMvpOwnerPurchaseBootstrap(scope){
  const {catalog,suppliers}=await readVerifiedCleanScope(scope);
  const DB=scope.shopDb;
  const [status,categories]=await DB.batch([
    DB.prepare(`SELECT product_id AS id,status,product_type_text AS type,
      opening_stock_text AS stock FROM products WHERE is_deleted=0
      ORDER BY product_name COLLATE NOCASE,product_id LIMIT ${MAX_PRODUCTS+1}`),
    DB.prepare(`SELECT category_id AS id,category_name AS name FROM product_categories
      WHERE status='Active' ORDER BY category_name COLLATE NOCASE,category_id
      LIMIT ${MAX_CATEGORIES+1}`),
  ]);
  if(status?.success!==true||categories?.success!==true||
     !Array.isArray(status.results)||!Array.isArray(categories.results)||
     status.results.length!==catalog.data.length||
     categories.results.length>MAX_CATEGORIES)
    throw new Error('MVP Purchase Product/Categories incomplete');
  const byId=new Map(status.results.map(row=>[row.id,row]));
  if(byId.size!==catalog.data.length)
    throw new Error('MVP Purchase catalog identity changed');

  const products=catalog.data.filter(row=>byId.get(row.productId)?.status==='Active')
    .map(row=>{
      const meta=byId.get(row.productId);
      if(!meta||meta.type!=='Standard'||meta.stock!=='0'||
         row.stock!=='0'||!DECIMAL.test(row.listedPrice)||
         !DECIMAL.test(row.savedPurchasePrice)||
         typeof row.productId!=='string'||!row.productId.trim())
        throw new Error('MVP Purchase live stock/price integration unavailable');
      return {id:row.productId,name:row.name,brand:row.brand||'',
        unit:row.unit,category:row.category||'',barcode:'',
        stock:0,purchasePrice:row.savedPurchasePrice,sellingPrice:row.listedPrice};
    });
  const currentSuppliers=suppliers.suppliers.filter(row=>row.Status==='Active')
    .map(row=>{
      if(row['Opening Balance']!==0||row['Current Due']!==0)
        throw new Error('MVP Purchase Supplier ledger integration unavailable');
      return {id:row['Supplier ID'],name:row['Supplier Name'],
        phone:row.Phone||'',currentDue:0};
    });
  return {products,suppliers:currentSuppliers,
    categories:categories.results.map(row=>({id:row.id,name:row.name})),
    bankAccounts:[],currencySymbol:''};
}

export async function readMvpOwnerEmptyPurchaseHistory(scope){
  await readVerifiedCleanScope(scope);
  return [];
}
