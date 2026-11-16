/**
 * M09 internal, pure, frozen-source contract for all twelve Day Book groups.
 * Original Config.gs headers at Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * This validates header shape ONLY: not historical row IDs (Cash/Bank may lack
 * them), completed imports, ownership/tenant, accounting, or D1 readiness.
 * No D1, public RPC, posting or mutation paths.
 */
const SOURCE_GROUPS=Object.freeze([
  {
    "sourceGroup": "sales",
    "sheetKey": "SALES",
    "identityColumn": "Invoice ID",
    "sheetName": "Sales",
    "headers": [
      "Invoice ID",
      "Date",
      "Time",
      "Customer ID",
      "Customer Name",
      "Customer Phone",
      "Customer Address",
      "Subtotal",
      "Discount",
      "Grand Total",
      "Paid Amount",
      "Due Amount",
      "Payment Type",
      "Payment Status",
      "Created By",
      "Created At",
      "Payment Method",
      "Bank Account ID",
      "Bank Account Name",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Source Draft ID",
      "Payment Detail Version",
      "Customer Relation Name",
      "Customer Relation Type",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ]
  },
  {
    "sourceGroup": "salesReturns",
    "sheetKey": "SALES_RETURN",
    "identityColumn": "Return ID",
    "sheetName": "Sales Return",
    "headers": [
      "Return ID",
      "Date",
      "Invoice ID",
      "Customer ID",
      "Customer Name",
      "Customer Phone",
      "Refund Method",
      "Total Return Amount",
      "Reason",
      "Notes",
      "Processed By",
      "Created At",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
      "Batch ID",
      "Return Operation ID",
      "Edit Version",
      "Updated At",
      "Updated By",
      "Edit Reason"
    ]
  },
  {
    "sourceGroup": "purchases",
    "sheetKey": "PURCHASES",
    "identityColumn": "Purchase ID",
    "sheetName": "Purchases",
    "headers": [
      "Purchase ID",
      "Date",
      "Supplier ID",
      "Supplier Name",
      "Subtotal",
      "Discount",
      "Grand Total",
      "Paid Amount",
      "Due Amount",
      "Payment Status",
      "Notes",
      "Created By",
      "Created At",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
      "Payment Method",
      "Bank Account ID",
      "Bank Account Name"
    ]
  },
  {
    "sourceGroup": "purchaseReturns",
    "sheetKey": "PURCHASE_RETURN",
    "identityColumn": "Return ID",
    "sheetName": "Purchase Return",
    "headers": [
      "Return ID",
      "Date",
      "Purchase ID",
      "Supplier ID",
      "Supplier Name",
      "Refund Method",
      "Total Return Amount",
      "Reason",
      "Notes",
      "Processed By",
      "Created At",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ]
  },
  {
    "sourceGroup": "customerLedgerRows",
    "sheetKey": "CUSTOMER_LEDGER",
    "identityColumn": "Ledger ID",
    "sheetName": "Customer Ledger",
    "headers": [
      "Ledger ID",
      "Date",
      "Customer ID",
      "Customer Name",
      "Type",
      "Reference",
      "Debit",
      "Credit",
      "Balance",
      "Notes",
      "Payment Method",
      "Payment Amount",
      "Discount Amount",
      "Discount Reason",
      "Allocated Invoice ID",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Created By",
      "Created At",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ]
  },
  {
    "sourceGroup": "supplierLedgerRows",
    "sheetKey": "SUPPLIER_LEDGER",
    "identityColumn": "Ledger ID",
    "sheetName": "Supplier Ledger",
    "headers": [
      "Ledger ID",
      "Date",
      "Supplier ID",
      "Supplier Name",
      "Type",
      "Reference",
      "Debit",
      "Credit",
      "Balance",
      "Notes",
      "Payment Method",
      "Payment Amount",
      "Discount Amount",
      "Discount Reason",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Created By",
      "Created At",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ]
  },
  {
    "sourceGroup": "expenses",
    "sheetKey": "EXPENSES",
    "identityColumn": "Expense ID",
    "sheetName": "Expenses",
    "headers": [
      "Expense ID",
      "Date",
      "Category ID",
      "Category Name",
      "Ledger ID",
      "Ledger Name",
      "Amount",
      "Payment Method",
      "Description",
      "Reference No",
      "Notes",
      "Status",
      "Created By",
      "Created At",
      "Bank Account ID",
      "Bank Account Name",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ]
  },
  {
    "sourceGroup": "financeTransactions",
    "sheetKey": "FINANCE_TRANSACTIONS",
    "identityColumn": "Finance ID",
    "sheetName": "Finance Transactions",
    "headers": [
      "Finance ID",
      "Date",
      "Transaction Type",
      "Person",
      "Payment Method",
      "Bank Account ID",
      "Bank Account Name",
      "Amount",
      "Reference No",
      "Notes",
      "Created By",
      "Created At",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason",
      "Person ID"
    ]
  },
  {
    "sourceGroup": "bankTransfers",
    "sheetKey": "BANK_TRANSFERS",
    "identityColumn": "Transfer ID",
    "sheetName": "Bank Transfers",
    "headers": [
      "Transfer ID",
      "Date",
      "From Account ID",
      "From Account Name",
      "To Account ID",
      "To Account Name",
      "Amount",
      "Notes",
      "Created By",
      "Created At",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ]
  },
  {
    "sourceGroup": "bankEntries",
    "sheetKey": "BANK_BOOK",
    "identityColumn": "Entry ID",
    "sheetName": "Bank Book",
    "headers": [
      "Entry ID",
      "Date",
      "Bank Account ID",
      "Bank Account Name",
      "Type",
      "Reference",
      "Description",
      "Debit",
      "Credit",
      "Balance",
      "Notes",
      "Status",
      "Reversal Of",
      "Created By",
      "Created At",
      "Is Backdated",
      "Backdated Days",
      "Backdated Reason"
    ]
  },
  {
    "sourceGroup": "stockMovements",
    "sheetKey": "STOCK_MOVEMENT",
    "identityColumn": "Movement ID",
    "sheetName": "Stock Movement",
    "headers": [
      "Movement ID",
      "Date",
      "Product ID",
      "Product Name",
      "Type",
      "Reference",
      "Quantity In",
      "Quantity Out",
      "Balance Stock",
      "Notes",
      "Lot ID",
      "Source Sale Product ID",
      "Source Consumption Link ID",
      "Reversed By",
      "Reversed At"
    ]
  },
  {
    "sourceGroup": "cashBookRows",
    "sheetKey": "CASH_BOOK",
    "identityColumn": "Entry ID",
    "sheetName": "Cash Book",
    "headers": [
      "Entry ID",
      "Date",
      "Type",
      "Reference",
      "Description",
      "Debit",
      "Credit",
      "Balance",
      "Payment Method",
      "Created At",
      "Is Deleted",
      "Deleted By",
      "Deleted At",
      "Delete Reason"
    ]
  }
].map(x=>Object.freeze({...x,headers:Object.freeze([...x.headers])})));

