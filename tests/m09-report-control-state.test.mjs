import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../legacy/source/reports.html',import.meta.url),'utf8');
const api=await import('../src/modules/m09-report-control-state.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return null;
  throw error;
});

const check=(changes={})=>{
  assert.equal(typeof api?.inspectM09ReportControlState,'function',
    'M09 internal Reports print/freshness control not implemented');
  return api.inspectM09ReportControlState({
    activeTab:'rptSales',reportLoaded:true,requestPending:false,
    from:'2026-11-01',to:'2026-11-17',
    loadedFrom:'2026-11-01',loadedTo:'2026-11-17',
    ...changes
  });
};

test('all six original Reports tab IDs are classified without changing source',()=>{
  const period=['rptSales','rptPurchase','rptCashBank','rptProfit'];
  const snapshot=['rptStock','rptBalanceSheet'];
  for(const id of [...period,...snapshot]){
    assert.match(source,new RegExp('data-tab="'+id+'"'));
    const result=check({activeTab:id});
    assert.equal(result.activeTab,id);
    assert.equal(result.periodApplies,period.includes(id));
    assert.equal(result.printPreviewEligible,true);
    assert.equal(result.status,'VIEW_UP_TO_DATE');
  }
});

test('print must remain disabled before first successful active tab load',()=>{
  for(const id of ['rptSales','rptPurchase','rptStock','rptCashBank','rptProfit','rptBalanceSheet']){
    const result=check({activeTab:id,reportLoaded:false});
    assert.equal(result.printPreviewEligible,false);
    assert.equal(result.status,'REPORT_NOT_LOADED');
    assert.equal(result.needsRun,true);
  }
});

test('in-flight Reports RPC never enables printing on an old result',()=>{
  const result=check({requestPending:true});
  assert.deepEqual(
    {allowed:result.printPreviewEligible,status:result.status,needsRun:result.needsRun},
    {allowed:false,status:'REPORT_REQUEST_PENDING',needsRun:true}
  );
});

test('editing either date invalidates print eligibility until that window is loaded',()=>{
  for(const values of [
    {from:'2026-11-02'}, {to:'2026-11-16'}, {from:'2026-10-01',to:'2026-11-16'}
  ]){
    const result=check(values);
    assert.equal(result.printPreviewEligible,false);
    assert.equal(result.status,'REPORT_FILTERS_STALE');
    assert.equal(result.needsRun,true);
  }
});

test('invalid or reversed period filters fail closed with redacted status',()=>{
  const invalid=[
    {from:'',to:'2026-11-17'},
    {from:'2026-11-18',to:'2026-11-17'},
    {from:'2026-02-30',to:'2026-11-17'},
    {from:'2026-11-17',to:'not-a-date'},
    {from:'2026-1-7',to:'2026-11-17'},
  ];
  for(const values of invalid){
    const result=check(values);
    assert.equal(result.printPreviewEligible,false);
    assert.equal(result.status,'INVALID_REPORT_DATE_WINDOW');
    if(values.from)assert.equal(JSON.stringify(result).includes(values.from),false);
  }
  assert.equal(check({from:'2028-02-29',loadedFrom:'2028-02-29',
    to:'2028-02-29',loadedTo:'2028-02-29'}).printPreviewEligible,true);
});

test('snapshot Stock/Balance Sheet ignore period filters but still require their own loaded result',()=>{
  for(const id of ['rptStock','rptBalanceSheet']){
    assert.deepEqual({
      periodApplies:check({activeTab:id,from:'',to:''}).periodApplies,
      allowed:check({activeTab:id,from:'',to:''}).printPreviewEligible
    },{periodApplies:false,allowed:true});
    assert.equal(check({activeTab:id,reportLoaded:false}).printPreviewEligible,false);
  }
});

test('different report tab cannot reuse a previous tab loaded flag',()=>{
  for(const id of ['rptPurchase','rptStock','rptCashBank','rptProfit','rptBalanceSheet']){
    const state=check({activeTab:id,reportLoaded:false});
    assert.equal(state.printPreviewEligible,false,id);
  }
});

test('untrusted input rejects prototype and accessor leakage, without calling getters',()=>{
  let called=0;
  const accessor={activeTab:'rptSales',get from(){called++;throw Error('PRIVATE-DATA');}};
  assert.throws(()=>api?.inspectM09ReportControlState(accessor),/Invalid M09 report control input/);
  assert.equal(called,0);
  const inherited=Object.create({activeTab:'rptSales'});
  assert.throws(()=>api?.inspectM09ReportControlState(inherited),/Invalid M09 report control input/);
  assert.throws(()=>api?.inspectM09ReportControlState({activeTab:'rptSales',
    reportLoaded:'true'}),/Invalid M09 report control input/);
});

test('control projection is immutable, redacted and independent of live RPC authorization',()=>{
  const input=Object.freeze({activeTab:'rptSales',reportLoaded:true,requestPending:false,
    from:'2026-11-01',to:'2026-11-17',
    loadedFrom:'2026-11-01',loadedTo:'2026-11-17'});
  const out=api.inspectM09ReportControlState(input);
  assert.equal(out.printPreviewEligible,true);
  assert.equal(out.authorized,false);
  assert.equal(out.ready,false);
  assert.equal(Object.isFrozen(out),true);
  assert.deepEqual(input,Object.freeze({activeTab:'rptSales',reportLoaded:true,requestPending:false,
    from:'2026-11-01',to:'2026-11-17',
    loadedFrom:'2026-11-01',loadedTo:'2026-11-17'}));
  assert.equal(JSON.stringify(out).includes('2026'),false);
  assert.equal(JSON.stringify(out).includes('Invoice'),false);
  assert.match(source,/rptPrintBtn/);
});
