import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ROLES,sourceSupplierParties,normalizePartyDirectory,projectSupplierStatement,
  filterPartyDirectory,parseMoneyPaisa,formatMoneyPaisa,sourceSupplierCreatePayload
} from '../../src/ui/hisabiq/party-workspace.mjs';
import {patchOwnerHisabiqParties} from '../../scripts/patch-owner-hisabiq-parties.mjs';

const row=(changes={})=>({
  'Supplier ID':'SUP-000014','Supplier Name':'Rahim Traders',
  Phone:'01711000000',Address:'Dhaka','Current Due':1200.55,
  'Opening Balance':0,Status:'Active',...changes
});

test('seven roles are separate relationships, never staff permissions',()=>{
  assert.deepEqual(ROLES,['Customer','Supplier','Vendor','Lender','Borrower','Payee','Owner']);
});

test('only source-linked Supplier fallback is allowed; no fabricated Party identity or other roles',()=>{
  const list=sourceSupplierParties({suppliers:[row()]});
  assert.equal(list.length,1);
  assert.equal(list[0].partyId,null);
  assert.equal(list[0].id,'source:SUP-000014');
  assert.deepEqual(list[0].roles,['Supplier']);
  assert.equal(list[0].sourceOnly,true);
  assert.equal(list[0].gross.Supplier.payablePaisa,120055);
  assert.equal(list[0].gross.Supplier.receivablePaisa,0);
  assert.deepEqual(filterPartyDirectory(list,'Rahim','Customer'),[]);
  assert.equal(filterPartyDirectory(list,'01711','Supplier').length,1);
  assert.equal(filterPartyDirectory(list,'rahi','All').length,1);
});

test('negative Supplier due is advance receivable, not a supplier debt',()=>{
  const [supplier]=sourceSupplierParties({suppliers:[row({'Current Due':-89.25})]});
  assert.equal(supplier.gross.Supplier.receivablePaisa,8925);
  assert.equal(supplier.gross.Supplier.payablePaisa,0);
});

test('generic Party response accepts multiple roles without automatic netting',()=>{
  const records=normalizePartyDirectory({success:true,data:{parties:[{
    partyId:'PTY-000014',displayName:'Rahim Traders',phone:'01711000000',roles:['Customer','Supplier','Lender'],
    roleBalances:[
      {role:'Customer',receivablePaisa:500000,payablePaisa:0},
      {role:'Supplier',receivablePaisa:0,payablePaisa:300000},
      {role:'Lender',receivablePaisa:0,payablePaisa:2000000}
    ]
  }]}});
  assert.equal(records[0].partyId,'PTY-000014');
  assert.equal(records[0].sourceOnly,false);
  assert.equal(records[0].gross.Customer.receivablePaisa,500000);
  assert.equal(records[0].gross.Supplier.payablePaisa,300000);
  assert.equal(records[0].gross.Lender.payablePaisa,2000000);
  assert.equal(records[0].gross.Customer.payablePaisa,0);
  assert.equal(records[0].gross.Supplier.receivablePaisa,0);
});

test('source-only directory does not merge same-name, same-phone suppliers',()=>{
  const list=sourceSupplierParties({suppliers:[
    row({'Supplier ID':'SUP-000014'}),row({'Supplier ID':'SUP-000015'})
  ]});
  assert.equal(list.length,2);
  assert.notEqual(list[0].id,list[1].id);
});

test('invalid, ambiguous and oversized server results fail closed',()=>{
  assert.throws(()=>sourceSupplierParties({suppliers:[row({'Supplier ID':'../../bad'})]}));
  assert.throws(()=>sourceSupplierParties({suppliers:[row({'Current Due':NaN})]}));
  assert.throws(()=>sourceSupplierParties({suppliers:[row(),row()]}),/duplicate/i);
  assert.throws(()=>sourceSupplierParties({suppliers:Array(1001).fill(row())}),/unavailable|limit/i);
  assert.throws(()=>normalizePartyDirectory({success:true,data:{parties:[{
    partyId:'PTY-000001',displayName:'R',roles:['Customer','Customer'],roleBalances:[]
  }]}}),/duplicate/i);
  assert.throws(()=>normalizePartyDirectory({success:true,data:{parties:[{
    partyId:'PTY-000001',displayName:'R',roles:['Customer'],roleBalances:[{role:'Supplier',receivablePaisa:0,payablePaisa:0}]
  }]}}));
  assert.throws(()=>parseMoneyPaisa('1e12'));
  assert.equal(parseMoneyPaisa('1200.55'),120055);
  assert.equal(formatMoneyPaisa(120055),'৳1,200.55');
});

