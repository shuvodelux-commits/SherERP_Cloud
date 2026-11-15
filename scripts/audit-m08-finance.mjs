#!/usr/bin/env node
/**
 * M08 source-only finance/cash/bank/ledger inventory.
 * Parses immutable legacy GAS; does not run it or touch Sheets/D1.
 */
import {parse,tokenizer} from 'acorn';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const SURFACES = Object.freeze([
  {sourceFile:'FinanceModule.gs',endpoints:{
    getFinanceBootstrap:'finance:view', addFinancePerson:'finance:add',
    updateFinancePerson:'finance:edit',setFinancePersonRoles:'finance:edit',
    setFinancePersonStatus:'finance:edit',addFinanceTransaction:'finance:add',
    getFinanceLedger:'finance:view'}},
  {sourceFile:'CashBook.gs',endpoints:{}},
  {sourceFile:'BankBook.gs',endpoints:{
    transferBetweenBankAccounts:'bank:add',getBankTransferHistory:'bank:view'}},
  {sourceFile:'BankAccounts.gs',endpoints:{
    getBankAccountsBootstrap:'bank:view',addBankAccount:'bank:add',
    updateBankAccount:'bank:edit',setBankAccountStatus:'bank:edit'}},
  {sourceFile:'BankLedger.gs',endpoints:{
    getBankLedgerBootstrap:'bank:view',getBankLedger:'bank:view',
    addBankManualEntry:'bank:add',reverseBankEntry:'bank:edit'}},
  {sourceFile:'CashSession.gs',endpoints:{
    startCashSession:'pos:add',getCashSessionSummary:'pos:view',
    closeCashSession:'pos:add'}},
  {sourceFile:'CashReconciliation.gs',endpoints:{
    getCashReconciliationCandidates:'cashReconciliation:view',
    saveCashReconciliationExplanation:'cashReconciliation:edit',
    getCashReconciliationRows:'cashReconciliation:view'}},
  {sourceFile:'OpeningBalance.gs',endpoints:{}},
  {sourceFile:'Customer.gs',endpoints:{
    getCustomersBootstrap:'customers:view',getCustomerDetail:'customers:view',
    receivePayment:'customers:edit',refundCustomerAdvance:'customers:edit'}},
  {sourceFile:'Suppliers.gs',endpoints:{
    getSuppliersBootstrap:'suppliers:view',getSupplierDetail:'suppliers:view',
    paySupplier:'suppliers:edit'}},
  {sourceFile:'Vendors.gs',endpoints:{
    getVendorsBootstrap:'vendors:view',getVendorDetail:'vendors:view',
    payVendor:'vendors:edit',receiveVendorPayment:'vendors:edit'}},
  {sourceFile:'PartyLedger.gs',endpoints:{
    getCustomerLedgerPage:null,getSupplierLedgerPage:null,
    getCustomerLedgerWorkspaceBootstrap:null,getSupplierLedgerWorkspaceBootstrap:null,
    getCustomerLedgerStatement:null,getSupplierLedgerStatement:null}}
]);
const INTERNAL = Object.freeze([
  ['CashBook.gs','addCashBookEntry_'],['CashBook.gs','getCashBalance_'],
  ['BankBook.gs','addBankBookEntry_'],['BankBook.gs','getBankBalance_'],
  ['OpeningBalance.gs','postHistoricalOpeningCash_'],
  ['OpeningBalance.gs','replaceHistoricalOpeningCash_'],
  ['OpeningBalance.gs','reverseHistoricalOpeningCash_'],
  ['FinanceModule.gs','postFinanceTransactionMoney_'],
  ['FinanceModule.gs','financeTypeHasMoneyMovement_'],
  ['FinanceModule.gs','financeSignedBalances_'],
  ['FinanceModule.gs','financeBalanceSummary_'],
  ['CashSession.gs','cashSessionSummaryFromRows_'],
  ['CashSession.gs','requireActiveCashSession_'],
  ['PartyLedger.gs','getPartyLedgerPage_'],
  ['PartyLedger.gs','getPartyLedgerWorkspaceBootstrap_'],
  ['PartyLedger.gs','getPartyLedgerStatement_']
]);
const READ = new Set(['getAllRows_','activeRows_','findRowIndex_']);
const WRITE = new Set(['appendRow_','appendRows_','updateRowFields_','markRowDeleted_']);
const METHODOLOGY = 'Parsed pinned GAS top-level functions. Direct call/permission/literal-group inventory only; not transitive, not D1 runtime, not SQL atomicity or source behavior parity proof.';

