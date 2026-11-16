#!/usr/bin/env node
/**
 * M03 source-only browser RPC audit.
 *
 * This lexical inventory is deliberately NOT an RPC registry, D1 reader,
 * authorization decision, or proof of a resolved JavaScript call graph.
 * It never executes source HTML and cannot activate Worker routes.
 */
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {rpcRegistry} from '../src/rpc/registry.js';

const RPC_NAME=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const SOURCE_COMMIT=/^[0-9a-f]{40}$/;
const INVOCATION=/\bserverCall\s*\(/g;
const LITERAL=/^\s*(['"])([A-Za-z][A-Za-z0-9_]{0,79})\1(?=\s*[,)]|\s*\n)/;

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
    for(const match of html.matchAll(INVOCATION)){
      // A declaration names the helper, but it is not an invocation.
      if(/\bfunction\s*$/.test(html.slice(Math.max(0,match.index-24),match.index)))
        continue;
      const suffix=html.slice(match.index+match[0].length);
      const literal=LITERAL.exec(suffix);
      if(literal){
        const name=literal[2];
        const entry=records.get(name)||{name,htmlFiles:new Set(),literalCallSites:0};
        entry.htmlFiles.add(file);
        entry.literalCallSites++;
        literalCallSites++;
        records.set(name,entry);
      }else {
        const line=html.slice(0,match.index).split('\n').length;
        dynamicSites.push({file,line});
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
    limitations:'Lexical browser serverCall scan (including possible comments/strings); not proof of callable source functions, complete dynamic dispatch, async D1 migration, authorization or production readiness. All public methods remain blocked.',
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
