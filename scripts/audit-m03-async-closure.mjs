#!/usr/bin/env node
/**
 * M03 source-only named-function call closure.
 * Parses frozen GAS but does not execute it or authorize any D1/SQL writes.
 */
import {parse} from 'acorn';
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';

const READ=Object.freeze([
  'findFirstRow_','findRow_','findRowIndex_','findRows_',
  'getAllRows_','getSheetHeaders_','getSheet_'
]);
const WRITE=Object.freeze([
  'appendRow_','appendRows_','deleteRow_','updateRowFields_'
]);
const ALL_SEEDS=new Set([...READ,...WRITE]);

/** Collect static identifier callees, including inside nested callbacks. */
function callNames(root) {
  const found=new Set();
  const traverse=node=>{
    if(!node || typeof node!=='object')return;
    if(Array.isArray(node)){
      for(const child of node)traverse(child);
      return;
    }
    if(node.type==='CallExpression' && node.callee?.type==='Identifier')
      found.add(node.callee.name);
    for(const [key,value] of Object.entries(node)){
      if(key!=='start' && key!=='end' && key!=='loc' && key!=='range')
        if(value && typeof value==='object')traverse(value);
    }
  };
  traverse(root);
  return found;
}

function tracePaths(definitions,property) {
  const paths=new Map();
  for(const [name,node] of definitions){
    if(ALL_SEEDS.has(name))continue;
    if(node[property].length)paths.set(name,[name,node[property][0]]);
  }
  const names=[...definitions.keys()].filter(x=>!ALL_SEEDS.has(x)).sort();
  const better=(candidate,current)=>
    !current || candidate.length<current.length ||
    (candidate.length===current.length && candidate.join('\0')<current.join('\0'));
  // Reverse-transitive shortest path relaxation. Cycles terminate because a
  // candidate can only improve distance or a bounded lexical tie-break.
  let changed=true;
  while(changed){
    changed=false;
    for(const name of names){
      for(const target of definitions.get(name).calls){
        const tail=paths.get(target);
        if(!tail)continue;
        const candidate=[name,...tail];
        if(better(candidate,paths.get(name))){
          paths.set(name,candidate);
          changed=true;
        }
      }
    }
  }
  return paths;
}

/**
 * Source-pinned dependency review: not an async conversion, a complete
 * resolved callgraph, or an authorization/transaction correctness proof.
 */
export function buildM03AsyncClosure({sources,sourceCommit}={}) {
  if(!sources || typeof sources!=='object' || Array.isArray(sources) ||
      !/^[a-f0-9]{40}$/.test(sourceCommit||''))
    throw Error('Invalid M03 source map or pinned source commit');
  const files=Object.keys(sources).sort();
  if(!files.length)throw Error('Empty M03 GAS source map');

  const digest=createHash('sha256');
  const definitions=new Map();
  for(const file of files){
    if(!/^[\w.-]+\.gs$/.test(file) || typeof sources[file]!=='string')
      throw Error('Invalid M03 GAS source file');
    digest.update(file).update('\0').update(sources[file]).update('\0');
    // Acorn is a parser only; it never executes original GAS source.
    const ast=parse(sources[file],{ecmaVersion:'latest',sourceType:'script'});
    for(const declaration of ast.body){
      if(declaration.type!=='FunctionDeclaration')continue;
      const name=declaration.id?.name;
      if(!name)throw Error('Anonymous top-level GAS function in '+file);
      if(definitions.has(name))throw Error('Duplicate top-level GAS function '+name);
      definitions.set(name,{file,body:declaration.body});
    }
  }

  for(const [name,node] of definitions){
    const calls=callNames(node.body);
    node.directReads=READ.filter(seed=>calls.has(seed));
    node.directWrites=WRITE.filter(seed=>calls.has(seed));
    node.calls=[...calls].filter(callee=>
      definitions.has(callee) && !ALL_SEEDS.has(callee) && callee!==name
    ).sort();
    delete node.body;
  }
  const reads=tracePaths(definitions,'directReads');
  const writes=tracePaths(definitions,'directWrites');
  const affected=[...definitions.keys()].sort()
    .filter(name=>reads.has(name)||writes.has(name)).map(name=>{
      const node=definitions.get(name);
      return {
        name,file:node.file,
        directReads:node.directReads,directWrites:node.directWrites,
        readPath:reads.get(name)||[],writePath:writes.get(name)||[]
      };
    });
  const eligible=[...definitions.keys()].filter(name=>!ALL_SEEDS.has(name));
  return {
    formatVersion:1,sourceCommit,sourceFiles:files.length,
    sourceDigestSha256:digest.digest('hex'),
    limitations:'Top-level named GAS function call closure only; not complete async safety proof, dynamic/method dispatch, closure/callback timing, local shadowing and runtime callsites require review, and this is not a SQL transaction guarantee',
    seeds:{read:[...READ],write:[...WRITE]},
    counts:{
      totalFunctions:definitions.size,
      directReadFunctions:eligible.filter(n=>definitions.get(n).directReads.length>0).length,
      directWriteFunctions:eligible.filter(n=>definitions.get(n).directWrites.length>0).length,
      transitiveReadFunctions:reads.size,
      transitiveWriteFunctions:writes.size,
      impactedFunctions:affected.length
    },
    affected
  };
}

export function assertM03AsyncClosureSnapshot(current,snapshot){
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw Error('M03 async caller closure snapshot drift; review original source');
  return true;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const mode=process.argv[2];
    if(!['--check','--write'].includes(mode)||process.argv.length!==3)
      throw Error('Usage: node scripts/audit-m03-async-closure.mjs --check|--write');
    const root=new URL('../',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
    const sourceDir=fileURLToPath(new URL('legacy/source/',root));
    const filenames=(await readdir(sourceDir)).filter(x=>x.endsWith('.gs')).sort();
    const sources=Object.fromEntries(await Promise.all(filenames.map(async name=>
      [name,await readFile(join(sourceDir,name),'utf8')]
    )));
    const result=buildM03AsyncClosure({sources,sourceCommit:manifest.source.commit});
    const output=new URL('docs/baseline/m03-async-caller-closure.json',root);
    if(mode==='--write'){
      await writeFile(output,JSON.stringify(result,null,2)+'\n','utf8');
      process.stdout.write('M03 async caller closure snapshot written (source-only)\n');
    }else{
      assertM03AsyncClosureSnapshot(result,JSON.parse(await readFile(output,'utf8')));
      process.stdout.write('M03 async caller closure verified (static callgraph only)\n');
    }
  })().catch(err=>{
    console.error('M03 async caller closure rejected: '+err.message);
    process.exitCode=1;
  });
}
