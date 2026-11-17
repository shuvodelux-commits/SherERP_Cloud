/**
 * M10-13: offline, candidate-only performance and D1 query-budget evaluation.
 * No metrics are collected here; never read source Sheets, Workers, D1,
 * customer data, secrets or production bindings. All limits are supplied,
 * externally reviewed evidence, NOT hardcoded deployment policy.
 */
const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const BAD='M10 performance evidence invalid';
const LIMITATIONS='Supplied targets and samples do not prove a sanctioned representative Workers/D1 benchmark, owner review or production authorization';
const TOKEN=/^[A-Za-z0-9_-]{8,64}$/;
const WORKLOAD=/^[A-Z][A-Z0-9_]{1,63}$/;
const UTC=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const POLICY_FIELDS=['formatVersion','reviewRef','reviewed','workloads'];
const BUDGET_FIELDS=[
  'workloadId','latencyP95MaxMs','latencyP99MaxMs','cpuP95MaxMs',
  'd1QueriesP95Max','d1RowsReadP95Max'
];
const RECORDING_FIELDS=[
  'sourceCommit','environment','datasetRef','captureId','capturedAt','workloads'
];
const WORKLOAD_FIELDS=['workloadId','samples'];
const SAMPLE_FIELDS=['latencyMs','cpuMs','d1Queries','d1RowsRead'];
const fail=()=>{throw new Error(BAD);};
const validToken=value=>typeof value==='string'&&TOKEN.test(value);
const validTime=value=>typeof value==='string'&&UTC.test(value)&&
  !Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value;
const nonnegative=value=>typeof value==='number'&&
  Number.isFinite(value)&&value>=0&&Number.isSafeInteger(value);
const validMs=value=>typeof value==='number'&&
  Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER;
const positiveMs=value=>validMs(value)&&value>0;
const workloadId=value=>typeof value==='string'&&WORKLOAD.test(value);

