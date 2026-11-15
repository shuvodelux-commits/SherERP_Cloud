import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {auditM08FinanceContracts, assertM08Snapshot} from '../scripts/audit-m08-finance.mjs';

const SHA = '29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const F = ['FinanceModule.gs','CashBook.gs','BankBook.gs','BankAccounts.gs',
  'BankLedger.gs','CashSession.gs','CashReconciliation.gs','OpeningBalance.gs',
  'Customer.gs','Suppliers.gs','Vendors.gs','PartyLedger.gs'];
const sources = () => Object.fromEntries(F.map(file => [
  file, readFileSync(new URL('../legacy/source/' + file, import.meta.url), 'utf8')
]));
const audit = (value = sources()) => auditM08FinanceContracts({sources:value,sourceCommit:SHA});
const endpoint = (data,name) => data.surfaces.flatMap(x=>x.endpoints).find(x=>x.name===name);

test('M08 audits twelve pinned finance/cash/bank/Party source surfaces and permissions',()=>{
  const data=audit();
  assert.equal(data.sourceCommit,SHA);
  assert.equal(data.formatVersion,1);
  assert.equal(data.surfaces.length,12);
  assert.deepEqual(endpoint(data,'addFinanceTransaction').permissions,['finance:add']);
  assert.deepEqual(endpoint(data,'getFinanceLedger').permissions,['finance:view']);
  assert.deepEqual(endpoint(data,'transferBetweenBankAccounts').permissions,['bank:add']);
  assert.deepEqual(endpoint(data,'reverseBankEntry').permissions,['bank:edit']);
  assert.deepEqual(endpoint(data,'startCashSession').permissions,['pos:add']);
  assert.deepEqual(endpoint(data,'getCashSessionSummary').permissions,['pos:view']);
  assert.deepEqual(endpoint(data,'saveCashReconciliationExplanation').permissions,['cashReconciliation:edit']);
  assert.deepEqual(endpoint(data,'receivePayment').permissions,['customers:edit']);
  assert.deepEqual(endpoint(data,'paySupplier').permissions,['suppliers:edit']);
  assert.deepEqual(endpoint(data,'receiveVendorPayment').permissions,['vendors:edit']);
});

test('nine original finance transaction classes retain separate accounts and historical opening semantics',()=>{
  const types=audit().financeTypes;
  assert.deepEqual(types.map(t=>[t.key,t.role,t.account,t.balanceEffect,t.cashDirection,t.isOpening]),[
    ['Owner Investment','Owner','owner',1,'in',false],
    ['Owner Withdrawal','Owner','owner',-1,'out',false],
    ['Loan Received','Lender','loanPayable',1,'in',false],
    ['Loan Repayment','Lender','loanPayable',-1,'out',false],
    ['Borrower Loan','Borrower','borrowerReceivable',1,'out',false],
    ['Borrower Repayment','Borrower','borrowerReceivable',-1,'in',false],
    ['Opening Owner Capital','Owner','owner',1,'none',true],
    ['Opening Loan','Lender','loanPayable',1,'none',true],
    ['Opening Borrower Loan','Borrower','borrowerReceivable',1,'none',true]
  ]);
  assert.ok(endpoint(audit(),'addFinanceTransaction').directCalls.includes('requireActiveCashSession_'));
});

test('bank transfer source records one header and exactly two opposing bank book legs',()=>{
  const transfer=endpoint(audit(),'transferBetweenBankAccounts');
  assert.ok(transfer.directWrites.includes('appendRow_:BANK_TRANSFERS'));
  assert.ok(transfer.directCalls.includes('addBankBookEntry_'),
    'two bank legs are separately asserted by the analyzer');
  assert.ok(transfer.directCalls.includes('requireActiveCashSession_'));
  assert.ok(endpoint(audit(),'addBankManualEntry').directCalls.includes('requireActiveCashSession_'));
});