function ownRecord(input,label){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     (Object.getPrototypeOf(input)!==Object.prototype&&Object.getPrototypeOf(input)!==null))
    throw new TypeError('Invalid Day Book source '+label+' record');
  const fields=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(fields).some(key=>typeof key!=='string'||!Object.hasOwn(fields[key],'value')))
    throw new TypeError('Invalid Day Book source '+label+' accessor');
  return fields;
}

function ownArray(input,label){
  if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype)
    throw new TypeError('Invalid Day Book source '+label+' array');
  const fields=Object.getOwnPropertyDescriptors(input);
  if(Reflect.ownKeys(fields).length!==input.length+1||
     Reflect.ownKeys(fields).some(key=>key!=='length'&&
       (typeof key!=='string'||!/^(?:0|[1-9]\d*)$/.test(key)||
        !Object.hasOwn(fields[key],'value'))))
    throw new TypeError('Invalid incomplete Day Book source '+label+' array');
  return Array.from({length:input.length},(_,i)=>fields[String(i)].value);
}

function sourceRow(row){
  const fields=ownRecord(row,'inventory table');
  if(Reflect.ownKeys(fields).length!==3||
     ['sheetKey','sheetName','columns'].some(k=>!Object.hasOwn(fields,k)))
    throw new TypeError('Invalid source schema table descriptors');
  const sheetKey=fields.sheetKey.value,sheetName=fields.sheetName.value;
  if(typeof sheetKey!=='string'||!sheetKey||typeof sheetName!=='string'||!sheetName)
    throw new TypeError('Invalid source schema group identity');
  const headers=ownArray(fields.columns.value,sheetKey+' columns');
  if(!headers.length||headers.some(h=>typeof h!=='string'||!h.trim())||
     new Set(headers).size!==headers.length)
    throw new TypeError('Invalid or duplicate Day Book source column header');
  return {sheetKey,sheetName,headers};
}

/** Validate all source entries before comparing the twelve pinned groups. */
export function verifyDayBookSourceSchema(inventory){
  const fields=ownRecord(inventory,'inventory');
  if(Reflect.ownKeys(fields).length!==2||
     !Object.hasOwn(fields,'formatVersion')||!Object.hasOwn(fields,'tables')||
     fields.formatVersion.value!==1)
    throw new TypeError('Invalid source schema inventory format');
  const rows=ownArray(fields.tables.value,'tables').map(sourceRow);
  const result=[];
  for(const expected of SOURCE_GROUPS){
    const found=rows.filter(row=>row.sheetKey===expected.sheetKey);
    if(found.length!==1)throw new TypeError('Missing or duplicate Day Book source group '+expected.sheetKey);
    const row=found[0];
    if(row.sheetName!==expected.sheetName||
       row.headers.length!==expected.headers.length||
       row.headers.some((name,i)=>name!==expected.headers[i]))
      throw new TypeError('Unreviewed Day Book source schema column change '+expected.sheetKey);
    result.push(Object.freeze({...expected,headers:Object.freeze([...expected.headers])}));
  }
  return Object.freeze(result);
}
