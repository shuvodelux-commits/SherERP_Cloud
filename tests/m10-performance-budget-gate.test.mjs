import test from 'node:test';
import assert from 'node:assert/strict';
import {assessM10PerformanceBudget} from '../src/migration/m10-performance-budget-gate.js';

const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const samples=()=>Array.from({length:100},()=>({
  latencyMs:80,cpuMs:10,d1Queries:2,d1RowsRead:30
}));
const evidence=()=>({
  policy:{
    formatVersion:1,reviewRef:'OWNER-REVIEW-001',reviewed:true,
    workloads:[
      {workloadId:'PRODUCT_SEARCH',latencyP95MaxMs:100,
        latencyP99MaxMs:120,cpuP95MaxMs:20,
        d1QueriesP95Max:5,d1RowsReadP95Max:40},
      {workloadId:'PARTY_LEDGER',latencyP95MaxMs:100,
        latencyP99MaxMs:120,cpuP95MaxMs:20,
        d1QueriesP95Max:5,d1RowsReadP95Max:40}
    ]
  },
  recording:{
    sourceCommit:SOURCE,environment:'LOCAL_SYNTHETIC',
    datasetRef:'SYNTHETIC-DATA-001',captureId:'PERF-CAPTURE-001',
    capturedAt:'2026-11-17T08:00:00.000Z',
    workloads:[
      {workloadId:'PRODUCT_SEARCH',samples:samples()},
      {workloadId:'PARTY_LEDGER',samples:samples()}
    ]
  }
});
const issue=(report,code)=>report.issues.find(x=>x.code===code)?.count||0;
const run=edit=>{const data=evidence();edit(data);return assessM10PerformanceBudget(data);};

test('100 synthetic samples per workload produce candidate-only budgets, no release authority',()=>{
  const result=assessM10PerformanceBudget(evidence());
  assert.deepEqual(result,{
    formatVersion:1,phase:'M10_OFFLINE_PERFORMANCE_PREFLIGHT',
    workloadsComparedComplete:true,budgetCandidate:true,
    authorizesImport:false,authorizesCutover:false,productionReady:false,
    issues:[],
    limitations:'Supplied targets and samples do not prove a sanctioned representative Workers/D1 benchmark, owner review or production authorization'
  });
});

test('missing policy or measurement never grants readiness',()=>{
  const empty=assessM10PerformanceBudget({});
  assert.equal(empty.workloadsComparedComplete,false);
  assert.equal(empty.budgetCandidate,false);
  assert.equal(issue(empty,'PERFORMANCE_POLICY_MISSING'),1);
  assert.equal(issue(empty,'PERFORMANCE_RECORDING_MISSING'),1);
});

test('unreviewed budgets cannot be inferred or treated as approved',()=>{
  const r=run(x=>{x.policy.reviewed=false;});
  assert.equal(issue(r,'PERFORMANCE_POLICY_UNREVIEWED'),1);
  assert.equal(r.budgetCandidate,false);
});

test('p95 latency uses nearest rank and catches 6 of 100 slow requests',()=>{
  const r=run(x=>x.recording.workloads[0].samples.slice(94).forEach(s=>s.latencyMs=101));
  assert.equal(issue(r,'PERFORMANCE_LATENCY_P95_BUDGET_EXCEEDED'),1);
  assert.equal(r.budgetCandidate,false);
});

test('p99 latency uses nearest rank and rejects 2 of 100 slow requests',()=>{
  const r=run(x=>x.recording.workloads[0].samples.slice(98).forEach(s=>s.latencyMs=121));
  assert.equal(issue(r,'PERFORMANCE_LATENCY_P99_BUDGET_EXCEEDED'),1);
  assert.equal(issue(r,'PERFORMANCE_LATENCY_P95_BUDGET_EXCEEDED'),0);
});

test('CPU, D1 query count and D1 rows-read p95 are separately budgeted',()=>{
  const r=run(x=>x.recording.workloads[1].samples.slice(94).forEach(s=>{
    s.cpuMs=21;s.d1Queries=6;s.d1RowsRead=41;
  }));
  assert.equal(issue(r,'PERFORMANCE_CPU_P95_BUDGET_EXCEEDED'),1);
  assert.equal(issue(r,'PERFORMANCE_D1_QUERIES_P95_BUDGET_EXCEEDED'),1);
  assert.equal(issue(r,'PERFORMANCE_D1_ROWS_READ_P95_BUDGET_EXCEEDED'),1);
});