test('source exposes cash/bank writers and keeps customer/supplier Party projections separate',()=>{
  const data=audit();
  assert.ok(data.internal.find(x=>x.name==='addCashBookEntry_').directWrites.includes('appendRow_:CASH_BOOK'));
  assert.ok(data.internal.find(x=>x.name==='addBankBookEntry_').directWrites.includes('appendRow_:BANK_BOOK'));
  assert.ok(data.internal.find(x=>x.name==='postHistoricalOpeningCash_').directCalls.includes('addCashBookEntry_'));
  assert.deepEqual(data.internal.find(x=>x.name==='postHistoricalOpeningCash_').directCalls.includes('requireActiveCashSession_'),false);
  assert.ok(endpoint(data,'getCustomerLedgerPage').directCalls.includes('getPartyLedgerPage_'));
  assert.ok(endpoint(data,'getSupplierLedgerPage').directCalls.includes('getPartyLedgerPage_'));
  assert.ok(endpoint(data,'getCustomerLedgerStatement').directCalls.includes('getPartyLedgerStatement_'));
  assert.ok(endpoint(data,'getSupplierLedgerStatement').directCalls.includes('getPartyLedgerStatement_'));
  assert.deepEqual(
    [data.ledgerKinds.customer.permission,data.ledgerKinds.customer.ledgerSheet,
      data.ledgerKinds.supplier.permission,data.ledgerKinds.supplier.ledgerSheet],
    ['customers','CUSTOMER_LEDGER','suppliers','SUPPLIER_LEDGER']);
  for(const name of ['getPartyLedgerPage_','getPartyLedgerWorkspaceBootstrap_',
    'getPartyLedgerStatement_'])
    assert.deepEqual(data.internal.find(x=>x.name===name).permissions,['<dynamic>']);
});

test('must reject a removed permission or stale source finance contract',()=>{
  const a=sources();
  a['BankBook.gs']=a['BankBook.gs'].replace(
    "requirePermission_(token, 'bank', 'add');",
    "// requirePermission_(token, 'bank', 'add');"
  );
  assert.throws(()=>audit(a),/permission.*transferBetweenBankAccounts/i);
  const b=sources();
  b['FinanceModule.gs']=b['FinanceModule.gs'].replace(
    "cashDirection:'none', role:'Lender', isOpening:true",
    "cashDirection:'in', role:'Lender', isOpening:true"
  );
  assert.throws(()=>audit(b),/finance transaction.*drift|opening.*money/i);
});

test('must reject sign reversal, lost transfer leg or historical session turnover regression',()=>{
  const original=sources();
  const reversed={...original};
  reversed['CashBook.gs']=reversed['CashBook.gs'].replace('lastBalance + credit - debit','lastBalance + debit - credit');
  assert.throws(()=>audit(reversed),/cash.*sign|balance.*direction/i);
  const transfer={...original};
  transfer['BankBook.gs']=transfer['BankBook.gs'].replace("Debit: '', Credit: amount","Debit: amount, Credit: ''");
  assert.throws(()=>audit(transfer),/transfer.*leg|bank.*direction/i);
  const turnover={...original};
  turnover['CashSession.gs']=turnover['CashSession.gs'].replace(
    "if (cashRows[i]['Type'] === 'Historical Opening') continue;",
    "if (cashRows[i]['Type'] === 'Other') continue;"
  );
  assert.throws(()=>audit(turnover),/historical.*session|session.*opening/i);
  const mixed={...original};
  mixed['PartyLedger.gs']=mixed['PartyLedger.gs'].replace(
    "ledgerSheet: 'SUPPLIER_LEDGER'","ledgerSheet: 'CUSTOMER_LEDGER'"
  );
  assert.throws(()=>audit(mixed),/party ledger account isolation/i);
});

test('inventory is deterministic, fails closed for source removal and detects snapshot drift',()=>{
  const x=audit();
  assert.deepEqual(x,audit());
  assert.ok(x.limitations.includes('not D1'));
  assert.doesNotMatch(JSON.stringify(x),/01700000000|Rahim Enterprise/);
  assert.doesNotThrow(()=>assertM08Snapshot(x,structuredClone(x)));
  const changed=structuredClone(x);
  changed.surfaces[0].endpoints.pop();
  assert.throws(()=>assertM08Snapshot(x,changed),/drift/i);
  const absent=sources();
  delete absent['BankLedger.gs'];
  assert.throws(()=>audit(absent),/Missing M08 source/i);
});

test('CLI --check enforces committed snapshot and unsupported modes fail',()=>{
  const script=fileURLToPath(new URL('../scripts/audit-m08-finance.mjs',import.meta.url));
  const cwd=fileURLToPath(new URL('..',import.meta.url));
  const pass=spawnSync(process.execPath,[script,'--check'],{cwd,encoding:'utf8'});
  assert.equal(pass.status,0,pass.stderr);
  assert.match(pass.stdout,/M08 finance contracts verified/);
  const denied=spawnSync(process.execPath,[script,'--oops'],{cwd,encoding:'utf8'});
  assert.equal(denied.status,1);
});
