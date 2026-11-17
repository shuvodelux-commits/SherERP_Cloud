import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {reviewM02MasterIdentityCandidates} from '../scripts/dry-run-master-identity-review.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const pin=JSON.parse(readFileSync(new URL('../docs/baseline/source-manifest.json',import.meta.url),'utf8')).source.commit;
const cli=new URL('../scripts/dry-run-master-identity-review.mjs',import.meta.url).pathname;
const source=()=>({formatVersion:1,sourceCommit:pin,groups:Object.fromEntries(
 schema.tables.map(t=>[t.sheetKey,{headers:[...t.columns],rows:[]}])
)});
function add(x,group,sheetRow,fields){
 const t=x.groups[group],cells=t.headers.map(h=>fields[h]??'');
 t.rows.push({sheetRow,cells});
 return x;
}
const review=x=>reviewM02MasterIdentityCandidates({schema,pinnedSourceCommit:pin,sourceExport:x});
const issue=(r,code,group)=>r.issues.find(x=>x.code===code&&x.sourceGroup===group);
const clone=x=>structuredClone(x);

test('all 49 source groups are checked; zero-review synthetic source does not imply import authority',()=>{
 const r=review(source());
 assert.equal(r.sourceGroups,49);
 assert.equal(r.masterGroupsReviewed,2);
 assert.equal(r.partyMasterGroupsReviewed,5);
 assert.equal(r.issues.length,0);
 assert.equal(r.humanReviewRequired,false);
 assert.equal(r.automaticPartyLinksCreated,0);
 assert.equal(r.masterIdentitiesMerged,0);
 for(const k of ['d1Verified','sourceToD1Reconciled','identityConsolidationAuthorized','productionReady','independentSourceExportVerified'])
  assert.equal(r[k],false,k);
});

test('different Category IDs with identical original Category Name require human review',()=>{
 const x=source();
 add(x,'PRODUCT_CATEGORIES',2,{'Category ID':'CAT-000001','Category Name':'Electrical'});
 add(x,'PRODUCT_CATEGORIES',7,{'Category ID':'CAT-000002','Category Name':'Electrical'});
 const r=review(x);
 assert.equal(issue(r,'DUPLICATE_MASTER_DISPLAY_NAME_REVIEW','PRODUCT_CATEGORIES')?.count,1);
 assert.equal(r.humanReviewRequired,true);
 assert.equal(r.masterIdentitiesMerged,0);
});

test('different Unit IDs with identical original Unit Name require human review',()=>{
 const x=source();
 add(x,'PRODUCT_UNITS',2,{'Unit ID':'UNT-000001','Unit Name':'Box'});
 add(x,'PRODUCT_UNITS',5,{'Unit ID':'UNT-000002','Unit Name':'Box'});
 const r=review(x);
 assert.equal(issue(r,'DUPLICATE_MASTER_DISPLAY_NAME_REVIEW','PRODUCT_UNITS')?.count,1);
});

test('original label spelling, spacing, case and Unicode form are not normalized into automatic duplicates',()=>{
 const x=source();
 for(const [i,name] of ['Box','box',' Box','Box ','বক্স'].entries())
  add(x,'PRODUCT_UNITS',i+2,{'Unit ID':'UNT-'+String(i+1).padStart(6,'0'),'Unit Name':name});
 assert.equal(review(x).humanReviewRequired,false);
});

test('Customer/Supplier same nonempty original name+phone is candidate only, never Party link',()=>{
 const x=source();
 add(x,'CUSTOMERS',2,{'Customer ID':'CUS-000001','Customer Name':'Synthetic Person','Phone':'01700-000000'});
 add(x,'SUPPLIERS',3,{'Supplier ID':'SUP-000001','Supplier Name':'Synthetic Person','Phone':'01700-000000'});
 const r=review(x);
 assert.equal(issue(r,'POSSIBLE_CROSS_ROLE_IDENTITY_REVIEW','CUSTOMERS/SUPPLIERS')?.count,1);
 assert.equal(r.automaticPartyLinksCreated,0);
 assert.equal(r.identityConsolidationAuthorized,false);
 assert.equal(r.sourceToD1Reconciled,false);
});

test('Vendor and Finance Person exact name+phone can be review candidates without netting due/receivable/loan',()=>{
 const x=source();
 add(x,'VENDORS',2,{'Vendor ID':'VEN-000001','Vendor Name':'Synthetic Person','Phone':'01700-000000','Current Due':'100','Current Receivable':'200'});
 add(x,'FINANCE_PERSONS',9,{'Person ID':'PER-000001','Person Name':'Synthetic Person','Phone':'01700-000000','Person Type':'Lender','Roles':'Lender'});
 const r=review(x);
 assert.equal(issue(r,'POSSIBLE_CROSS_ROLE_IDENTITY_REVIEW','FINANCE_PERSONS/VENDORS')?.count,1);
 assert.equal(r.automaticPartyLinksCreated,0);
 assert.ok(!JSON.stringify(r).includes('100'));
 assert.ok(!JSON.stringify(r).includes('200'));
});

test('matching only phone or only name cannot create cross-role identity candidate',()=>{
 const x=source();
 add(x,'CUSTOMERS',2,{'Customer ID':'CUS-000001','Customer Name':'Person A','Phone':'01700-000000'});
 add(x,'SUPPLIERS',3,{'Supplier ID':'SUP-000001','Supplier Name':'Person A','Phone':'01700-000001'});
 add(x,'VENDORS',4,{'Vendor ID':'VEN-000001','Vendor Name':'Person B','Phone':'01700-000000'});
 assert.equal(review(x).issues.some(i=>i.code==='POSSIBLE_CROSS_ROLE_IDENTITY_REVIEW'),false);
});

