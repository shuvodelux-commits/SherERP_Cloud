#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const READ_HELPERS=['getAllRows_','getSheetHeaders_','findRowIndex_','findRow_','findRows_','findFirstRow_'];
const WRITE_HELPERS=['appendRow_','appendRows_','updateRowFields_','deleteRow_'];
const DIRECT_RANGE=['getSheet_','getRange','getValues','setValues','setValue','deleteRow'];
const GAS_SERVICES=['SpreadsheetApp','HtmlService','LockService','PropertiesService','CacheService','Utilities','Session','ScriptApp','google.script.run'];

function safeSource(source) {
  // A source-discovery aid, not a full JavaScript parser. Comments and string
  // literals do not imply live calls. No source text is emitted to reports.
  return source
    .replace(/\/\*[\s\S]*?\*\//g,'')
    .replace(/(^|\s)\/\/[^\n]*/g,'$1')
    .replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*?\1/g,'""');
}

function count(text,pattern) {
  return [...text.matchAll(pattern)].length;
}

function countsFor(source, names, kind) {
  const found={};
  for (const name of names) {
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const pattern=kind==='services'
      ? new RegExp('\\b'+escaped+'\\b','g')
      : new RegExp(kind==='range' && name!=='getSheet_' ? '\\.'+escaped+'\\s*\\(' : '\\b'+escaped+'\\s*\\(', 'g');
    const hits=count(source,pattern);
    if (hits) found[name]=hits;
  }
  return found;
}

function sum(counts) {return Object.values(counts).reduce((n,x)=>n+x,0);}

/** Pure, conservative, filename-only direct call inventory. Not an async call graph. */
export function summarizeLegacyCallers(files) {
  if (!files || typeof files!=='object' || Array.isArray(files)) throw new TypeError('files must be a filename-to-source map');
  const modules=[];
  const sourceHash=createHash('sha256');
  const totals={readCalls:0,writeCalls:0,directRangeCalls:0,gasServiceCalls:0};
  for (const file of Object.keys(files).sort()) {
    const raw=files[file];
    if(typeof raw!=='string') throw new TypeError('Invalid source text for '+file);
    if(!/^[a-zA-Z0-9_.-]+\.gs$/.test(file)) throw new TypeError('Invalid source filename');
    sourceHash.update(file).update('\0').update(raw).update('\0');
    const text=safeSource(raw)
      .replace(/\b(?:async\s+)?function\s+(?:getAllRows_|getSheetHeaders_|findRowIndex_|findRow_|findRows_|findFirstRow_|appendRow_|appendRows_|updateRowFields_|deleteRow_|getSheet_)\s*\(/g,'function __original_definition__(');
    const readHelpers=countsFor(text,READ_HELPERS,'calls');
    const writeHelpers=countsFor(text,WRITE_HELPERS,'calls');
    const directRange=countsFor(text,DIRECT_RANGE,'range');
    const gasServices=countsFor(text,GAS_SERVICES,'services');
    totals.readCalls+=sum(readHelpers);
    totals.writeCalls+=sum(writeHelpers);
    totals.directRangeCalls+=sum(directRange);
    totals.gasServiceCalls+=sum(gasServices);
    if(sum(readHelpers)+sum(writeHelpers)+sum(directRange)+sum(gasServices)) {
      modules.push({file,readHelpers,writeHelpers,directRange,gasServices});
    }
  }
  return {formatVersion:1,scanKind:'lexical-direct-calls',sourceFiles:Object.keys(files).length,sourceDigestSha256:sourceHash.digest('hex'),modulesWithCalls:modules.length,totals,modules};
}

async function main() {
  const sourceDir=join(ROOT,'legacy/source');
  const filenames=(await readdir(sourceDir)).filter(x=>x.endsWith('.gs')).sort();
  const sources={};
  for(const file of filenames) sources[file]=await readFile(join(sourceDir,file),'utf8');
  const inventory=summarizeLegacyCallers(sources);
  if(process.argv.includes('--check')) {
    const baseline=JSON.parse(await readFile(join(ROOT,'docs/baseline/m03-direct-call-inventory.json'),'utf8'));
    if(JSON.stringify(baseline)!==JSON.stringify(inventory)) throw new Error('M03 direct-call inventory drifted; source changes require review');
    process.stdout.write('M03 direct-call inventory matches baseline: '+inventory.sourceFiles+' source files\n');
  } else {
    process.stdout.write(JSON.stringify(inventory,null,2)+'\n');
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error('M03 direct-call audit failed: '+error.message);process.exitCode=1;});
}
