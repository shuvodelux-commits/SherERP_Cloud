import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewOfflineSourceReferences} from '../scripts/dry-run-source-parity.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const fixture=JSON.parse(readFileSync(new URL('./fixtures/m02-source-parity.synthetic.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const make=()=>{
 const groups=Object.fromEntries(schema.tables.map(t=>[t.sheetKey,{headers:[...t.columns],rows:[]}]));
 for(const {group,sheetRow,values} of fixture.rows){
  const headers=groups[group].headers;
  for(const key of Object.keys(values))assert.ok(headers.includes(key),group+' fixture column '+key);
  groups[group].rows.push({sheetRow,cells:headers.map(key=>values[key]??'')});
 }
 return {formatVersion:1,sourceCommit:pin,groups};
};
function setCell(data,group,col,value,index=0){
 const v=data.groups[group];v.rows[index].cells[v.headers.indexOf(col)]=value;
}
function addRow(data,group,sheetRow,values={}){
 const v=data.groups[group];v.rows.push({sheetRow,cells:v.headers.map(col=>values[col]??'')});
}
const check=data=>reviewOfflineSourceReferences({schema,pinnedSourceCommit:pin,sourceExport:data});
const finding=(result,group,field,code)=>result.findings.find(x=>x.sourceGroup===group&&x.referenceField===field&&x.code===code);
const secrets=/01700000000|Synthetic Rahim|000-P1|000-S1|000P-001|synthetic-password-secret|synthetic-hash/;

