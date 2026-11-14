/**
 * Source-faithful, READ-ONLY contract for Mohim_ERP at
 * 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * Relationship role != staff authorization role; no balance is merged here.
 */
export const PARTY_ROLES=Object.freeze(['Customer','Supplier','Vendor','Owner','Lender','Borrower','Payee']);
export const partyLegacyContracts=Object.freeze({
  CUSTOMERS: Object.freeze({idColumn:'Customer ID',nameColumn:'Customer Name',phoneColumn:'Phone',roles:['Customer'],balanceColumns:['Opening Balance','Current Due'],ledgerGroup:'CUSTOMER_LEDGER'}),
  SUPPLIERS: Object.freeze({idColumn:'Supplier ID',nameColumn:'Supplier Name',phoneColumn:'Phone',roles:['Supplier'],balanceColumns:['Opening Balance','Current Due'],ledgerGroup:'SUPPLIER_LEDGER'}),
  VENDORS: Object.freeze({idColumn:'Vendor ID',nameColumn:'Vendor Name',phoneColumn:'Phone',roles:['Vendor'],balanceColumns:['Current Due','Current Receivable'],ledgerGroup:'VENDOR_LEDGER'}),
  FINANCE_PERSONS: Object.freeze({idColumn:'Person ID',nameColumn:'Person Name',phoneColumn:'Phone',roles:[],financeRoles:['Owner','Lender','Borrower'],balanceColumns:[],ledgerGroup:'FINANCE_TRANSACTIONS'}),
  EXPENSE_PAYEES: Object.freeze({idColumn:'Payee ID',nameColumn:'Payee Name',phoneColumn:'Phone',roles:['Payee'],balanceColumns:[],ledgerGroup:'EXPENSES'})
});

/** Original FinanceModule.gs: canonical roles ordered Owner,Lender,Borrower;
 * fall back to legacy Person Type, then Owner for blank historic records. */
export function rolesForLegacyRow(group,row={}) {
  const spec=partyLegacyContracts[group];
  if(!spec)throw new Error('Unknown legacy Party group: '+group);
  if(group!=='FINANCE_PERSONS')return [...spec.roles];
  const wanted=new Set(String(row.Roles||'').split(',').map(x=>x.trim()).filter(x=>spec.financeRoles.includes(x)));
  if(!wanted.size && spec.financeRoles.includes(String(row['Person Type']||'').trim()))wanted.add(String(row['Person Type']).trim());
  if(!wanted.size)wanted.add('Owner');
  return spec.financeRoles.filter(x=>wanted.has(x));
}

export function validatePartyContracts(inventory) {
  if(!inventory || !Array.isArray(inventory.tables))throw new Error('Missing source inventory');
  const map=new Map(inventory.tables.map(t=>[t.sheetKey,t]));
  for(const [group,spec] of Object.entries(partyLegacyContracts)){
    const table=map.get(group);
    if(!table)throw new Error('Missing group '+group);
    for(const header of [spec.idColumn,spec.nameColumn,spec.phoneColumn,...spec.balanceColumns]){
      if(!table.columns.includes(header))throw new Error(group+' missing required header: '+header);
    }
    if(!map.has(spec.ledgerGroup))throw new Error('Missing related group '+spec.ledgerGroup);
  }
  return true;
}