test('blank names or phones do not match and no source Party role is fabricated',()=>{
 const x=source();
 add(x,'CUSTOMERS',2,{'Customer ID':'CUS-000001','Customer Name':'','Phone':'01700-000000'});
 add(x,'SUPPLIERS',2,{'Supplier ID':'SUP-000001','Supplier Name':'','Phone':'01700-000000'});
 add(x,'FINANCE_PERSONS',2,{'Person ID':'PER-000001','Person Name':'Synthetic Person','Phone':''});
 add(x,'EXPENSE_PAYEES',2,{'Payee ID':'PAY-000001','Payee Name':'Synthetic Person','Phone':''});
 assert.equal(review(x).issues.some(i=>i.code==='POSSIBLE_CROSS_ROLE_IDENTITY_REVIEW'),false);
});

test('a third cross-role party record produces independent pair review, not transitive auto-linkage',()=>{
 const x=source();
 add(x,'CUSTOMERS',2,{'Customer ID':'CUS-000001','Customer Name':'Synthetic Person','Phone':'01700-000000'});
 add(x,'SUPPLIERS',2,{'Supplier ID':'SUP-000001','Supplier Name':'Synthetic Person','Phone':'01700-000000'});
 add(x,'EXPENSE_PAYEES',2,{'Payee ID':'PAY-000001','Payee Name':'Synthetic Person','Phone':'01700-000000'});
 const r=review(x);
 assert.equal(r.issues.filter(i=>i.code==='POSSIBLE_CROSS_ROLE_IDENTITY_REVIEW').length,3);
 assert.equal(r.automaticPartyLinksCreated,0);
});

test('multiple duplicate names and source row reordering preserve deterministic issue counts',()=>{
 const x=source();
 for(let i=0;i<3;i++)add(x,'PRODUCT_CATEGORIES',i+2,{'Category ID':'CAT-'+String(i+1).padStart(6,'0'),'Category Name':'Synthetic Category'});
 const a=review(x),swapped=clone(x);
 swapped.groups.PRODUCT_CATEGORIES.rows.reverse();
 const b=review(swapped);
 assert.deepEqual(b,a);
 assert.equal(issue(a,'DUPLICATE_MASTER_DISPLAY_NAME_REVIEW','PRODUCT_CATEGORIES')?.count,2);
});

test('original duplicate Category ID is rejected before any human-review candidates are built',()=>{
 const x=source();
 add(x,'PRODUCT_CATEGORIES',2,{'Category ID':'CAT-000001','Category Name':'A'});
 add(x,'PRODUCT_CATEGORIES',4,{'Category ID':'CAT-000001','Category Name':'B'});
 assert.throws(()=>review(x),/M02 offline parity rejected: DUPLICATE_RECORD_ID/);
});

test('missing source group, wrong header and unexpected source SHA fail closed',()=>{
 const x=source();
 delete x.groups.PRODUCT_UNITS;
 assert.throws(()=>review(x),/M02 offline parity rejected/);
 const y=source();y.groups.CUSTOMERS.headers.reverse();
 assert.throws(()=>review(y),/M02 offline parity rejected/);
 const z=source();z.sourceCommit='0'.repeat(40);
 assert.throws(()=>review(z),/M02 offline parity rejected/);
});

test('public report contains only fixed group names/codes/counts and no private name/phone/ID/amount',()=>{
 const x=source();
 const secret='PRIVATE_VALUE_SENTINEL_921853';
 add(x,'CUSTOMERS',2,{'Customer ID':'CUS-000001','Customer Name':secret,'Phone':'01755-PRIVATE'});
 add(x,'SUPPLIERS',2,{'Supplier ID':'SUP-000001','Supplier Name':secret,'Phone':'01755-PRIVATE','Opening Balance':'99285321'});
 const r=review(x),txt=JSON.stringify(r);
 for(const s of [secret,'CUS-000001','SUP-000001','01755-PRIVATE','99285321'])
  assert.ok(!txt.includes(s));
 assert.deepEqual(Object.keys(r.issues[0]).sort(),['code','count','sourceGroup'].sort());
});

test('CLI accepts one private local file, returns 2 for review or unsafe path, redacts original data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m02-master-review-'));
 try{
  const path=join(dir,'private-source.json'),x=source();
  writeFileSync(path,JSON.stringify(x));
  const clean=spawnSync(process.execPath,[cli,path],{encoding:'utf8'});
  assert.equal(clean.status,0,clean.stderr);
  assert.equal(JSON.parse(clean.stdout).humanReviewRequired,false);
  add(x,'PRODUCT_UNITS',2,{'Unit ID':'UNT-000001','Unit Name':'PRIVATE_VALUE_SENTINEL_921853'});
  add(x,'PRODUCT_UNITS',3,{'Unit ID':'UNT-000002','Unit Name':'PRIVATE_VALUE_SENTINEL_921853'});
  writeFileSync(path,JSON.stringify(x));
  const collision=spawnSync(process.execPath,[cli,path],{encoding:'utf8'});
  assert.equal(collision.status,2);
  assert.equal(JSON.parse(collision.stdout).humanReviewRequired,true);
  assert.ok(!(collision.stdout+collision.stderr).includes('PRIVATE_VALUE_SENTINEL_921853'));
  assert.ok(!(collision.stdout+collision.stderr).includes(path));
  const unsafe=spawnSync(process.execPath,[cli,'https://example.invalid/secret.json'],{encoding:'utf8'});
  assert.equal(unsafe.status,2);
  assert.ok(!(unsafe.stdout+unsafe.stderr).includes('example.invalid'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