test('reference audit is offline, source-frozen, and never auto-links Parties or posts money',()=>{
 const r=check(make());
 assert.equal(r.formatVersion,1);
 assert.equal(r.sourceGroups,49);
 assert.equal(r.automaticLinksCreated,0);
 assert.equal(r.d1Verified,false);
 assert.equal(r.productionReady,false);
 assert.equal(r.resolvedByNameOrPhone,false);
 assert.equal(Object.hasOwn(r,'netBalance'),false);
 assert.equal(Object.hasOwn(r,'sqlWrites'),false);
 assert.doesNotMatch(JSON.stringify(r),secrets);
});
test('valid product/purchase/sales references remain separated from human review issues',()=>{
 const r=check(make());
 assert.equal(finding(r,'PURCHASE_ITEMS','Product ID','UNRESOLVED_SOURCE_ID'),undefined);
 assert.equal(finding(r,'PURCHASE_ITEMS','Purchase ID','UNRESOLVED_SOURCE_ID'),undefined);
 assert.equal(finding(r,'SALE_ITEMS','Product ID','UNRESOLVED_SOURCE_ID'),undefined);
 assert.equal(finding(r,'SALE_ITEMS','Invoice ID','UNRESOLVED_SOURCE_ID'),undefined);
 assert.equal(finding(r,'SALE_ITEM_LOTS','Lot ID','UNRESOLVED_SOURCE_ID'),undefined);
 assert.equal(finding(r,'CUSTOMER_LEDGER','Customer ID','UNRESOLVED_SOURCE_ID'),undefined);
 assert.equal(finding(r,'SUPPLIER_LEDGER','Supplier ID','UNRESOLVED_SOURCE_ID'),undefined);
 assert.equal(finding(r,'VENDOR_LEDGER','Vendor ID','UNRESOLVED_SOURCE_ID'),undefined);
});
test('missing bank account is held for review with row provenance only, not a synthetic identity',()=>{
 const r=check(make());
 const entry=finding(r,'BANK_BOOK','Bank Account ID','UNRESOLVED_SOURCE_ID');
 assert.equal(entry.targetGroup,'BANK_ACCOUNTS');
 assert.equal(entry.count,1);
 assert.deepEqual(entry.sampleSheetRows,[4]);
 assert.equal(r.humanReviewRequired,true);
 assert.equal(r.automaticLinksCreated,0);
 const data=make();
 addRow(data,'BANK_ACCOUNTS',2,{'Bank Account ID':'BANK-001'});
 assert.equal(finding(check(data),'BANK_BOOK','Bank Account ID','UNRESOLVED_SOURCE_ID'),undefined);
});
test('shared names, phones and source ID tokens never authorize a customer/supplier merge',()=>{
 const source=make();
 setCell(source,'SALES','Customer ID','000-S1');
 const report=check(source);
 const unresolved=finding(report,'SALES','Customer ID','UNRESOLVED_SOURCE_ID');
 assert.equal(unresolved.targetGroup,'CUSTOMERS');
 assert.equal(unresolved.count,1);
 assert.equal(report.automaticLinksCreated,0);
});
test('anonymous cash sale has an optional blank customer ID without fabricated Party',()=>{
 const source=make();
 setCell(source,'SALES','Customer ID','');
 const result=check(source);
 assert.equal(finding(result,'SALES','Customer ID','MISSING_REQUIRED_SOURCE_ID'),undefined);
 assert.equal(finding(result,'SALES','Customer ID','UNRESOLVED_SOURCE_ID'),undefined);
});
test('missing required line item parent or product ID is separately flagged, not guessed',()=>{
 const source=make();
 setCell(source,'PURCHASE_ITEMS','Product ID','',0);
 const result=check(source);
 assert.equal(finding(result,'PURCHASE_ITEMS','Product ID','MISSING_REQUIRED_SOURCE_ID').count,1);
 assert.deepEqual(finding(result,'PURCHASE_ITEMS','Product ID','MISSING_REQUIRED_SOURCE_ID').sampleSheetRows,[2]);
 assert.equal(finding(result,'PURCHASE_ITEMS','Product ID','UNRESOLVED_SOURCE_ID'),undefined);
});
test('source ID comparison is exact, including leading zeros, trailing whitespace and case',()=>{
 const source=make();
 setCell(source,'STOCK_LOTS','Product ID','000P-1');
 assert.equal(finding(check(source),'STOCK_LOTS','Product ID','UNRESOLVED_SOURCE_ID').count,1);
 setCell(source,'STOCK_LOTS','Product ID','000P-001 ');
 assert.equal(finding(check(source),'STOCK_LOTS','Product ID','UNRESOLVED_SOURCE_ID').count,1);
 setCell(source,'STOCK_LOTS','Product ID','000P-001');
 assert.equal(finding(check(source),'STOCK_LOTS','Product ID','UNRESOLVED_SOURCE_ID'),undefined);
});
test('unresolved source references are not silently healed by supplier/vendor/finance names',()=>{
 const source=make();
 addRow(source,'FINANCE_TRANSACTIONS',4,{'Finance ID':'FIN-002','Person':'Synthetic Rahim','Person ID':'F-UNKNOWN'});
 const result=check(source);
 assert.equal(finding(result,'FINANCE_TRANSACTIONS','Person ID','UNRESOLVED_SOURCE_ID').count,1);
 assert.equal(result.automaticLinksCreated,0);
 assert.doesNotMatch(JSON.stringify(result),secrets);
});
test('historical stock and sale item lots can retain unknown parent as review, never auto-post',()=>{
 const source=make();
 setCell(source,'SALE_ITEM_LOTS','Lot ID','LOT-REMOVED');
 const report=check(source);
 assert.equal(finding(report,'SALE_ITEM_LOTS','Lot ID','UNRESOLVED_SOURCE_ID').count,1);
 assert.equal(report.productionReady,false);
});
test('Bank Transfers review From/To independent account IDs, even where a label is shared',()=>{
 const source=make();
 addRow(source,'BANK_TRANSFERS',2,{
  'Transfer ID':'T-1','From Account ID':'FROM-X','To Account ID':'TO-X',
  'From Account Name':'Same Name','To Account Name':'Same Name'
 });
 const r=check(source);
 assert.equal(finding(r,'BANK_TRANSFERS','From Account ID','UNRESOLVED_SOURCE_ID').count,1);
 assert.equal(finding(r,'BANK_TRANSFERS','To Account ID','UNRESOLVED_SOURCE_ID').count,1);
});
test('row order permutation does not change review output, physical rows do',()=>{
 const source=make();
 const before=check(source);
 source.groups.SALE_ITEMS.rows.reverse();
 source.groups.PURCHASE_ITEMS.rows.reverse();
 assert.deepEqual(check(source),before);
});
test('frozen export checks are required even for an isolated relationship review',()=>{
 const source=make();
 source.groups.CUSTOMERS.headers[0]='Fake ID';
 assert.throws(()=>check(source),/rejected|HEADER_MISMATCH/);
 const supplementary=make();
 supplementary.sourceCommit='590adfad128fe7155bfb7b608a2ed5665b202a9c';
 assert.throws(()=>check(supplementary),/rejected|SOURCE_COMMIT/);
});
