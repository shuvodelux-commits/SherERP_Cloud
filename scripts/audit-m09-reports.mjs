#!/usr/bin/env node
/**
 * Source-only M09 reporting inventory. No Google Apps Script execution, D1
 * connection, credentials, transaction simulation or SQL read model.
 */
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const SURFACES = Object.freeze([
  {sourceFile:'Reports.gs', permission:'reports:view', endpoints:[
    'getReportsBootstrap','getSalesReport','getPurchaseReport','getStockReport',
    'getCashBankReport','getProfitReport','getBalanceSheetReport'
  ]},
  {sourceFile:'Dashboard.gs', permission:'dashboard:view', endpoints:['getDashboardStats']},
  {sourceFile:'DayBook.gs', permission:'daybook:view',
    endpoints:['getDayBookBootstrap','getDayBookTransactions']}
]);
const METHOD='Direct lexical getAllRows_/activeRows_ reads and helper invocations; not transitive; not business/SQL parity proof';

function sourceWithoutComments(source) {
  let state='code',escape=false,result='';
  for(let i=0;i<source.length;i++){
    const c=source[i],next=source[i+1];
    if(state==='line'){
      if(c==='\n'){state='code';result+='\n';} else result+=' ';
      continue;
    }
    if(state==='block'){
      if(c==='*' && next==='/'){result+='  ';i++;state='code';}
      else result+=c==='\n'?'\n':' ';
      continue;
    }
    if(state!=='code'){
      result+=c;
      if(escape){escape=false;continue;}
      if(c==='\\'){escape=true;continue;}
      if((state==='single'&&c==="'")||(state==='double'&&c==='"')||
         (state==='template'&&c==='`'))state='code';
      continue;
    }
    if(c==='/'&&next==='/'){result+='  ';i++;state='line';continue;}
    if(c==='/'&&next==='*'){result+='  ';i++;state='block';continue;}
    if(c==="'"){result+=c;state='single';continue;}
    if(c==='"'){result+=c;state='double';continue;}
    if(c==='`'){result+=c;state='template';continue;}
    result+=c;
  }
  return result;
}

function getTopLevelFunctions(source) {
  // The frozen GAS source declares these as column-zero `function name(...)`.
  // Only the publicly declared entry points are accepted; AST/dataflow not claimed.
  const clean=sourceWithoutComments(source);
  const pattern=/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  const markers=[...clean.matchAll(pattern)];
  const functions=new Map();
  for(let i=0;i<markers.length;i++){
    const name=markers[i][1];
    if(functions.has(name))throw new Error('Duplicate top-level function '+name);
    functions.set(name,clean.slice(markers[i].index,
      i+1<markers.length?markers[i+1].index:clean.length));
  }
  return functions;
}

function inspectEndpoint(functionSource,name,permission){
  const gate=/\brequirePermission_\s*\(\s*token\s*,\s*(['"])([a-z]+)\1\s*,\s*(['"])view\3\s*\)/;
  const found=functionSource.match(gate);
  if(!found || found[2]+':view'!==permission)
    throw new Error('Missing/changed permission for '+name);

  const directReads=new Set();
  const directCall=/\b(getAllRows_|activeRows_)\s*\(\s*(['"])([A-Z][A-Z0-9_]*)\2\s*\)/g;
  for(const hit of functionSource.matchAll(directCall))
    directReads.add(hit[1]+':'+hit[3]);

  const helpers=new Set();
  const helperCall=/\b([a-zA-Z_$][\w$]*_)\s*\(/g;
  for(const hit of functionSource.matchAll(helperCall)){
    const helper=hit[1];
    if(helper!=='requirePermission_' && helper!=='getAllRows_' && helper!=='activeRows_')
      helpers.add(helper);
  }
  return {name,permission,directReads:[...directReads].sort(),helpers:[...helpers].sort()};
}

/**
 * Immutable, deterministic snapshot of *direct* source contracts.
 * Input sources map names to frozen GAS text; does not evaluate GAS code.
 */
export function auditM09ReportContracts({sources,sourceCommit}={}){
  if(!sources || typeof sources!=='object' || !/^[a-f0-9]{40}$/.test(sourceCommit||''))
    throw new Error('Invalid M09 source or immutable SHA');
  const surfaces=SURFACES.map(({sourceFile,permission,endpoints})=>{
    if(typeof sources[sourceFile]!=='string')
      throw new Error('Missing source file '+sourceFile);
    const original=getTopLevelFunctions(sources[sourceFile]);
    return {sourceFile,endpoints:endpoints.map(name=>{
      if(!original.has(name))throw new Error('Missing source endpoint '+name);
      return inspectEndpoint(original.get(name),name,permission);
    })};
  });
  return {formatVersion:1,sourceCommit,methodology:METHOD,surfaces};
}

export function assertM09Snapshot(current,snapshot){
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw new Error('M09 report contract snapshot drift; review original source before updating');
  return true;
}

const isCli=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isCli){
  (async()=>{
    const mode=process.argv[2];
    if(!['--check','--write'].includes(mode)||process.argv.length!==3)
      throw new Error('Usage: node scripts/audit-m09-reports.mjs --check|--write');
    const root=new URL('../',import.meta.url);
    const readJson=async url=>JSON.parse(await readFile(url,'utf8'));
    const manifest=await readJson(new URL('docs/baseline/source-manifest.json',root));
    const sources=Object.fromEntries(await Promise.all(SURFACES.map(async item=>[
      item.sourceFile,await readFile(new URL('legacy/source/'+item.sourceFile,root),'utf8')
    ])));
    const current=auditM09ReportContracts({
      sources,sourceCommit:manifest.source.commit
    });
    const target=new URL('docs/baseline/m09-report-contract-inventory.json',root);
    if(mode==='--write'){
      await writeFile(target,JSON.stringify(current,null,2)+'\n','utf8');
      process.stdout.write('M09 report contract inventory written (source-only)\n');
    }else{
      assertM09Snapshot(current,await readJson(target));
      process.stdout.write('M09 report contracts verified (direct lexical only)\n');
    }
  })().catch(err=>{
    console.error('M09 report inventory rejected: '+err.message);
    process.exitCode=1;
  });
}