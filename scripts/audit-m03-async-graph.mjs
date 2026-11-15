#!/usr/bin/env node
import {parse} from 'acorn';
import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const DIRECT_HELPERS=new Set([
  'getAllRows_','getSheetHeaders_','findRowIndex_','findRow_',
  'findRows_','findFirstRow_','appendRow_','appendRows_',
  'updateRowFields_','deleteRow_','getSheet_','generateId_'
]);
const RANGE_METHODS=new Set([
  'getRange','getValues','getValue','setValues','setValue',
  'deleteRow','insertRowAfter','clearContent','setNumberFormat'
]);
const GAS_SERVICES=new Set([
  'SpreadsheetApp','HtmlService','LockService','PropertiesService',
  'CacheService','Utilities','Session','ScriptApp'
]);

function visitAst(node,visitor){
  if(!node || typeof node!=='object')return;
  if(Array.isArray(node)){
    for(const child of node)visitAst(child,visitor);
    return;
  }
  if(typeof node.type==='string')visitor(node);
  for(const [key,value] of Object.entries(node)){
    if(key==='start'||key==='end'||key==='loc'||key==='raw')continue;
    if(value && typeof value==='object')visitAst(value,visitor);
  }
}

function rootIdentifier(node){
  if(!node)return null;
  if(node.type==='Identifier')return node.name;
  if(node.type==='ChainExpression')return rootIdentifier(node.expression);
  if(node.type==='MemberExpression')return rootIdentifier(node.object);
  return null;
}
function memberName(member){
  if(!member || member.type!=='MemberExpression')return null;
  if(!member.computed && member.property.type==='Identifier')
    return member.property.name;
  if(member.computed && member.property.type==='Literal' &&
     typeof member.property.value==='string')return member.property.value;
  return null;
}
function isGoogleScriptRun(member){
  return memberName(member)==='run' &&
    member.object?.type==='MemberExpression' &&
    memberName(member.object)==='script' &&
    rootIdentifier(member.object)==='google';
}

function functionDefinitions(file,body){
  const functions=[];
  for(const top of body){
    if(top.type==='FunctionDeclaration'&&top.id?.type==='Identifier'){
      functions.push({file,name:top.id.name,node:top});
    }else if(top.type==='VariableDeclaration'){
      for(const decl of top.declarations){
        if(decl.id?.type==='Identifier' &&
           ['FunctionExpression','ArrowFunctionExpression'].includes(decl.init?.type)){
          functions.push({file,name:decl.id.name,node:decl.init});
        }
      }
    }
  }
  return functions;
}
function directEvidence(functionNode){
  const edges=new Set(),direct=new Set();
  visitAst(functionNode.body,node=>{
    if(node.type==='CallExpression'||node.type==='NewExpression'){
      const callee=node.callee?.type==='ChainExpression'?
        node.callee.expression:node.callee;
      if(callee?.type==='Identifier'){
        edges.add(callee.name);
        if(DIRECT_HELPERS.has(callee.name))direct.add(callee.name);
      }
      const property=memberName(callee);
      if(property && RANGE_METHODS.has(property))direct.add(property);
    }
    if(node.type==='MemberExpression'){
      const global=rootIdentifier(node);
      if(GAS_SERVICES.has(global))direct.add(global);
      if(isGoogleScriptRun(node))direct.add('google.script.run');
    }
  });
  return {calledNames:[...edges].sort(),directBoundaries:[...direct].sort()};
}
function shortestPath(start,definitions){
  const todo=[[start]],seen=new Set([start]);
  for(let index=0;index<todo.length;index++){
    const path=todo[index];
    const current=definitions.get(path[path.length-1]);
    if(current.directBoundaries.length)return path;
    for(const target of current.calls){
      if(!seen.has(target)){
        seen.add(target);
        todo.push([...path,target]);
      }
    }
  }
  return null;
}

/**
 * Source static-analysis aid, never an auto-conversion tool. Original frozen
 * GAS globals are an unordered cross-file namespace; when a name has several
 * definitions, every candidate is represented as a possible call target.
 * Calls from nested callbacks are conservatively attributed to their parent.
 * Dynamic dispatch, lexical shadowing and callback scheduling require manual
 * source review before promises can be propagated safely.
 */
