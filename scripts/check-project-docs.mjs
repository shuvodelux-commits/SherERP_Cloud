#!/usr/bin/env node
// Small, read-only guard for the three authoritative project entry points.
// Historical specs/plans are evidence, not release-ready docs: do not rewrite them here.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {dirname,join,normalize,resolve} from 'node:path/posix';
import {fileURLToPath} from 'node:url';

export const CORE_DOCS=Object.freeze(['PROJECT.md','README.md','AGENTS.md']);
const MARKDOWN_LINK=/!?\[[^\]\r\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+['"][^'"]*['"])?\s*\)/g;

export function checkMarkdownLinks(source,body,tracked){
  const missing=[];
  for(const hit of body.matchAll(MARKDOWN_LINK)){
    const href=hit[1]??hit[2];
    // Remote references, fragment links and mail links are out of scope.
    if(/^(?:#|\/\/|[a-z][a-z0-9+.-]*:)/i.test(href))continue;
    let relative;
    try{relative=decodeURIComponent(href.split(/[?#]/,1)[0]);}
    catch{missing.push(source+': malformed link '+href);continue;}
    if(!relative)continue;
    const target=normalize(join(dirname(source),relative));
    if(!tracked.has(target))missing.push(source+': missing linked file '+target);
  }
  return missing;
}

function main(){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'})
    .split('\0').filter(Boolean));
  const checks=process.argv.slice(2).length?process.argv.slice(2):CORE_DOCS;
  const failures=[];
  for(const source of checks){
    if(!tracked.has(source)){
      failures.push('missing tracked entry point: '+source);
      continue;
    }
    const body=readFileSync(resolve(root,source),'utf8');
    failures.push(...checkMarkdownLinks(source,body,tracked));
  }
  if(failures.length){
    console.error('Project documentation links FAILED:\n'+failures.join('\n'));
    process.exitCode=1;
    return;
  }
  console.log('Project documentation links OK ('+checks.length+' core files).');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