test('read-only source Supplier ledger keeps authoritative full balance, flags page truncation',()=>{
  const result=projectSupplierStatement({
    success:true,data:{
      scope:'purchase-and-cash-payment',supplierId:'SUP-000014',supplierName:'Rahim Traders',
      currentDuePaisa:120055,hasMore:true,entries:[
        {kind:'Supplier Payment',reference:'SPY-000002',purchaseDate:'2026-11-21',debitPaisa:0,creditPaisa:49945,balancePaisa:120055},
        {kind:'Purchase',reference:'PUR-000007',purchaseDate:'2026-11-20',debitPaisa:170000,creditPaisa:0,balancePaisa:170000}
      ]
    }
  },'SUP-000014');
  assert.equal(result.currentDuePaisa,120055);
  assert.equal(result.entries.length,2);
  assert.equal(result.complete,false);
  assert.equal(result.entries[0].balancePaisa,120055);
  assert.equal(result.entries[1].reference,'PUR-000007');
  assert.throws(()=>projectSupplierStatement({success:true,data:{supplierId:'SUP-000099'}},'SUP-000014'));
});

test('patch adds isolated Party screen without deleting original ledgers or exposing new financial writes',()=>{
  const html='<html><head></head><body><main class="content" id="content"><div class="tabs" id="subNav" hidden></div><section class="page" id="page-customers">C</section><section class="page" id="page-suppliers">S</section><section id="page-supplierLedger">L</section></main></body></html>';
  const css='[data-hisabiq-design-system] { --hds-control-height: 36px; }';
  const js='const readOnly=true;';
  const output=patchOwnerHisabiqParties(html,{css,js});
  assert.match(output,/id="page-hisabiqParties"/);
  assert.match(output,/data-hisabiq-design-system/);
  assert.match(output,/id="page-customers">C/);
  assert.match(output,/id="page-suppliers">S/);
  assert.match(output,/id="page-supplierLedger">L/);
  assert.match(output,/type="module" id="hisabiq-party-controller"/);
  assert.match(output,/--hds-control-height: 36px/);
  assert.throws(()=>patchOwnerHisabiqParties(output,{css,js}),/already|duplicate/i);
});

test('source Party mobile/desktop CSS uses the exact 768px and 1024px breakpoints and accessible picker',()=>{
  const css=readFileSync(new URL('../../src/ui/hisabiq/party-workspace.css',import.meta.url),'utf8');
  const source=readFileSync(new URL('../../src/ui/hisabiq/party-workspace.mjs',import.meta.url),'utf8');
  assert.match(css,/@media\s*\(min-width:\s*1024px\)/);
  assert.match(css,/@media\s*\(min-width:\s*768px\)/);
  assert.match(css,/@media\s*\(max-width:\s*767px\)/);
  assert.match(css,/340px/);
  assert.match(css,/380px/);
  assert.match(css,/88dvh/);
  assert.match(css,/prefers-reduced-motion:\s*reduce/);
  assert.match(source,/aria-modal/);
  assert.match(source,/aria-selected/);
  assert.match(source,/AbortController|AbortSignal/);
  assert.equal((source.match(/method:\s*['"]POST['"]/g)||[]).length,1,
    'Only the existing authenticated Supplier create POST is allowed');
  assert.match(source,/fetch\('\/api\/owner\/suppliers'/);
  assert.doesNotMatch(source,/dispatchPartyPreview|availableParties|mock ledger/i);
});

test('Supplier quick-add payload is source-only, zero opening and operation-id scoped',()=>{
  const operationId='ee444444-4444-4444-8444-444444444444';
  assert.deepEqual(sourceSupplierCreatePayload({
    name:'  New Hardware  ',phone:'01711111111',address:'Dhaka',notes:'Trade'
  },operationId),{
    operationId,name:'New Hardware',phone:'01711111111',
    address:'Dhaka',notes:'Trade',openingBalance:'0'
  });
  assert.throws(()=>sourceSupplierCreatePayload({name:'   '},operationId),/name/i);
  assert.throws(()=>sourceSupplierCreatePayload({name:'N'.repeat(121)},operationId),/name/i);
  assert.throws(()=>sourceSupplierCreatePayload({name:'Valid',openingBalance:'9.00'},operationId),/opening/i);
  assert.throws(()=>sourceSupplierCreatePayload({name:'Valid'},'non-uuid'),/operation/i);
});