/** Validate own data properties before touching their values or names. */
function exact(value,fields){
  if(value===null||typeof value!=='object'||Array.isArray(value)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
  const names=Reflect.ownKeys(value);
  if(names.length!==fields.length||
    names.some(name=>typeof name!=='string'||!fields.includes(name)))fail();
  for(const name of fields){
    const descriptor=Object.getOwnPropertyDescriptor(value,name);
    if(descriptor?.enumerable!==true||!Object.hasOwn(descriptor,'value'))fail();
  }
  return value;
}

function parseInput(input){
  if(input===undefined)return {};
  if(input===null||typeof input!=='object'||Array.isArray(input)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail();
  for(const name of Reflect.ownKeys(input)){
    if(typeof name!=='string'||!['policy','recording'].includes(name))fail();
    const descriptor=Object.getOwnPropertyDescriptor(input,name);
    if(descriptor?.enumerable!==true||!Object.hasOwn(descriptor,'value'))fail();
  }
  return input;
}

function parsePolicy(policy,add){
  if(policy===undefined){
    add('PERFORMANCE_POLICY_MISSING');
    return null;
  }
  exact(policy,POLICY_FIELDS);
  if(policy.formatVersion!==1||!validToken(policy.reviewRef)||
    typeof policy.reviewed!=='boolean'||!Array.isArray(policy.workloads)||
    policy.workloads.length<1||policy.workloads.length>32)fail();
  if(!policy.reviewed)add('PERFORMANCE_POLICY_UNREVIEWED');
  const groups=new Map();
  for(const budget of policy.workloads){
    exact(budget,BUDGET_FIELDS);
    if(!workloadId(budget.workloadId)||
      !positiveMs(budget.latencyP95MaxMs)||
      !positiveMs(budget.latencyP99MaxMs)||
      !positiveMs(budget.cpuP95MaxMs)||
      !nonnegative(budget.d1QueriesP95Max)||
      !nonnegative(budget.d1RowsReadP95Max)||
      budget.latencyP95MaxMs>budget.latencyP99MaxMs)fail();
    if(groups.has(budget.workloadId)){
      add('PERFORMANCE_POLICY_WORKLOAD_DUPLICATE');
      continue;
    }
    groups.set(budget.workloadId,budget);
  }
  return groups;
}

function parseRecording(recording,add){
  if(recording===undefined){
    add('PERFORMANCE_RECORDING_MISSING');
    return null;
  }
  exact(recording,RECORDING_FIELDS);
  if(recording.sourceCommit!==SOURCE||
    !['LOCAL_SYNTHETIC','SANCTIONED_PRIVATE_STAGING'].includes(recording.environment)||
    !validToken(recording.datasetRef)||!validToken(recording.captureId)||
    !validTime(recording.capturedAt)||!Array.isArray(recording.workloads)||
    recording.workloads.length>64)fail();
  const groups=new Map();
  for(const row of recording.workloads){
    exact(row,WORKLOAD_FIELDS);
    if(!workloadId(row.workloadId)||!Array.isArray(row.samples)||
      row.samples.length>5000)fail();
    for(const sample of row.samples){
      exact(sample,SAMPLE_FIELDS);
      if(!validMs(sample.latencyMs)||!validMs(sample.cpuMs)||
        !nonnegative(sample.d1Queries)||!nonnegative(sample.d1RowsRead))fail();
    }
    if(groups.has(row.workloadId)){
      add('PERFORMANCE_WORKLOAD_DUPLICATE');
      continue;
    }
    groups.set(row.workloadId,row.samples);
  }
  return groups;
}

/** Nearest-rank p95/p99; sort a copy to preserve caller-owned evidence. */
const percentile=(samples,key,percent)=>{
  const numbers=samples.map(row=>row[key]).sort((a,b)=>a-b);
  return numbers[Math.ceil(numbers.length*percent/100)-1];
};

/** Report supplied data only; even all-green synthetic comparisons are NO-GO. */
export function assessM10PerformanceBudget(input={}){
  try{
    const values=parseInput(input);
    const issues=new Map();
    const add=(code,n=1)=>issues.set(code,(issues.get(code)||0)+n);
    const policies=parsePolicy(values.policy,add);
    const recordings=parseRecording(values.recording,add);
    let comparedComplete=false;
    if(policies&&recordings){
      let covered=true;
      for(const [id,budget] of policies){
        if(!recordings.has(id)){
          add('PERFORMANCE_WORKLOAD_MISSING');
          covered=false;
          continue;
        }
        const samples=recordings.get(id);
        if(samples.length<100){
          add('PERFORMANCE_SAMPLE_COUNT_INSUFFICIENT');
          covered=false;
          continue;
        }
        if(percentile(samples,'latencyMs',95)>budget.latencyP95MaxMs)
          add('PERFORMANCE_LATENCY_P95_BUDGET_EXCEEDED');
        if(percentile(samples,'latencyMs',99)>budget.latencyP99MaxMs)
          add('PERFORMANCE_LATENCY_P99_BUDGET_EXCEEDED');
        if(percentile(samples,'cpuMs',95)>budget.cpuP95MaxMs)
          add('PERFORMANCE_CPU_P95_BUDGET_EXCEEDED');
        if(percentile(samples,'d1Queries',95)>budget.d1QueriesP95Max)
          add('PERFORMANCE_D1_QUERIES_P95_BUDGET_EXCEEDED');
        if(percentile(samples,'d1RowsRead',95)>budget.d1RowsReadP95Max)
          add('PERFORMANCE_D1_ROWS_READ_P95_BUDGET_EXCEEDED');
      }
      for(const key of recordings.keys()){
        if(!policies.has(key)){
          add('PERFORMANCE_WORKLOAD_UNEXPECTED');
          covered=false;
        }
      }
      comparedComplete=covered&&policies.size===recordings.size&&
        !['PERFORMANCE_WORKLOAD_DUPLICATE',
          'PERFORMANCE_POLICY_WORKLOAD_DUPLICATE'].some(key=>issues.has(key));
    }
    const sorted=[...issues].sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_OFFLINE_PERFORMANCE_PREFLIGHT',
      workloadsComparedComplete:comparedComplete,
      budgetCandidate:comparedComplete&&sorted.length===0,
      authorizesImport:false,authorizesCutover:false,productionReady:false,
      issues:sorted,limitations:LIMITATIONS
    };
  }catch{
    // Untrusted errors, getters, source rows and private metrics must not leak.
    throw new Error(BAD);
  }
}
