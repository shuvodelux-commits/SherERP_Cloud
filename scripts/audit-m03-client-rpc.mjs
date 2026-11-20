#!/usr/bin/env node
/**
 * M03: evidence-only audit of literal serverCall calls in preserved inline
 * <script> blocks against the pinned named GAS async-impact closure.
 *
 * Not a full client-dispatch graph, not proof of a D1 port, an awaited
 * response, source authorization, financial posting, or public API safety.
 * Never execute legacy HTML or serialize original RPC arguments.
 */
import {parse} from 'acorn';
import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const FILENAME=/^[A-Za-z0-9_.-]+\.html$/;
const RPC_NAME=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const JS_TYPES=new Set([
  '', 'text/javascript','application/javascript',
  'text/ecmascript','application/ecmascript','module'
]);

function visit(node,callback){
  if(!node || typeof node!=='object')return;
  if(Array.isArray(node)){
    for(const item of node)visit(item,callback);
    return;
  }
  if(node.type==='CallExpression')callback(node);
  for(const [name,child] of Object.entries(node)){
    if(name==='start'||name==='end'||name==='loc'||name==='raw')continue;
    if(child && typeof child==='object')visit(child,callback);
  }
}

function scriptType(attributes){
  const match=attributes.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const value=(match?(match[1]??match[2]??match[3]):'').trim().toLowerCase();
  return JS_TYPES.has(value)?value:null;
}

/**
 * Pure source triage. Missing from the *affected* GAS inventory does not
 * establish source purity or guarantee the Worker has implemented an API.
 * Dynamic calls and parse errors always remain explicit review queues.
 */
export function auditInlineRpcCallsites({htmlFiles,closure}={}){
  if(!htmlFiles || typeof htmlFiles!=='object' || Array.isArray(htmlFiles) ||
      !closure || !Array.isArray(closure.affected) ||
      !/^[a-f0-9]{40}$/.test(closure.sourceCommit||''))
    throw new TypeError('Invalid M03 frontend source or pinned async closure');

  const sourceMap=new Map();
  for(const row of closure.affected){
    if(!row || typeof row.name!=='string' ||
       !RPC_NAME.test(row.name) || typeof row.file!=='string' ||
       !Array.isArray(row.readPath) || !Array.isArray(row.writePath) ||
       sourceMap.has(row.name))
      throw new TypeError('Invalid or duplicated GAS async impact entry');
    sourceMap.set(row.name,row);
  }

  const staticCalls=[],dynamicCalls=[],parseFailures=[];
  let scriptBlocks=0;
  const files=Object.keys(htmlFiles).sort();
  for(const file of files){
    const html=htmlFiles[file];
    if(!FILENAME.test(file) || typeof html!=='string')
      throw new TypeError('Invalid M03 frontend HTML file');
    // This conservative HTML-comment removal does not parse HTML templates.
    // Residual non-inline handlers and runtime-generated RPCs need review.
    const withoutHtmlComments=html.replace(/<!--[\s\S]*?-->/g,'');
    const tags=/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let match,scriptIndex=0;
    while((match=tags.exec(withoutHtmlComments))!==null){
      const type=scriptType(match[1]);
      if(type===null)continue; // e.g. JSON data script, not executable JS
      scriptBlocks++;
      scriptIndex++;
      let ast;
      try{
        ast=parse(match[2],{
          ecmaVersion:'latest',
          sourceType:type==='module'?'module':'script',
          allowReturnOutsideFunction:true
        });
      }catch{
        parseFailures.push({file,scriptIndex});
        continue;
      }
      visit(ast,call=>{
        const callee=call.callee?.type==='ChainExpression'
          ?call.callee.expression:call.callee;
        if(callee?.type!=='Identifier'||callee.name!=='serverCall')return;
        const arg=call.arguments[0];
        const literal=arg?.type==='Literal' && typeof arg.value==='string' &&
          RPC_NAME.test(arg.value);
        if(!literal){
          dynamicCalls.push({file,scriptIndex});
          return;
        }
        const method=arg.value,source=sourceMap.get(method);
        staticCalls.push({
          file,scriptIndex,method,
          classification:source?'source-async-impacted':'not-in-affected-closure',
          gasFile:source?.file??null,
          readPath:source?[...source.readPath]:[],
          writePath:source?[...source.writePath]:[]
        });
      });
    }
  }
  const affectedSites=staticCalls.filter(x=>x.classification==='source-async-impacted').length;
  return {
    formatVersion:1,
    scanKind:'html-inline-script-static-rpc',
    sourceCommit:closure.sourceCommit,
    counts:{
      htmlFiles:files.length,scriptBlocks,staticSites:staticCalls.length,
      dynamicSites:dynamicCalls.length,parseFailures:parseFailures.length,
      affectedSites,notInAffectedClosure:staticCalls.length-affectedSites
    },
    staticCalls,dynamicCalls,parseFailures,
    limitations:'Not a complete runtime call graph or D1 implementation proof: only parseable inline scripts and direct serverCall identifiers; HTML event attributes, indirect wrappers, shadowed names, generated code, callback timing, auth, SQL writes and Promise leaks require separate verification.'
  };
}

async function main(){
  if(process.argv.length!==3 || process.argv[2]!=='--summary')
    throw Error('Usage: node scripts/audit-m03-client-rpc.mjs --summary');
  const root=fileURLToPath(new URL('../',import.meta.url));
  const closure=JSON.parse(await readFile(join(root,'docs/baseline/m03-async-caller-closure.json'),'utf8'));
  const manifest=JSON.parse(await readFile(join(root,'docs/baseline/source-manifest.json'),'utf8'));
  if(closure.sourceCommit!==manifest.source.commit)
    throw Error('Frozen GAS source pin and async closure mismatch');
  const directory=join(root,'legacy/source');
  const names=(await readdir(directory)).filter(x=>x.endsWith('.html'));
  const htmlFiles=Object.fromEntries(await Promise.all(names.map(async name=>[
    name,await readFile(join(directory,name),'utf8')
  ])));
  const audit=auditInlineRpcCallsites({htmlFiles,closure});
  const unresolved=audit.staticCalls.filter(x=>x.classification==='not-in-affected-closure');
  process.stdout.write(JSON.stringify({
    scanKind:audit.scanKind,sourceCommit:audit.sourceCommit,counts:audit.counts,
    dynamicCalls:audit.dynamicCalls.slice(0,20),
    parseFailures:audit.parseFailures.slice(0,20),
    absentFromAffectedClosure:unresolved.slice(0,20).map(x=>({file:x.file,method:x.method})),
    limitations:audit.limitations
  },null,2)+'\n');
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(err=>{
    console.error('M03 client RPC audit incomplete: '+err.message);
    process.exitCode=1;
  });
}