function walk(root,visit) {
  if(!root || typeof root!=='object')return;
  if(Array.isArray(root)){for(const n of root)walk(n,visit);return;}
  if(root.type==='CallExpression')visit(root);
  for(const [key,value] of Object.entries(root))
    if(key!=='start' && key!=='end' && value && typeof value==='object')
      walk(value,visit);
}
const literal = n => n?.type==='Literal' ? n.value : null;
const sorted = set => [...set].sort();

function inspect(fn,permission) {
  const calls=new Set(),permissions=new Set(),reads=new Set(),writes=new Set();
  const repeated=[];
  walk(fn.body,node=>{
    const name=node.callee?.type==='Identifier'?node.callee.name:null;
    if(!name)return;
    repeated.push(name);
    calls.add(name);
    if(name==='requirePermission_') {
      const mod=literal(node.arguments[1]),action=literal(node.arguments[2]);
      permissions.add(typeof mod==='string' && typeof action==='string' ?
        mod+':'+action : '<dynamic>');
    }
    if(READ.has(name)||WRITE.has(name)) {
      const group=literal(node.arguments[0]);
      const descriptor=name+':'+(typeof group==='string'?group:'<dynamic>');
      (READ.has(name)?reads:writes).add(descriptor);
    }
  });
  const result={directCalls:sorted(calls),permissions:sorted(permissions),
    directReads:sorted(reads),directWrites:sorted(writes)};
  if(permission!==undefined && permission!==null &&
      (result.permissions.length!==1 || result.permissions[0]!==permission))
    throw new Error('M08 permission mismatch for '+fn.id.name);
  return {result,repeated};
}

