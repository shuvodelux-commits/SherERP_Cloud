#!/usr/bin/env node
/** M09 frozen GAS/HTML lexical contracts only. No runtime, DB or upload execution. */
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const stripJsComments = function stripJsComments(source){
  let mode='code',escaped=false,out='';
  for(let i=0;i<source.length;i++){
    const c=source[i],next=source[i+1];
    if(mode==='line'){
      if(c==='\n'){mode='code';out+='\n';}else out+=' ';
      continue;
    }
    if(mode==='block'){
      if(c==='*' && next==='/'){out+='  ';i++;mode='code';}
      else out+=c==='\n'?'\n':' ';
      continue;
    }
    if(mode!=='code'){
      out+=c;
      if(escaped){escaped=false;continue;}
      if(c==='\\'){escaped=true;continue;}
      if((mode==='single'&&c==="'")||(mode==='double'&&c==='"')||(mode==='template'&&c==='`'))
        mode='code';
      continue;
    }
    if(c==='/'&&next==='/'){out+='  ';i++;mode='line';continue;}
    if(c==='/'&&next==='*'){out+='  ';i++;mode='block';continue;}
    if(c==="'"){out+=c;mode='single';continue;}
    if(c==='"'){out+=c;mode='double';continue;}
    if(c==='`'){out+=c;mode='template';continue;}
    out+=c;
  }
  return out;
};
export const auditM09SettingsInvoiceContracts = function auditM09SettingsInvoiceContracts({sources,sourceCommit}={}){
  const required=['Settings.gs','Invoice.gs','settings.html','invoiceDesign.html'];
  if(!sources||typeof sources!=='object'||!(/^[a-f0-9]{40}$/).test(sourceCommit||''))
    throw new Error('Invalid M09 settings source or immutable SHA');
  for(const name of required)
    if(typeof sources[name]!=='string')throw new Error('Missing source file '+name);
  const settings=stripJsComments(sources['Settings.gs']);
  const invoice=stripJsComments(sources['Invoice.gs']);

  function array(name){
    const match=settings.match(new RegExp('\\bconst\\s+'+name+'\\s*=\\s*(\\[[\\s\\S]*?\\])\\s*;'));
    if(!match)throw new Error('Missing declared Settings array '+name);
    let parsed;
    try{parsed=JSON.parse(match[1]);}catch{throw new Error('Unparseable Settings array '+name);}
    if(!Array.isArray(parsed)||parsed.some(x=>typeof x!=='string')||new Set(parsed).size!==parsed.length)
      throw new Error('Invalid Settings array '+name);
    return parsed;
  }
  const names=[
    ['getSettingsBootstrap','settings:view'],
    ['updateSettings','settings:edit'],
    ['getInvoiceDesignBootstrap','settings:view'],
    ['uploadInvoiceLogo','settings:edit'],
    ['removeInvoiceLogo','settings:edit']
  ];
  const functionMarkers=[...settings.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)];
  const functions=new Map();
  for(let i=0;i<functionMarkers.length;i++){
    const name=functionMarkers[i][1];
    if(functions.has(name))throw new Error('Duplicate top-level Settings function '+name);
    functions.set(name,settings.slice(functionMarkers[i].index,
      i+1<functionMarkers.length?functionMarkers[i+1].index:settings.length));
  }
  const endpoints=names.map(([name,expectedPermission])=>{
    if(!functions.has(name))throw new Error('Missing Settings endpoint '+name);
    const body=functions.get(name);
    const permission=body.match(/\brequirePermission_\s*\(\s*token\s*,\s*(['"])settings\1\s*,\s*(['"])(view|edit)\2\s*\)/);
    if(!permission||'settings:'+permission[3]!==expectedPermission)
      throw new Error('Missing/changed permission for '+name);
    const reads=new Set();
    for(const hit of body.matchAll(/\b(getAllRows_|activeRows_)\s*\(\s*(['"])([A-Z][A-Z0-9_]*)\2\s*\)/g))
      reads.add(hit[1]+':'+hit[3]);
    return {name,permission:expectedPermission,directReads:[...reads].sort()};
  });
  if(!/\bSETTINGS_EDITABLE_KEYS\s*\.\s*forEach\s*\(/.test(functions.get('updateSettings')))
    throw new Error('Settings update is no longer driven by editable-key allowlist');

  const max=settings.match(/\bconst\s+INVOICE_LOGO_MAX_BYTES\s*=\s*([\d.]+)\s*\*\s*1024\s*\*\s*1024\s*;/);
  if(!max)throw new Error('Missing or changed invoice logo size expression');
  const maxBytes=Number(max[1])*1024*1024;
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new Error('Invalid logo maximum bytes');

  const pages=['settings.html','invoiceDesign.html'].map(sourceFile=>{
    const content=stripJsComments(sources[sourceFile].replace(/<!--[\s\S]*?-->/g,''));
    const calls=new Set();
    for(const hit of content.matchAll(/\bserverCall\s*\(\s*(['"])([A-Za-z_$][\w$]*)\1/g))calls.add(hit[2]);
    const ids=new Set();
    for(const hit of content.matchAll(/\bid\s*=\s*(['"])([^'"]+)\1/g))ids.add(hit[2]);
    return {sourceFile,rpcCalls:[...calls].sort(),elementIds:[...ids].sort()};
  });
  const printed=new Set();
  for(const hit of invoice.matchAll(/\bsettings\s*\[\s*(['"])([^'"]+)\1\s*\]/g))printed.add(hit[2]);
  return {
    formatVersion:1,sourceCommit,
    methodology:'Static lexical source inventory only; not D1, auth, asset upload, browser or print parity proof',
    settings:{
      editableKeys:array('SETTINGS_EDITABLE_KEYS'),
      numericKeys:array('SETTINGS_NUMERIC_KEYS'),
      booleanKeys:array('SETTINGS_BOOLEAN_KEYS'),
      logo:{maxBytes,allowedMime:array('INVOICE_LOGO_ALLOWED_MIME')},
      endpoints
    },
    pages,invoiceRendererSettings:[...printed].sort()
  };
};
export const assertM09SettingsInvoiceSnapshot = function assertM09SettingsInvoiceSnapshot(current,snapshot){
  if(JSON.stringify(current)!==JSON.stringify(snapshot))
    throw new Error('M09 settings invoice contract snapshot drift; review source before updating');
  return true;
};
const isCli=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isCli){
  (async()=>{
    const mode=process.argv[2];
    if(process.argv.length!==3||!['--check','--write'].includes(mode))
      throw new Error('Usage: node scripts/audit-m09-settings-invoice.mjs --check|--write');
    const root=new URL('../',import.meta.url);
    const manifest=JSON.parse(await readFile(new URL('docs/baseline/source-manifest.json',root),'utf8'));
    const files=['Settings.gs','Invoice.gs','settings.html','invoiceDesign.html'];
    const sources=Object.fromEntries(await Promise.all(files.map(async name=>[
      name,await readFile(new URL('legacy/source/'+name,root),'utf8')
    ])));
    const actual=auditM09SettingsInvoiceContracts({sources,sourceCommit:manifest.source.commit});
    const path=new URL('docs/baseline/m09-settings-invoice-contract-inventory.json',root);
    if(mode==='--write'){
      await writeFile(path,JSON.stringify(actual,null,2)+'\n','utf8');
      process.stdout.write('M09 settings invoice contract inventory written (source-only)\n');
    }else{
      assertM09SettingsInvoiceSnapshot(actual,JSON.parse(await readFile(path,'utf8')));
      process.stdout.write('M09 settings and invoice contracts verified (source-only)\n');
    }
  })().catch(error=>{
    console.error('M09 settings contract rejected: '+error.message);
    process.exitCode=1;
  });
}
