/**
 * M05 INTERNAL purchase bootstrap projection.
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * Purchase.gs::getPurchaseBootstrap, Utils.gs::getActiveBankAccountsForUI_,
 * BankAccounts.gs::sanitizeAccountType_.
 *
 * Only trusted, tenant-scoped snapshots may be passed here. M04 must
 * authorize purchase.view BEFORE M03 acquires rows. No RPC/DB/stock/ledger
 * mutation or actual purchase validation occurs in this projector.
 */
function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype=Object.getPrototypeOf(value);
  return (prototype===Object.prototype || prototype===null) &&
    Object.values(Object.getOwnPropertyDescriptors(value))
      .every(descriptor=>Object.hasOwn(descriptor,'value'));
}

function trustedRows(snapshot,key) {
  const value=snapshot[key];
  if (!Array.isArray(value))
    throw new TypeError('Explicit trusted '+key+' snapshot array required.');
  if (value.some(row=>!plain(row)))
    throw new TypeError('Invalid trusted '+key+' row or accessor.');
  return value;
}

function sourceDeleted(row) {
  return String(row['Is Deleted']??'').trim().toUpperCase()==='TRUE';
}

// Fail closed for ambiguous visible identifiers. Original GAS displays
// duplicates, but migration may not infer which ID a UI selection means.
function uniqueVisible(rows,key,label) {
  const seen=new Set();
  for(const row of rows) {
    const raw=row[key];
    const valid=(typeof raw==='string' && raw.trim()) ||
      (typeof raw==='number' && Number.isFinite(raw));
    if (!valid) throw new Error('Missing '+label+' ID in trusted bootstrap rows.');
    const id=String(raw);
    if (seen.has(id)) throw new Error('Duplicate '+label+' ID in trusted bootstrap rows.');
    seen.add(id);
  }
  return rows;
}

export function projectPurchaseBootstrap(snapshot) {
  if (!plain(snapshot))
    throw new TypeError('Trusted Purchase Bootstrap snapshot required.');
  const productRows=trustedRows(snapshot,'productRows');
  const supplierRows=trustedRows(snapshot,'supplierRows');
  const categoryRows=trustedRows(snapshot,'categoryRows');
  const bankAccountRows=trustedRows(snapshot,'bankAccountRows');
  if (!plain(snapshot.settings))
    throw new TypeError('Trusted Purchase Bootstrap settings map required.');

  const products=uniqueVisible(
    productRows.filter(row=>!sourceDeleted(row) && row.Status!=='Inactive'),
    'Product ID','Product');
  const suppliers=uniqueVisible(
    supplierRows.filter(row=>!sourceDeleted(row) && row.Status!=='Inactive'),
    'Supplier ID','Supplier');
  // Frozen Purchase.gs uses getAllRows_(PRODUCT_CATEGORIES), not activeRows_.
  const categories=uniqueVisible(
    categoryRows.filter(row=>row.Status!=='Inactive'),
    'Category ID','Category');
  // Frozen Utils.getActiveBankAccountsForUI_ only excludes exact Inactive.
  const bankAccounts=uniqueVisible(
    bankAccountRows.filter(row=>row.Status!=='Inactive'),
    'Bank Account ID','Bank Account');

  return {
    products:products.map(row=>({
      id:row['Product ID'],name:row['Product Name'],brand:row.Brand||'',
      unit:row.Unit,category:row.Category||'',barcode:row.Barcode||'',
      stock:Number(row['Current Stock'])||0,
      purchasePrice:row['Purchase Price'],sellingPrice:row['Selling Price']
    })),
    categories:categories.map(row=>({
      id:row['Category ID'],name:row['Category Name']
    })),
    suppliers:suppliers.map(row=>({
      id:row['Supplier ID'],name:row['Supplier Name'],phone:row.Phone||'',
      currentDue:Number(row['Current Due'])||0
    })),
    bankAccounts:bankAccounts.map(row=>({
      id:row['Bank Account ID'],name:row['Account Name'],
      type:row['Account Type']==='Bank' || row['Account Type']==='Mobile Banking'
        ?row['Account Type']:'Bank'
    })),
    currencySymbol:snapshot.settings['Currency Symbol']||''
  };
}
