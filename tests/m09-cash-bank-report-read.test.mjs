import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const reports=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const html=readFileSync(new URL('../legacy/source/reports.html',import.meta.url),'utf8');
function sourceFn(source,name){
  const start=source.indexOf('function '+name+'(');
  assert.ok(start>=0,'Frozen source helper missing: '+name);
  const end=source.indexOf('\n}',start);
  assert.ok(end>start,'Cannot extract frozen '+name);
  return source.slice(start,end+2);
}
const code=[
  sourceFn(utils,'roundMoney_'),
  ...['reportRange_','inRange_','tsDateOnly_','sortedByDesc_','getCashBankReport']
    .map(name=>sourceFn(reports,name))
].join('\n');
const clone=x=>JSON.parse(JSON.stringify(x));
const blank=()=>({cashRows:[],bankRows:[],bankAccounts:[]});
function fixture(){
  return {
    cashRows:[
      {'Entry ID':'C-01','Date':'2026-10-31T23:30:00','Credit':100,'Debit':0,'Type':'Historical Opening'},
      {'Entry ID':'C-02','Date':'2026-11-01T09:00:00','Credit':10,'Debit':0,'Type':'Other'},
      {'Entry ID':'C-04','Date':'2026-11-14T12:00:00','Credit':25,'Debit':0,'Type':'Sale'},
      {'Entry ID':'C-03','Date':'2026-11-14T08:30:00','Credit':0,'Debit':7,'Type':'Supplier Payment'},
      {'Entry ID':'C-05','Date':'2026-11-15T10:20:00','Credit':5,'Debit':0,'Type':'Sale'},
      {'Entry ID':'C-06','Date':'2026-11-16T09:00:00','Credit':0,'Debit':8,'Type':'Expense'}
    ],
    bankAccounts:[
      {'Bank Account ID':'BA','Account Name':'Current','Bank Name':'Bank One',
        'Status':'Active','Opening Balance':100,'Current Balance':154},
      {'Bank Account ID':'BB','Account Name':'Savings','Bank Name':'Bank Two',
        'Status':'Active','Opening Balance':500,'Current Balance':320},
      {'Bank Account ID':'BC','Account Name':'Old','Bank Name':'Other',
        'Status':'Inactive','Opening Balance':1000,'Current Balance':1000}
    ],
    bankRows:[
      {'Entry ID':'BA-PRE','Bank Account ID':'BA','Date':'2026-11-13T08:00:00','Credit':10},
      {'Entry ID':'BA-IN','Bank Account ID':'BA','Date':'2026-11-14T09:00:00','Credit':50},
      {'Entry ID':'BA-OUT','Bank Account ID':'BA','Date':'2026-11-15T11:00:00','Debit':6},
      {'Entry ID':'BA-FUTURE','Bank Account ID':'BA','Date':'2026-11-16T11:00:00','Debit':20},
      {'Entry ID':'BB-OPEN','Bank Account ID':'BB','Date':'2026-11-01T10:00:00',
        'Type':'Opening Balance','Credit':300},
      {'Entry ID':'BB-IN','Bank Account ID':'BB','Date':'2026-11-14T09:00:00','Credit':20},
      {'Entry ID':'BB-REV','Bank Account ID':'BB','Date':'2026-11-14T09:01:00',
        'Credit':40,'Status':'Reversed'},
      {'Entry ID':'BB-UNDO','Bank Account ID':'BB','Date':'2026-11-15T07:00:00',
        'Debit':40,'Status':'Active','Reversal Of':'BB-REV'},
      {'Entry ID':'BB-VOID','Bank Account ID':'BB','Date':'2026-11-15T12:00:00',
        'Credit':9,'Status':'Reversed'},
      {'Entry ID':'BC-IGNORED','Bank Account ID':'BC','Date':'2026-11-15T10:00:00',
        'Credit':5000}
    ]
  };
}
function oracle(snapshot,filters,today='2026-11-15'){
  const ctx={
    nativeFilters:filters,
    requirePermission_:(token,module,action)=>{
      assert.equal(token,'authorized-source-test');
      assert.equal(module,'reports');assert.equal(action,'view');
    },
    formatDate_:()=>today,
    sanitizeInput_:value=>value==null?'':String(value).trim(),
    activeRows_:table=>{
      assert.equal(table,'CASH_BOOK');return snapshot.cashRows;
    },
    getAllRows_:table=>{
      if(table==='BANK_BOOK')return snapshot.bankRows;
      if(table==='BANK_ACCOUNTS')return snapshot.bankAccounts;
      throw Error('Unexpected source table: '+table);
    },
    ok_:value=>value,
    fail_:message=>{throw Error('Frozen GAS rejected: '+message);},
    logError_:()=>{}
  };
  return clone(runInNewContext(code+'\ngetCashBankReport("authorized-source-test",nativeFilters)',ctx));
}
const impl=await import('../src/modules/cash-bank-report-read.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
function project(snapshot,filters,today){
  assert.equal(typeof impl?.projectCashBankReport,'function',
    'M09 Cash & Bank Report read projection not implemented');
  return impl.projectCashBankReport(snapshot,filters,arguments.length<3?'2026-11-15':today);
}
function parity(snapshot,filters={from:'2026-11-14',to:'2026-11-15'},today='2026-11-15'){
  const expected=oracle(snapshot,filters,today);
  const actual=clone(project(snapshot,filters,today));
  assert.deepEqual(actual,expected);
  assert.deepEqual(Object.keys(actual),Object.keys(expected));
  return actual;
}

test('full native getCashBankReport response: cash, bank, combined money and order',()=>{
  const actual=parity(fixture());
  assert.deepEqual(actual.range,{from:'2026-11-14',to:'2026-11-15'});
  assert.deepEqual(actual.cash,{
    opening:110,inflow:30,outflow:7,closing:133,entries:3,
    byType:[
      {label:'Sale',entries:2,inflow:30,outflow:0,net:30},
      {label:'Supplier Payment',entries:1,inflow:0,outflow:7,net:-7}
    ]
  });
  assert.deepEqual(actual.banks,[
    {id:'BA',name:'Current',bankName:'Bank One',opening:110,
      inflow:50,outflow:6,closing:154,entries:2,currentBalance:154},
    {id:'BB',name:'Savings',bankName:'Bank Two',opening:300,
      inflow:60,outflow:40,closing:320,entries:3,currentBalance:320}
  ]);
  assert.deepEqual(actual.bankTotals,{opening:410,inflow:110,outflow:46,closing:474});
  assert.deepEqual(actual.combined,{opening:520,closing:607});
});

test('native inclusive date windows and default current month; post-period entries excluded',()=>{
  const s=fixture();
  const r=parity(s,{from:'2026-11-15',to:'2026-11-14'});
  assert.deepEqual(r.range,{from:'2026-11-14',to:'2026-11-15'});
  const one=parity(s,{from:'2026-11-15',to:'2026-11-15'});
  assert.equal(one.cash.entries,1);
  assert.equal(one.banks[0].entries,1);
  assert.deepEqual(parity(s,{}).range,{from:'2026-11-01',to:'2026-11-15'});
  assert.deepEqual(parity(s,{},'2026-10-04').range,{from:'2026-10-01',to:'2026-10-04'});
  assert.equal(parity(s,{from:'2026-12-01',to:'2026-12-10'}).cash.entries,0);
});

test('Reversed bank original retained only when targeted; mirrored reverse nets against it',()=>{
  const s=fixture();
  let r=parity(s);
  assert.equal(r.banks[1].entries,3);
  assert.equal(r.banks[1].inflow,60);
  assert.equal(r.banks[1].outflow,40);
  delete s.bankRows[7]['Reversal Of'];
  r=parity(s);
  assert.equal(r.banks[1].entries,2);
  assert.equal(r.banks[1].inflow,20);
  assert.equal(r.banks[1].outflow,40);
  // Even a reversal reference from a different account targets allBankRows globally,
  // exactly as original Reports.gs, not per-account bank reader behavior.
  s.bankRows.push({'Entry ID':'CROSS-REF','Bank Account ID':'BC',
    'Date':'2026-11-15T00:00:00','Reversal Of':'BB-REV','Status':'Active'});
  assert.equal(parity(s).banks[1].inflow,60);
});

test('bank Opening Balance book row replaces stored opening even if outside selected date range',()=>{
  const s=fixture();
  assert.equal(parity(s).banks[1].opening,300);
  s.bankRows=s.bankRows.filter(row=>row['Entry ID']!=='BB-OPEN');
  assert.equal(parity(s).banks[1].opening,500);
  s.bankRows.push({'Entry ID':'BB-OPEN-LATE','Bank Account ID':'BB',
    'Date':'2026-12-10T00:00:00','Type':'Opening Balance','Credit':1000});
  // Original detects the row anywhere, making opening start at zero even if later.
  assert.equal(parity(s).banks[1].opening,0);
});

test('cash and bank opening roll forward from strictly earlier book dates, not stored balances',()=>{
  const s=fixture();
  let r=parity(s);
  assert.equal(r.cash.opening,110);
  assert.equal(r.banks[0].opening,110);
  s.cashRows[0].Debit=120;
  s.bankAccounts[0]['Current Balance']=-999;
  r=parity(s);
  assert.equal(r.cash.opening,-10);
  assert.equal(r.banks[0].opening,110);
  assert.equal(r.banks[0].currentBalance,-999);
  assert.equal(r.banks[0].closing,154);
});

test('money rounding after each source movement, timestamp-date extraction and stable sorting',()=>{
  const s=blank();
  s.cashRows=[
    {'Entry ID':'Z','Date':'2026-11-15T18:31:00+06:00','Credit':0.105,'Type':'Sale'},
    {'Entry ID':'A','Date':'2026-11-15T09:00:00+06:00','Credit':0.105,'Type':'Sale'},
    {'Entry ID':'B','Date':'2026-11-14T22:00:00','Credit':0.005,'Type':'Donation'},
    {'Entry ID':'P','Date':'2026-11-13T22:00:00','Credit':0.105,'Type':'History'}
  ];
  s.bankAccounts=[{'Bank Account ID':'Z','Opening Balance':0.105,
    'Current Balance':0.205,'Status':'Active'}];
  s.bankRows=[
    {'Entry ID':'Z','Bank Account ID':'Z','Date':'2026-11-15T22:00:00','Credit':0.105},
    {'Entry ID':'A','Bank Account ID':'Z','Date':'2026-11-15T08:00:00','Credit':0.105}
  ];
  const r=parity(s);
  assert.equal(r.cash.entries,3);
  assert.equal(r.banks[0].entries,2);
  assert.equal(r.cash.byType[0].label,'Sale');
});

test('cash by type sort by inflow, blank type is Other; inactive banks and orphan books excluded',()=>{
  const s=fixture();
  s.cashRows.push({'Entry ID':'X','Date':'2026-11-15','Credit':40,'Type':''});
  s.cashRows.push({'Entry ID':'Y','Date':'2026-11-15','Debit':2,'Type':'Sale'});
  s.bankRows.push({'Entry ID':'ORPHAN','Bank Account ID':'MISSING',
    'Date':'2026-11-15','Credit':9999});
  const r=parity(s);
  assert.equal(r.cash.byType[0].label,'Other');
  assert.equal(r.cash.byType[0].inflow,40);
  assert.equal(r.banks.length,2);
  assert.equal(r.banks[0].id,'BA');
  assert.equal(r.bankTotals.closing,474);
});

test('empty source books and dormant accounts match original response exactly',()=>{
  assert.deepEqual(parity(blank()),{
    range:{from:'2026-11-14',to:'2026-11-15'},
    cash:{opening:0,inflow:0,outflow:0,closing:0,entries:0,byType:[]},
    banks:[],bankTotals:{opening:0,inflow:0,outflow:0,closing:0},
    combined:{opening:0,closing:0}
  });
  const s=blank();
  s.bankAccounts=[{'Bank Account ID':'D','Account Name':'Dormant',
    'Opening Balance':-30,'Current Balance':-1,'Status':'Active'}];
  const r=parity(s);
  assert.equal(r.banks[0].opening,-30);
  assert.equal(r.banks[0].closing,-30);
  assert.equal(r.banks[0].currentBalance,-1);
});

test('trusted snapshot validation rejects getter/Promise/nonfinite money/dates and duplicate bank IDs',()=>{
  const s=fixture();
  for(const bad of [
    null,undefined,{},[],{...s,cashRows:Promise.resolve([])},
    {...s,bankRows:[null]},{...s,bankAccounts:undefined},
    {...s,cashRows:[{'Entry ID':'X','Date':'2026-02-30','Credit':10}]},
    {...s,bankRows:[{'Entry ID':'X','Bank Account ID':'BA',
      'Date':'2026-11-15T00:00:00','Debit':Infinity}]},
    {...s,cashRows:[{'Entry ID':'X','Date':'2026-11-15','Credit':Promise.resolve(10)}]}
  ])assert.throws(()=>project(bad,{}),/snapshot|trusted|array|row|date|finite|amount|number|invalid/i);
  const g={...s,get cashRows(){throw Error('getter invoked');}};
  assert.throws(()=>project(g,{}),/accessor|trusted|snapshot/i);
  const g2={...s,bankRows:[{
    get Date(){throw Error('getter invoked');},'Entry ID':'X','Bank Account ID':'BA'
  }]};
  assert.throws(()=>project(g2,{}),/accessor|trusted|row/i);
  const dup=fixture();
  dup.bankAccounts.push({...dup.bankAccounts[0]});
  assert.throws(()=>project(dup,{}),/duplicate bank account id/i);
  for(const today of [undefined,'2026-02-30','2026-11-15T10:00:00Z'])
    assert.throws(()=>project(fixture(),{},today),/trusted|today|date/i);
});

test('the original report UI and native RPC contract remain unchanged; projection is pure',()=>{
  const s=fixture(),before=clone(s);
  parity(s);
  assert.deepEqual(s,before);
  assert.match(html,/id="rcOpening"/);
  assert.match(html,/id="rcBankBody"/);
  assert.match(reports,/function getCashBankReport\(token, filters\)/);
  const module=readFileSync(new URL('../src/modules/cash-bank-report-read.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/\b(?:fetch|prepare|batch|exec)\s*\(/);
  assert.doesNotMatch(module,/function\s+getCashBankReport\s*\(/);
});
