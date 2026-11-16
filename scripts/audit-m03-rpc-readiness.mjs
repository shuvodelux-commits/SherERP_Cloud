#!/usr/bin/env node
/**
 * M03 source-only browser RPC audit.
 *
 * This JavaScript-token inventory is NOT an RPC registry, D1 reader,
 * authorization decision, or proof of a resolved JavaScript call graph.
 * It never executes source HTML and cannot activate Worker routes.
 */
import {readFile,readdir} from 'node:fs/promises';
import {tokenizer} from 'acorn';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rpcRegistry} from '../src/rpc/registry.js';

const RPC_NAME=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const SOURCE_COMMIT=/^[0-9a-f]{40}$/;
const SCRIPT_START=/^[ \t]*<script(?:[ \t][^>]*)?>[ \t]*$/gmi;
const SCRIPT_END=/^[ \t]*<\/script\s*>[ \t]*$/gmi;

// The original 37 HTML files use standalone script tags. In tests, a
// standalone JavaScript fragment (without HTML markup) is also supported.
function scriptRegions(html,file) {
  const open=[...html.matchAll(SCRIPT_START)];
  const close=[...html.matchAll(SCRIPT_END)];
  if(!open.length && !close.length)
    return /^\s*</.test(html)?[]:[{source:html,lineOffset:0}];
  if(open.length!==close.length)
    throw new Error('Unbalanced original HTML script blocks in '+file);
  const regions=[];
  let lastEnd=0;
  for(let i=0;i<open.length;i++){
    const begin=open[i].index+open[i][0].length;
    const end=close[i].index;
    if(open[i].index<lastEnd || end<begin ||
       (open[i+1] && open[i+1].index<end))
      throw new Error('Invalid original HTML script block order in '+file);
    regions.push({
      source:html.slice(begin,end),
      lineOffset:html.slice(0,begin).split('\n').length-1
    });
    lastEnd=end+close[i][0].length;
  }
  return regions;
}

function executableCalls(region,file) {
  // Acorn is a tokenizer only here. It never executes original browser JS,
  // and it cannot resolve the possible values of dynamic RPC arguments.
  const lexer=tokenizer(region.source,{ecmaVersion:'latest',sourceType:'script',locations:true});
  const tokens=[];
  try{
    while(true){
      const token=lexer.getToken();
      if(token.type.label==='eof')break;
      tokens.push(token);
    }
  }catch{
    throw new Error('Invalid original JavaScript tokenization in '+file);
  }
  const calls=[];
  for(let i=0;i<tokens.length;i++){
    const current=tokens[i],previous=tokens[i-1],next=tokens[i+1];
    if(current.type.label!=='name'||current.value!=='serverCall'||
       next?.type.label!=='('||
       ['function','.','?.'].includes(previous?.type.label))
      continue;
    const firstArg=tokens[i+2];
    const name=firstArg?.type.label==='string'&&
      typeof firstArg.value==='string'&&RPC_NAME.test(firstArg.value)
      ?firstArg.value:null;
    calls.push({name,line:region.lineOffset+current.loc.start.line});
  }
  return calls;
}

function validateInputs({sourceCommit,closure,registry,htmlFiles}) {
  if(typeof sourceCommit!=='string'||!SOURCE_COMMIT.test(sourceCommit)||
     !closure||closure.sourceCommit!==sourceCommit)
    throw new Error('M03 source commit/closure pin mismatch');
  if(!Array.isArray(closure.affected)||
     !Number.isSafeInteger(closure.counts?.impactedFunctions)||
     closure.counts.impactedFunctions!==closure.affected.length||
     !Number.isSafeInteger(closure.sourceFiles)||closure.sourceFiles<1||
     new Set(closure.affected.map(row=>row?.name)).size!==closure.affected.length||
     closure.affected.some(row=>!RPC_NAME.test(row?.name||'')))
    throw new Error('Invalid M03 async closure function count');
  if(!registry||typeof registry!=='object'||
     Reflect.ownKeys(registry).length!==0)
    throw new Error('Unreviewed public RPC handler: separate M04 allowlist review required');
  if(!htmlFiles||typeof htmlFiles!=='object'||Array.isArray(htmlFiles)||
     Object.keys(htmlFiles).length===0||
     Object.keys(htmlFiles).some(file=>!/^[-\w]+\.html$/.test(file)||
       typeof htmlFiles[file]!=='string'))
    throw new Error('Missing or invalid original HTML source files');
}

