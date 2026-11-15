#!/usr/bin/env node
/**
 * Source-only Acorn AST audit of original client dynamic RPC callsites.
 * Method-name discovery is NOT an RPC allowlist or authorization.
 * Original Mohim_ERP source commit:
 * 29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */
import {parse} from 'acorn';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditM00RpcContracts} from './audit-m00-rpc.mjs';

const identifier=/^[A-Za-z_$][\w$]*$/;
const frontFile=/^[\w.-]+\.html$/;
const backFile=/^[\w.-]+\.gs$/;
const lineAt=(text,index)=>text.slice(0,index).split('\n').length;
const ast=(js,file)=> {
  try{return parse(js,{ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});}
  catch(error){throw new Error('Unable to parse pinned JS in '+file+': '+error.message);}
};
function walk(node,visitor,parent=null){
  if(!node || typeof node!=='object')return;
  if(Array.isArray(node)){
    for(const child of node)walk(child,visitor,parent);
    return;
  }
  if(typeof node.type!=='string')return;
  visitor(node,parent);
  for(const [key,value] of Object.entries(node)){
    if(key==='start'||key==='end'||key==='loc'||key==='raw'||key==='parent')continue;
    if(value && typeof value==='object')walk(value,visitor,node);
  }
}
function literalName(node){
  return node?.type==='Literal' && typeof node.value==='string' && identifier.test(node.value)
    ?node.value:null;
}
function propertyName(node){
  if(!node||node.type!=='Property'||node.computed||node.method||node.kind!=='init')return null;
  if(node.key.type==='Identifier')return node.key.name;
  if(node.key.type==='Literal'&&typeof node.key.value==='string')return node.key.value;
  return null;
}
function allProperties(object,reason){
  if(!object||object.type!=='ObjectExpression')
    throw new Error('Unsafe '+reason+' mapping: expected an object literal');
  const out=new Map();
  for(const item of object.properties){
    const key=propertyName(item);
    if(!key||out.has(key))throw new Error('Unsafe '+reason+' mapping: computed, spread or duplicate property');
    out.set(key,item.value);
  }
  return out;
}
function unchanged(block,name,checkEscapes=false){
  const rootedAtName=node=>{
    let current=node;
    while(current?.type==='MemberExpression')current=current.object;
    return current?.type==='Identifier'&&current.name===name;
  };
  walk(block,node=>{
    if(node.type==='AssignmentExpression'&&rootedAtName(node.left))
      throw new Error('Unsafe reassignment/mutation of dynamic RPC selector '+name);
    if(node.type==='UpdateExpression'&&rootedAtName(node.argument))
      throw new Error('Unsafe mutation of dynamic RPC selector '+name);
    if(node.type==='UnaryExpression'&&node.operator==='delete'&&rootedAtName(node.argument))
      throw new Error('Unsafe delete of dynamic RPC selector '+name);
    if(checkEscapes&&node.type==='CallExpression'&&node.arguments.some(rootedAtName))
      throw new Error('Unsafe selector argument escape/mutation in '+name);
  });
}
function nearestBinding(call,parents,name){
  let ancestor=parents.get(call);
  while(ancestor){
    if(ancestor.type==='BlockStatement'||ancestor.type==='Program'){
      const decls=[];
      for(const stmt of ancestor.body||[]){
        if(stmt.type!=='VariableDeclaration')continue;
        for(const d of stmt.declarations||[])
          if(d.id?.type==='Identifier'&&d.id.name===name&&d.start<call.start)
            decls.push(d);
      }
      if(decls.length){
        unchanged(ancestor,name);
        return decls.sort((a,b)=>b.start-a.start)[0].init;
      }
    }
    ancestor=parents.get(ancestor);
  }
  throw new Error('Unresolved dynamic RPC selector binding: '+name);
}
function literalTernary(node){
  if(node?.type!=='ConditionalExpression')
    throw new Error('Unsafe RPC selector: expected a two-literal conditional');
  const names=[literalName(node.consequent),literalName(node.alternate)];
  if(names.some(x=>!x))throw new Error('Unsafe RPC selector: both branches require literal method names');
  return [...new Set(names)].sort();
}
function collectVendorMap(scriptAst){
  const handlers=[];
  walk(scriptAst,node=>{
    if(node.type==='FunctionDeclaration'&&node.id?.name==='vendorNativeTxnHandlers_')
      handlers.push(node);
  });
  if(handlers.length!==1)
    throw new Error('Missing or duplicate vendorNativeTxnHandlers_ source function');
  const body=handlers[0].body.body;
  const decls=body.filter(x=>x.type==='VariableDeclaration').flatMap(x=>x.declarations)
    .filter(x=>x.id.type==='Identifier'&&x.id.name==='map');
  const returns=body.filter(x=>x.type==='ReturnStatement');
  if(decls.length!==1||returns.length!==1)
    throw new Error('Unsafe vendor handler map declaration or return shape');
  const ret=returns[0].argument;
  const isMapLookup=x=>x?.type==='MemberExpression'&&x.computed&&
    x.object.type==='Identifier'&&x.object.name==='map'&&x.property.type==='Identifier'&&x.property.name==='type';
  if(ret?.type!=='LogicalExpression'||ret.operator!=='||'||
    !isMapLookup(ret.left)||ret.right?.type!=='Literal'||ret.right.value!==null)
      throw new Error('Unsafe vendor handler return: expected map[type] || null');
  unchanged(handlers[0].body,'map',true);
  const mapping=allProperties(decls[0].init,'vendor helper');
  if(!mapping.size)throw new Error('Unsafe empty vendor mapping');
  const result=new Map();
  for(const [type,entry] of mapping){
    if(!type||!entry||entry.type!=='ObjectExpression')
      throw new Error('Unsafe vendor mapping for '+type);
    const fields=allProperties(entry,'vendor '+type);
    for(const key of ['get','update']){
      const value=literalName(fields.get(key));
      if(!value)throw new Error('Unsafe nonliteral vendor '+key+' mapping');
    }
    // Existing source has delete handlers too, but this audit records
    // only properties actually passed to serverCall (get/update).
    for(const [key,value] of fields)if(!literalName(value))
      throw new Error('Unsafe nonliteral vendor '+key+' mapping');
    result.set(type,fields);
  }
  return result;
}
function extractScript(source,file){
  const chunks=[];
  for(const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
    const marker=match[0].indexOf('>')+1;
    const codeStart=match.index+marker;
    const code=match[1];
    chunks.push({code,codeStart,tree:ast(code,file)});
  }
  return chunks;
}
function ownerIndex(sources){
  const owners=new Map();
  for(const file of Object.keys(sources).filter(x=>backFile.test(x)).sort()){
    const tree=ast(sources[file],file);
    for(const item of tree.body){
      if(item.type!=='FunctionDeclaration'||!item.id)continue;
      if(!owners.has(item.id.name))owners.set(item.id.name,[]);
      owners.get(item.id.name).push(file);
    }
  }
  return owners;
}
export function auditM00DynamicRpc({sources,sourceCommit,lexicalSnapshot}={}){
  if(!sources||typeof sources!=='object'||Array.isArray(sources)||
    !/^[a-f0-9]{40}$/.test(sourceCommit||''))
    throw new Error('Missing pinned M00 RPC input or original source SHA');
  const original=auditM00RpcContracts({sources,sourceCommit});
  const owners=ownerIndex(sources);
  const callsites=[];
  for(const file of Object.keys(sources).filter(x=>frontFile.test(x)).sort()){
    const html=sources[file];
    for(const {code,codeStart,tree} of extractScript(html,file)){
      const parents=new WeakMap();
      const calls=[];
      walk(tree,(node,parent)=>{
        if(parent)parents.set(node,parent);
        if(node.type==='CallExpression'&&node.callee.type==='Identifier'&&node.callee.name==='serverCall')
          calls.push(node);
      });
      for(const call of calls){
        const arg=call.arguments[0];
        if(literalName(arg))continue;
        if(!arg)throw new Error('Missing dynamic RPC method argument in '+file);
        let methods,argumentSyntax,evidence;
        if(arg.type==='Identifier'){
          argumentSyntax=arg.name;
          const init=nearestBinding(call,parents,arg.name);
          methods=literalTernary(init);
          evidence='lexically scoped two-literal conditional, no selector reassignment';
        }else if(arg.type==='MemberExpression'&&!arg.computed&&
          arg.object.type==='Identifier'&&arg.property.type==='Identifier'){
          const binding=arg.object.name;
          const prop=arg.property.name;
          argumentSyntax=binding+'.'+prop;
          if(!['get','update'].includes(prop))
            throw new Error('Unresolved dynamic RPC handler property '+prop);
          const init=nearestBinding(call,parents,binding);
          if(init?.type!=='CallExpression'||init.callee?.type!=='Identifier'||
            init.callee.name!=='vendorNativeTxnHandlers_'||
            init.arguments.length!==1||init.arguments[0].type!=='Identifier')
            throw new Error('Unsafe unresolved vendor selector binding');
          const mapping=collectVendorMap(tree);
          methods=[...new Set([...mapping.values()].map(fields=>literalName(fields.get(prop))))].sort();
          evidence='static vendorNativeTxnHandlers_ map[type] || null, literal '+prop+' entries';
        }else{
          throw new Error('Unsafe unresolved dynamic serverCall argument in '+file);
        }
        const targets=methods.map(name=>{
          const files=owners.get(name)||[];
          if(!files.length)throw new Error('Missing undefined backend RPC target '+name);
          if(files.length>1)throw new Error('Duplicate backend RPC target '+name);
          return {name,backendFile:files[0]};
        });
        callsites.push({frontendFile:file,
          line:lineAt(html,codeStart+call.start),argumentSyntax,evidence,targets});
      }
    }
  }
  callsites.sort((a,b)=>a.frontendFile.localeCompare(b.frontendFile)||a.line-b.line);
  const oldSites=original.dynamicCallsites;
  const actualSites=callsites.map(({frontendFile,line})=>({frontendFile,line}));
  if(JSON.stringify(actualSites)!==JSON.stringify(oldSites))
    throw new Error('M00 lexical dynamic callsite drift against parser findings');
  if(lexicalSnapshot){
    if(lexicalSnapshot.sourceCommit!==sourceCommit||
      JSON.stringify(actualSites)!==JSON.stringify(lexicalSnapshot.dynamicCallsites))
      throw new Error('M00 lexical dynamic callsite drift against reviewed snapshot');
  }
  const allTargets=callsites.flatMap(x=>x.targets.map(y=>y.name));
  return {formatVersion:1,sourceCommit,
    methodology:'AST-bounded client method names and original GAS owner declarations; not authorization, not a Worker RPC allowlist, not a functional port',
    counts:{dynamicCallsites:callsites.length,resolvedCallsites:callsites.length,
      totalTargetAppearances:allTargets.length,distinctTargets:new Set(allTargets).size},
    callsites};
}
export function assertM00DynamicRpcSnapshot(current,snapshot){
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw new Error('M00 dynamic RPC closure snapshot drift; require review');
  return true;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  (async()=>{
    const mode=process.argv[2];
    if(!['--write','--check'].includes(mode)||process.argv.length!==3)
      throw new Error('Usage: audit-m00-dynamic-rpc.mjs --write|--check');
    const root=new URL('../',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
    const sourceDir=fileURLToPath(new URL('legacy/source/',root));
    const names=(await readdir(sourceDir)).filter(x=>/\.(html|gs)$/.test(x)).sort();
    const sources=Object.fromEntries(await Promise.all(names.map(async file=>[
      file,await readFile(join(sourceDir,file),'utf8')
    ])));
    const old=JSON.parse(await readFile(new URL('docs/baseline/m00-rpc-contract-inventory.json',root),'utf8'));
    const result=auditM00DynamicRpc({sources,sourceCommit:manifest.source.commit,lexicalSnapshot:old});
    const location=new URL('docs/baseline/m00-dynamic-rpc-closure.json',root);
    if(mode==='--write'){
      await writeFile(location,JSON.stringify(result,null,2)+'\n','utf8');
      process.stdout.write('M00 dynamic RPC closure written (source-only)\n');
    }else{
      assertM00DynamicRpcSnapshot(result,JSON.parse(await readFile(location,'utf8')));
      process.stdout.write('M00 dynamic RPC closure verified (source-only)\n');
    }
  })().catch(error=>{
    console.error('M00 dynamic RPC closure rejected: '+error.message);
    process.exitCode=1;
  });
}