function tokens(text) {
  const it=tokenizer(text,{ecmaVersion:'latest',sourceType:'script'});
  const result=[];
  while(true) {
    const tok=it.getToken();
    if(tok.type.label==='eof')break;
    result.push(tok.value===undefined ? tok.type.label : String(tok.value));
  }
  return result;
}
function containsTokens(source,fragment) {
  const src=tokens(source).join('\u0000'),expected=tokens(fragment).join('\u0000');
  return ('\u0000'+src+'\u0000').includes('\u0000'+expected+'\u0000');
}
function requireFragment(files,file,name,fragment,error) {
  const def=files.get(file)?.defs.get(name);
  if(!def || !containsTokens(def.text,fragment))
    throw new Error('M08 '+error+' contract drift in '+file+':'+name);
}
function inspectModule(name,source) {
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'});
  const defs=new Map();
  for(const node of ast.body) {
    if(node.type!=='FunctionDeclaration')continue;
    const n=node.id?.name;
    if(!n || defs.has(n))throw new Error('M08 duplicate or unnamed GAS function '+n);
    defs.set(n,{...node,text:source.slice(node.start,node.end)});
  }
  return {ast,defs};
}
function getFinanceTypes(ast) {
  let expression=null;
  for(const node of ast.body)if(node.type==='VariableDeclaration')
    for(const item of node.declarations)
      if(item.id?.name==='FINANCE_TRANSACTION_TYPES') {
        if(expression)throw new Error('Duplicate M08 finance transaction types');
        expression=item.init;
      }
  if(expression?.type!=='ArrayExpression')
    throw new Error('Missing M08 finance transaction types');
  return expression.elements.map(node=>{
    if(node?.type!=='ObjectExpression')throw new Error('Invalid M08 finance type record');
    const record={};
    for(const p of node.properties) {
      const key=p.key?.name??literal(p.key);
      const value=p.value?.type==='UnaryExpression' && p.value.operator==='-' &&
        typeof literal(p.value.argument)==='number'
        ? -literal(p.value.argument) : literal(p.value);
      if(p.type!=='Property' || typeof key!=='string' ||
          !['key','label','account','balanceEffect','cashDirection','role','isOpening'].includes(key) ||
          value===null || Object.hasOwn(record,key))
        throw new Error('Invalid M08 finance type field');
      record[key]=value;
    }
    for(const key of ['key','label','account','balanceEffect','cashDirection','role','isOpening'])
      if(!Object.hasOwn(record,key))throw new Error('Missing M08 finance type field');
    return record;
  });
}
function getLedgerKinds(ast) {
  const config=ast.body.filter(n=>n.type==='VariableDeclaration')
    .flatMap(n=>n.declarations).find(n=>n.id?.name==='PARTY_LEDGER_CONFIG_')?.init;
  if(config?.type!=='ObjectExpression')throw new Error('Missing M08 Party ledger role config');
  const result={};
  for(const entry of config.properties) {
    const kind=entry.key?.name??literal(entry.key);
    if(!['customer','supplier'].includes(kind) ||
        entry.value?.type!=='ObjectExpression' || Object.hasOwn(result,kind))
      throw new Error('Invalid M08 Party ledger kind');
    result[kind]=Object.fromEntries(entry.value.properties.map(p=>{
      const field=p.key?.name??literal(p.key);
      const value=literal(p.value);
      if(typeof field!=='string' || typeof value!=='string')
        throw new Error('Invalid M08 Party ledger mapping');
      return [field,value];
    }));
  }
  if(Object.keys(result).length!==2)throw new Error('Missing M08 Party ledger kind');
  return result;
}
function assertSafety(files,types,kinds) {
  const expected={
    customer:{permission:'customers',masterSheet:'CUSTOMERS',
      ledgerSheet:'CUSTOMER_LEDGER',partyIdColumn:'Customer ID',sourceSheet:'SALES'},
    supplier:{permission:'suppliers',masterSheet:'SUPPLIERS',
      ledgerSheet:'SUPPLIER_LEDGER',partyIdColumn:'Supplier ID',sourceSheet:'PURCHASES'}
  };
  for(const [kind,fields] of Object.entries(expected))
    for(const [field,value] of Object.entries(fields))
      if(kinds[kind]?.[field]!==value)
        throw new Error('M08 Party ledger account isolation drift: '+kind+':'+field);
  for(const name of ['getPartyLedgerPage_','getPartyLedgerWorkspaceBootstrap_',
    'getPartyLedgerStatement_']) {
    const fn=files.get('PartyLedger.gs').defs.get(name);
    const permissions=fn && inspect(fn).result.permissions;
    if(!permissions || permissions.length!==1 || permissions[0]!=='<dynamic>')
      throw new Error('M08 Party ledger permission guard drift: '+name);
  }
  if(types.length!==9 || types.filter(t=>t.isOpening).length!==3 ||
      types.some(t=> t.isOpening ? t.cashDirection!=='none' :
        !['in','out'].includes(t.cashDirection)))
    throw new Error('M08 finance transaction opening money movement drift');

  requireFragment(files,'CashBook.gs','addCashBookEntry_',
    'lastBalance + credit - debit','cash balance sign');
  requireFragment(files,'CashBook.gs','getCashBalance_',
    "balance + (Number(row['Credit']) || 0) - (Number(row['Debit']) || 0)",
    'cash balance direction');
  requireFragment(files,'BankBook.gs','addBankBookEntry_',
    'lastBalance + credit - debit','bank balance direction');

  const transfer=files.get('BankBook.gs').defs.get('transferBetweenBankAccounts');
  const calls=inspect(transfer).repeated;
  if(calls.filter(name=>name==='addBankBookEntry_').length!==2)
    throw new Error('M08 transfer leg count drift');
  requireFragment(files,'BankBook.gs','transferBetweenBankAccounts',
    "Type: 'Transfer Out', Reference: id",'transfer leg reference');
  requireFragment(files,'BankBook.gs','transferBetweenBankAccounts',
    "Debit: amount, Credit: ''",'transfer bank direction');
  requireFragment(files,'BankBook.gs','transferBetweenBankAccounts',
    "Type: 'Transfer In', Reference: id",'transfer leg reference');
  requireFragment(files,'BankBook.gs','transferBetweenBankAccounts',
    "Debit: '', Credit: amount",'transfer bank direction');

  requireFragment(files,'CashSession.gs','cashSessionSummaryFromRows_',
    "if (cashRows[i]['Type'] === 'Historical Opening') continue;",
    'historical session opening exclusion');
  requireFragment(files,'CashSession.gs','cashSessionSummaryFromRows_',
    'openingCash + cashIn - cashOut','session cash arithmetic');
  requireFragment(files,'CashSession.gs','startCashSession',
    'hasPreviousClosedSession || hasHistoricalOpening ? 0 :',
    'historical session baseline');
  if(inspect(files.get('CashSession.gs').defs.get('closeCashSession')).repeated.some(name=>
    ['addCashBookEntry_','addBankBookEntry_'].includes(name)))
    throw new Error('M08 close session synthesizes money');
  requireFragment(files,'FinanceModule.gs','addFinanceTransaction',
    'if (financeTypeHasMoneyMovement_(type)) requireActiveCashSession_();',
    'finance cash-session gate');
  requireFragment(files,'FinanceModule.gs','postFinanceTransactionMoney_',
    'if (type && type.isOpening) { postHistoricalOpeningCash_(',
    'finance historical opening route');
  for(const kind of ['customer','supplier']) {
    const prefix=kind==='customer'?'Customer':'Supplier';
    requireFragment(files,'PartyLedger.gs','get'+prefix+'LedgerPage',
      "getPartyLedgerPage_('"+kind+"',",'Party ledger role isolation');
    requireFragment(files,'PartyLedger.gs','get'+prefix+'LedgerStatement',
      "getPartyLedgerStatement_('"+kind+"',",'Party ledger role isolation');
  }
  const historical=inspect(files.get('OpeningBalance.gs').defs.get('postHistoricalOpeningCash_'));
  if(historical.repeated.includes('requireActiveCashSession_'))
    throw new Error('M08 historical opening requires a current session');
  requireFragment(files,'OpeningBalance.gs','historicalOpeningCashReference_',
    "'OPEN:' + entityType + ':' + String(sourceId)",'historical reference');
}

