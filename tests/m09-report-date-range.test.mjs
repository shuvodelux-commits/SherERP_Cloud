import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const frozen=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
const sourceFunction=name=>{
  const start=frozen.indexOf('function '+name+'(');
  assert.ok(start>=0,'Pinned Reports.gs missing '+name);
  const end=frozen.indexOf('\n}',start);
  assert.ok(end>start,'Cannot extract '+name+' from pinned original');
  return frozen.slice(start,end+2);
};
const sourceRange=sourceFunction('reportRange_');
const sourceInRange=sourceFunction('inRange_');
const sourceOracle=(filters,today)=>{
  const fn=runInNewContext('('+sourceRange+')',{
    formatDate_:()=>today,
    sanitizeInput_:value=>value==null?'':String(value).trim()
  });
  return JSON.parse(JSON.stringify(fn(filters)));
};
const sourceIncludes=(date,range)=>{
  const fn=runInNewContext('('+sourceInRange+')');
  return fn(date,range);
};
const modulePath='../src/modules/report-date-range.js';
const impl=await import(modulePath).catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return null;
  throw e;
});
const range=(filters,today)=>{
  assert.equal(typeof impl?.normalizeReportRange,'function','M09 report range adapter not implemented');
  return impl.normalizeReportRange(filters,today);
};
const includes=(date,r)=>{
  assert.equal(typeof impl?.dateInReportRange,'function','M09 date matcher not implemented');
  return impl.dateInReportRange(date,r);
};
const today='2026-11-15';

test('source oracle: default this-month, explicit today, and omitted one-sided filters',()=>{
  for(const filters of [undefined,null,{}, {from:''},{to:''},
    {from:'2026-10-03'}, {to:'2026-11-30'}, {from:'2026-11-15',to:'2026-11-15'}]){
    assert.deepEqual(range(filters,today),sourceOracle(filters,today),JSON.stringify(filters));
  }
  assert.deepEqual(range({},today),{from:'2026-11-01',to:'2026-11-15'});
  assert.deepEqual(range({to:'2026-12-31'},today),{from:'2026-11-01',to:'2026-12-31'});
});

test('source oracle: reverse order must swap; whitespace is trimmed',()=>{
  for(const filters of [
    {from:'2026-12-31',to:'2026-01-01'},
    {from:' 2026-11-29 ',to:'2026-11-10 '},
    {from:'2027-01-05',to:'2026-11-01'}]){
    assert.deepEqual(range(filters,today),sourceOracle(filters,today));
  }
  assert.deepEqual(range({from:'2026-12-31',to:'2026-01-01'},today),
    {from:'2026-01-01',to:'2026-12-31'});
});

test('source oracle: date filter retains lexical regex, not Date.parse coercion',()=>{
  for(const filters of [
    {from:'not-a-date',to:'2026-11-03'},
    {from:'2026-11-02T12:00:00Z',to:'2026-11-20'},
    {from:'2026-13-99',to:'2026-13-99'},
    {from:'১১-১১-২০২৬',to:'2026-11-01'},
    {from:0,to:1}
  ]){
    assert.deepEqual(range(filters,today),sourceOracle(filters,today),JSON.stringify(filters));
  }
});

test('shop-local today is explicit; no implicit system clock or timezone',()=>{
  assert.deepEqual(range({},'2026-01-02'),{from:'2026-01-01',to:'2026-01-02'});
  assert.deepEqual(range({},'2028-02-29'),{from:'2028-02-01',to:'2028-02-29'});
  for(const value of [undefined,null,'','2026-2-3','2026-02-30','2026-11-15T00:00:00Z',new Date()])
    assert.throws(()=>range({},value),/trusted|today|date/i);
  assert.equal(typeof impl?.reportDefaultRange,'function');
  assert.deepEqual(impl.reportDefaultRange(today),{defaultFrom:'2026-11-01',defaultTo:today});
});

test('inclusive from/to date membership is identical to pinned source',()=>{
  const r=range({from:'2026-11-02',to:'2026-11-10'},today);
  for(const day of ['2026-11-01','2026-11-02','2026-11-03','2026-11-10','2026-11-11','']){
    assert.equal(includes(day,r),sourceIncludes(day,r),day);
  }
  assert.equal(includes('2026-11-02',r),true);
  assert.equal(includes('2026-11-10',r),true);
  assert.equal(includes('',r),false);
});

test('date matcher does not silently apply timezone, truncation, or timestamp comparisons',()=>{
  const r=range({},today);
  for(const date of ['2026-11-15T00:30:00Z','15/11/2026','2026-11-1',42,{},null])
    assert.throws(()=>includes(date,r),/date|canonical|normalized/i);
  for(const invalid of [null,{}, {from:'2026-11-01'}, {from:'2026-11-01',to:'not a date'}])
    assert.throws(()=>includes('2026-11-15',invalid),/range|canonical/i);
});

test('pure report normalization never edits input or relies on inherited/getter values',()=>{
  const filters=Object.freeze({from:' 2026-11-02 ',to:'2026-11-15'});
  const r=range(filters,today);
  assert.deepEqual(filters,{from:' 2026-11-02 ',to:'2026-11-15'});
  assert.deepEqual(r,{from:'2026-11-02',to:'2026-11-15'});
  const inherited=Object.create({from:'2026-11-02'});
  inherited.to='2026-11-15';
  assert.throws(()=>range(inherited,today),/filters|plain|trusted/i);
  const accessor={get from(){throw Error('getter unexpectedly called');},to:'2026-11-15'};
  assert.throws(()=>range(accessor,today),/filters|plain|trusted/i);
});

test('new module must not mutate frozen original GAS or expose live report RPC',()=>{
  const source=readFileSync(new URL('../legacy/source/Reports.gs',import.meta.url),'utf8');
  assert.match(source,/function reportRange_\(filters\)/);
  assert.match(source,/function inRange_\(dateStr, range\)/);
  assert.ok(typeof impl?.normalizeReportRange==='function');
});