test('missing, extra or duplicated workload evidence cannot count as complete',()=>{
  for(const [edit,code] of [
    [x=>x.recording.workloads.pop(),'PERFORMANCE_WORKLOAD_MISSING'],
    [x=>x.recording.workloads.push({workloadId:'UNKNOWN_CALL',samples:samples()}),
      'PERFORMANCE_WORKLOAD_UNEXPECTED'],
    [x=>x.recording.workloads.push({...x.recording.workloads[0]}),
      'PERFORMANCE_WORKLOAD_DUPLICATE'],
    [x=>x.policy.workloads.push({...x.policy.workloads[0]}),
      'PERFORMANCE_POLICY_WORKLOAD_DUPLICATE']
  ]){
    const r=run(edit);
    assert.equal(issue(r,code),1,code);
    assert.equal(r.workloadsComparedComplete,false,code);
    assert.equal(r.budgetCandidate,false,code);
  }
});

test('99 samples cannot support a p99 evaluation',()=>{
  const r=run(x=>x.recording.workloads[0].samples.pop());
  assert.equal(issue(r,'PERFORMANCE_SAMPLE_COUNT_INSUFFICIENT'),1);
  assert.equal(r.budgetCandidate,false);
  assert.equal(r.workloadsComparedComplete,false);
});

test('supported sanitized staging evidence is still only a supplied candidate',()=>{
  const r=run(x=>{x.recording.environment='SANCTIONED_PRIVATE_STAGING';});
  assert.equal(r.budgetCandidate,true);
  assert.equal(r.authorizesImport,false);
  assert.equal(r.authorizesCutover,false);
  assert.equal(r.productionReady,false);
});

test('invalid source pin, environment, unknown fields, and nonfinite or negative samples are redacted',()=>{
  for(const edit of [
    x=>{x.recording.sourceCommit='PRIVATE-CUSTOMER-SECRET';},
    x=>{x.recording.environment='PRODUCTION';},
    x=>{x.policy.workloads[0].latencyP95MaxMs=0;},
    x=>{x.recording.workloads[0].samples[0].latencyMs=Infinity;},
    x=>{x.recording.workloads[0].samples[0].cpuMs=NaN;},
    x=>{x.recording.workloads[0].samples[0].d1Queries=-1;},
    x=>{x.recording.workloads[0].samples[0].customerName='PRIVATE-CUSTOMER-SECRET';},
    x=>{x.recording.capturedAt='2026-02-31T08:00:00.000Z';}
  ]){
    const data=evidence();edit(data);
    assert.throws(()=>assessM10PerformanceBudget(data),
      err=>err.message==='M10 performance evidence invalid' &&
        !/PRIVATE|CUSTOMER|SECRET/.test(err.message));
  }
});

test('accessor-backed evidence never executes or propagates private exception text',()=>{
  const data=evidence();
  Object.defineProperty(data.recording.workloads[0].samples[0],'latencyMs',{
    enumerable:true,get(){throw new Error('PRIVATE-CUSTOMER-SECRET');}
  });
  assert.throws(()=>assessM10PerformanceBudget(data),
    {message:'M10 performance evidence invalid'});
});

test('identical output, stable sorted issues, immutable evidence and no private sample leaks',()=>{
  const data=evidence();
  data.recording.workloads[1].samples.slice(94).forEach(s=>{
    s.latencyMs=201;s.cpuMs=30;s.d1RowsRead=50;
  });
  const before=structuredClone(data);
  const a=assessM10PerformanceBudget(data);
  const b=assessM10PerformanceBudget(data);
  assert.deepEqual(a,b);
  assert.deepEqual(data,before);
  assert.deepEqual(a.issues.map(x=>x.code),a.issues.map(x=>x.code).sort());
  assert.doesNotMatch(JSON.stringify(a),
    /PRODUCT_SEARCH|PARTY_LEDGER|SYNTHETIC-DATA-001|PERF-CAPTURE-001|OWNER-REVIEW-001|latencyMs|cpuMs|customerName|amountMinor/);
});
