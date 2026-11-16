import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const frozenConfig=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
const frozenDayBook=readFileSync(new URL('../legacy/source/DayBook.gs',import.meta.url),'utf8');
const expected=[
  ['sales','SALES','Invoice ID','Sales',30],
  ['salesReturns','SALES_RETURN','Return ID','Sales Return',25],
  ['purchases','PURCHASES','Purchase ID','Purchases',23],
  ['purchaseReturns','PURCHASE_RETURN','Return ID','Purchase Return',18],
  ['customerLedgerRows','CUSTOMER_LEDGER','Ledger ID','Customer Ledger',24],
  ['supplierLedgerRows','SUPPLIER_LEDGER','Ledger ID','Supplier Ledger',23],
  ['expenses','EXPENSES','Expense ID','Expenses',23],
  ['financeTransactions','FINANCE_TRANSACTIONS','Finance ID','Finance Transactions',20],
  ['bankTransfers','BANK_TRANSFERS','Transfer ID','Bank Transfers',14],
  ['bankEntries','BANK_BOOK','Entry ID','Bank Book',18],
  ['stockMovements','STOCK_MOVEMENT','Movement ID','Stock Movement',15],
  ['cashBookRows','CASH_BOOK','Entry ID','Cash Book',14]
];
assert.equal(source.tables.length,49,'frozen 49-group Config.gs schema inventory changed');
for(const [,key] of expected)
  assert.match(frozenConfig,new RegExp('\\b'+key+'\\s*:'),'frozen group not declared: '+key);
assert.match(frozenDayBook,/activeRows_\('CASH_BOOK'\)/);

const impl=await import('../src/modules/m09-daybook-source-schema-contract.js')
  .catch(err=>{
    if(err.code==='ERR_MODULE_NOT_FOUND')return null;
    throw err;
  });
function verify(inventory){
  assert.equal(typeof impl?.verifyDayBookSourceSchema,'function',
    'M09 frozen 12-group Day Book source schema contract not implemented');
  return impl.verifyDayBookSourceSchema(inventory);
}
const clone=x=>JSON.parse(JSON.stringify(x));

test('frozen inventory validates 12 ordered source groups, exact headers and source ID header without inventing historical row IDs',()=>{
  const a=verify(source);
  assert.equal(a.length,12);
  assert.deepEqual(a.map(x=>[x.sourceGroup,x.sheetKey,x.identityColumn,x.sheetName,x.headers.length]),expected);
  assert.deepEqual(a.map(x=>x.sheetKey),expected.map(x=>x[1]));
  for(let i=0;i<expected.length;i++){
    const [,key,id]=expected[i],f=source.tables.find(x=>x.sheetKey===key);
    assert.deepEqual(a[i].headers,f.columns,'exact source header order is mandatory for '+key);
    assert.ok(a[i].headers.includes(id),'ID header must be declared in '+key);
    assert.deepEqual(Object.keys(a[i]),['sourceGroup','sheetKey','identityColumn','sheetName','headers']);
    assert.equal(Object.isFrozen(a[i]),true);
    assert.equal(Object.isFrozen(a[i].headers),true);
  }
  assert.equal(Object.isFrozen(a),true);
});

test('all 12 frozen groups must appear exactly once and identical ordered headings; unrelated groups do not affect result',()=>{
  const baseline=clone(source);
  const bad=[];
  const missing=clone(source);missing.tables=missing.tables.filter(x=>x.sheetKey!=='CASH_BOOK');bad.push(missing);
  const duplicate=clone(source);duplicate.tables.push(clone(duplicate.tables.find(x=>x.sheetKey==='SALES')));bad.push(duplicate);
  const reorder=clone(source);reorder.tables.find(x=>x.sheetKey==='BANK_BOOK').columns.reverse();bad.push(reorder);
  const missingHeader=clone(source);missingHeader.tables.find(x=>x.sheetKey==='SUPPLIER_LEDGER').columns.pop();bad.push(missingHeader);
  const extra=clone(source);extra.tables.find(x=>x.sheetKey==='CASH_BOOK').columns.push('Unreviewed Field');bad.push(extra);
  const renamedId=clone(source);renamedId.tables.find(x=>x.sheetKey==='PURCHASE_RETURN').columns[0]='Invented ID';bad.push(renamedId);
  const duplicateHeader=clone(source);duplicateHeader.tables.find(x=>x.sheetKey==='CUSTOMER_LEDGER').columns[1]='Ledger ID';bad.push(duplicateHeader);
  for(const x of bad)assert.throws(()=>verify(x),/source|schema|header|column|duplicate|missing|invalid|unreviewed/i);
  assert.deepEqual(verify(baseline).map(x=>x.sheetKey),expected.map(x=>x[1]));
});

test('strict own-data validation rejects prototype, accessors, symbols, nonarrays and nested objects',()=>{
  const wrong=[null,[],{},Object.create({tables:source.tables}),
    {tables:'not an array'},{tables:[null]}];
  const getter=clone(source);
  Object.defineProperty(getter.tables.find(x=>x.sheetKey==='SALES'),'columns',{get(){throw Error('unsafe accessor invoked');}});
  wrong.push(getter);
  const sym=clone(source);sym[Symbol('test')]='bad';wrong.push(sym);
  const sparse=clone(source);sparse.tables[3]=undefined;wrong.push(sparse);
  const exotic=clone(source);exotic.tables.find(x=>x.sheetKey==='SALES').columns[1]={field:'Date'};wrong.push(exotic);
  const dupKeys=clone(source);dupKeys.tables.push({...dupKeys.tables[0],sheetKey:'SALES'});wrong.push(dupKeys);
  for(const x of wrong)assert.throws(()=>verify(x),/invalid|source|trusted|schema|accessor|column|duplicate|array/i);
});

test('returned schemas and original inventory are independent and immutable, including independent gross ledgers',()=>{
  const input=clone(source),before=JSON.stringify(input);
  const a=verify(input);
  assert.notEqual(a.find(x=>x.sheetKey==='CUSTOMER_LEDGER'),a.find(x=>x.sheetKey==='SUPPLIER_LEDGER'));
  assert.equal(a.find(x=>x.sheetKey==='CUSTOMER_LEDGER').identityColumn,'Ledger ID');
  assert.equal(a.find(x=>x.sheetKey==='SUPPLIER_LEDGER').identityColumn,'Ledger ID');
  assert.throws(()=>{a[0].sourceGroup='tampered';},TypeError);
  assert.throws(()=>{a[0].headers.push('Injected');},TypeError);
  input.tables.find(x=>x.sheetKey==='SALES').columns[0]='Tampered';
  assert.equal(a[0].headers[0],'Invoice ID');
  assert.notEqual(JSON.stringify(input),before);
  assert.equal(verify(source)[0].identityColumn,'Invoice ID');
});

test('no database import, Worker RPC, production route, cash/party settlement or migration added',()=>{
  verify(source);
  const code=readFileSync(new URL('../src/modules/m09-daybook-source-schema-contract.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(code,/\b(?:prepare|batch|exec|fetch)\s*\(|\bDB\.|cacheService|google\.script\.run/);
  assert.match(registry,/Object\.freeze\(Object\.create\(null\)\)/);
  assert.equal(JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc',import.meta.url),'utf8')).d1_databases,undefined);
});