export function buildM03RpcReadiness({sourceCommit,htmlFiles,closure,registry}={}) {
  validateInputs({sourceCommit,htmlFiles,closure,registry});
  const impacted=new Set(closure.affected.map(row=>row.name));
  const records=new Map();
  const dynamicSites=[];
  let literalCallSites=0;
  for(const file of Object.keys(htmlFiles).sort()){
    const html=htmlFiles[file];
    for(const region of scriptRegions(html,file)){
      for(const call of executableCalls(region,file)){
        if(call.name!==null){
          const name=call.name;
          const entry=records.get(name)||{name,htmlFiles:new Set(),literalCallSites:0};
          entry.htmlFiles.add(file);
          entry.literalCallSites++;
          literalCallSites++;
          records.set(name,entry);
        }else dynamicSites.push({file,line:call.line});
      }
    }
  }
  const methods=[...records.values()].sort((a,b)=>a.name.localeCompare(b.name,'en'))
    .map(item=>({
      name:item.name,htmlFiles:[...item.htmlFiles].sort(),
      literalCallSites:item.literalCallSites,
      asyncSourceImpact:impacted.has(item.name),
      publicState:'blocked'
    }));
  return {
    formatVersion:1,sourceCommit,
    limitations:'Tokenized lexical browser serverCall scan of inline script blocks; not proof of complete dynamic dispatch, source call graph, async D1 migration, authorization or production readiness. All public methods remain blocked.',
    summary:{
      htmlFiles:Object.keys(htmlFiles).length,
      literalMethods:methods.length,
      literalCallSites,
      dynamicCallSites:dynamicSites.length,
      asyncImpactedFunctions:closure.counts.impactedFunctions,
      publicHandlers:0
    },
    methods,dynamicSites
  };
}

async function main(){
  const mode=process.argv[2];
  if(process.argv.length!==3||!['--check','--json'].includes(mode))
    throw new Error('Usage: node scripts/audit-m03-rpc-readiness.mjs --check|--json');
  const root=new URL('../',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
  const closure=JSON.parse(await readFile(new URL('docs/baseline/m03-async-caller-closure.json',root),'utf8'));
  const htmlNames=(await readdir(new URL('legacy/source/',root)))
    .filter(name=>name.endsWith('.html')).sort();
  const expected=manifest.files.filter(row=>row.path.endsWith('.html'))
    .map(row=>row.path).sort();
  if(JSON.stringify(htmlNames)!==JSON.stringify(expected))
    throw new Error('Frozen source HTML manifest mismatch');
  const htmlFiles=Object.fromEntries(await Promise.all(htmlNames.map(async file=>[
    file,await readFile(new URL('legacy/source/'+file,root),'utf8')
  ])));
  const report=buildM03RpcReadiness({
    sourceCommit:manifest.source.commit,closure,registry:rpcRegistry,htmlFiles
  });
  if(report.summary.htmlFiles!==37||report.summary.asyncImpactedFunctions!==394||
     report.summary.literalMethods<=10)
    throw new Error('M03 frozen browser/async source inventory drift');
  if(mode==='--json')process.stdout.write(JSON.stringify(report,null,2)+'\n');
  else process.stdout.write('M03 RPC readiness: '+report.summary.literalMethods+
    ' literal methods blocked; '+report.summary.dynamicCallSites+
    ' dynamic call sites need review; public RPC not activated\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{
    console.error('M03 RPC audit failed: '+error.message);
    process.exitCode=1;
  });