export function auditM08FinanceContracts({sources,sourceCommit}={}) {
  if(!sources || typeof sources!=='object' || Array.isArray(sources) ||
      !/^[a-f0-9]{40}$/.test(sourceCommit||''))
    throw new Error('Invalid M08 source map or immutable SHA');
  const parsed=new Map();
  for(const {sourceFile} of SURFACES) {
    if(typeof sources[sourceFile]!=='string')
      throw new Error('Missing M08 source file '+sourceFile);
    parsed.set(sourceFile,inspectModule(sourceFile,sources[sourceFile]));
  }
  const types=getFinanceTypes(parsed.get('FinanceModule.gs').ast);
  const kinds=getLedgerKinds(parsed.get('PartyLedger.gs').ast);
  assertSafety(parsed,types,kinds);
  const surfaces=SURFACES.map(({sourceFile,endpoints})=>{
    const defs=parsed.get(sourceFile).defs;
    return {sourceFile,endpoints:Object.entries(endpoints).map(([name,permission])=>{
      const fn=defs.get(name);
      if(!fn)throw new Error('Missing M08 endpoint '+name);
      const {result}=inspect(fn,permission);
      return {name,...result};
    })};
  });
  const internal=INTERNAL.map(([sourceFile,name])=>{
    const fn=parsed.get(sourceFile).defs.get(name);
    if(!fn)throw new Error('Missing M08 internal function '+name);
    return {name,sourceFile,...inspect(fn).result};
  });
  return {formatVersion:1,sourceCommit,limitations:METHODOLOGY,
    financeTypes:types,ledgerKinds:kinds,surfaces,internal};
}

export function assertM08Snapshot(current,snapshot) {
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw new Error('M08 finance contract snapshot drift; review pinned source');
  return true;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  (async()=>{
    const mode=process.argv[2];
    if(!['--check','--write'].includes(mode)||process.argv.length!==3)
      throw new Error('Usage: node scripts/audit-m08-finance.mjs --check|--write');
    const root=new URL('../',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
    const sources=Object.fromEntries(await Promise.all(SURFACES.map(async({sourceFile})=>[
      sourceFile,await readFile(new URL('legacy/source/'+sourceFile,root),'utf8')
    ])));
    const inventory=auditM08FinanceContracts({sources,sourceCommit:manifest.source.commit});
    const path=new URL('docs/baseline/m08-finance-contract-inventory.json',root);
    if(mode==='--write') {
      await writeFile(path,JSON.stringify(inventory,null,2)+'\n','utf8');
      process.stdout.write('M08 finance source-only contract inventory written\n');
    } else {
      assertM08Snapshot(inventory,JSON.parse(await readFile(path,'utf8')));
      process.stdout.write('M08 finance contracts verified (source-only)\n');
    }
  })().catch(err=>{
    console.error('M08 finance inventory rejected: '+err.message);
    process.exitCode=1;
  });
}