export function buildLegacyAsyncCallGraph(files){
  if(!files||typeof files!=='object'||Array.isArray(files))
    throw new TypeError('files must be a filename-to-source map');
  const digest=createHash('sha256'),definitions=new Map(),nameIndex=new Map();
  const names=Object.keys(files).sort();
  for(const file of names){
    if(!/^[a-zA-Z0-9_.-]+\.gs$/.test(file))
      throw new TypeError('Invalid source filename: '+file);
    const raw=files[file];
    if(typeof raw!=='string')throw new TypeError('Invalid source text for '+file);
    digest.update(file).update('\0').update(raw).update('\0');
    let parsed;
    try{
      parsed=parse(raw,{
        ecmaVersion:'latest',sourceType:'script',
        allowReturnOutsideFunction:true,allowAwaitOutsideFunction:true
      });
    }catch(e){
      throw new SyntaxError('Cannot parse '+file+' for M03 call graph: '+e.message);
    }
    for(const fn of functionDefinitions(file,parsed.body)){
      const id=file+':'+fn.name;
      if(definitions.has(id))throw new Error('Duplicate top-level function: '+id);
      const evidence=directEvidence(fn.node);
      definitions.set(id,{
        id,file,name:fn.name,calledNames:evidence.calledNames,
        directBoundaries:evidence.directBoundaries
      });
      const candidates=nameIndex.get(fn.name)||[];
      candidates.push(id);
      nameIndex.set(fn.name,candidates);
    }
  }
  for(const candidates of nameIndex.values())candidates.sort();

  const rows=new Map();
  for(const [id,fn] of definitions){
    const calls=[...new Set(fn.calledNames.flatMap(name=>nameIndex.get(name)||[]))].sort();
    rows.set(id,{
      id:fn.id,file:fn.file,name:fn.name,
      calls,directBoundaries:fn.directBoundaries
    });
  }
  const functions=[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id))
    .map(row=>({
      ...row,pathToBoundary:shortestPath(row.id,rows)
    }));
  const ambiguousNames=[...nameIndex.entries()]
    .filter(([,ids])=>ids.length>1)
    .map(([name,definitions])=>({name,definitions}))
    .sort((a,b)=>a.name.localeCompare(b.name));
  const direct=functions.filter(row=>row.directBoundaries.length>0).length;
  const indirect=functions.filter(row=>
    row.directBoundaries.length===0 && row.pathToBoundary!==null).length;
  return {
    formatVersion:1,
    scanKind:'ast-transitive-async-calls',
    sourceFiles:names.length,
    sourceDigestSha256:digest.digest('hex'),
    summary:{
      functions:functions.length,direct,indirect,
      unaffected:functions.length-direct-indirect,
      resolvedCallEdges:functions.reduce((n,f)=>n+f.calls.length,0),
      ambiguousFunctionNames:ambiguousNames.length,
      modulesWithAsync:new Set(functions.filter(f=>f.pathToBoundary)
        .map(f=>f.file)).size
    },
    ambiguousNames,functions
  };
}

async function main(){
  const sourceDir=join(ROOT,'legacy/source');
  const filenames=(await readdir(sourceDir)).filter(name=>name.endsWith('.gs')).sort();
  const inputs={};
  for(const file of filenames){
    inputs[file]=await readFile(join(sourceDir,file),'utf8');
  }
  const graph=buildLegacyAsyncCallGraph(inputs);
  if(process.argv.includes('--check')){
    const baseline=JSON.parse(await readFile(
      join(ROOT,'docs/baseline/m03-direct-call-inventory.json'),'utf8'
    ));
    if(graph.sourceFiles!==baseline.sourceFiles ||
       graph.sourceDigestSha256!==baseline.sourceDigestSha256)
      throw new Error('Original M03 source digest drifted; review frozen source changes');
    process.stdout.write('M03 AST transitive graph source pin verified: '+
      graph.sourceFiles+' files; '+graph.summary.functions+' functions; '+
      graph.summary.indirect+' indirect async callers\n');
  }else if(process.argv.includes('--summary')){
    process.stdout.write(JSON.stringify({
      sourceFiles:graph.sourceFiles,
      sourceDigestSha256:graph.sourceDigestSha256,
      summary:graph.summary,ambiguousNames:graph.ambiguousNames
    },null,2)+'\n');
  }else{
    process.stdout.write(JSON.stringify(graph,null,2)+'\n');
  }
}
if(process.argv[1] &&
   resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    console.error('M03 transitive async call-graph audit failed: '+error.message);
    process.exitCode=1;
  });
}
