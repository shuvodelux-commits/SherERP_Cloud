#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Expand only GAS HtmlService includes; never execute arbitrary template code. */
export async function buildFrontend({sourceDir, outputDir}) {
  const src = resolve(sourceDir);
  const dest = resolve(outputDir);
  let includeCount=0;
  const expand=async (name, stack=[]) => {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      throw new Error('Invalid include name: '+name);
    }
    if (stack.includes(name)) throw new Error('Include cycle: '+[...stack,name].join(' -> '));
    let input;
    try {
      input=await readFile(join(src,name+'.html'),'utf8');
    } catch (error) {
      throw new Error('Missing or unreadable include '+name+': '+error.message);
    }
    const pattern=/<\?!=\s*include\s*\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)\s*;?\s*\?>/g;
    const segments=[];
    let pos=0;
    for (const m of input.matchAll(pattern)) {
      segments.push(input.slice(pos,m.index));
      includeCount++;
      segments.push(await expand(m[1],[...stack,name]));
      pos=m.index+m[0].length;
    }
    segments.push(input.slice(pos));
    const output=segments.join('');
    if (/<\?(?:=|!=|\s|\w)/.test(output)) {
      throw new Error('Unsupported GAS template instruction in '+name+'.html');
    }
    return output;
  };
  const html=await expand('index');
  await mkdir(dest,{recursive:true});
  const outputPath=join(dest,'index.html');
  await writeFile(outputPath,html,'utf8');
  return {outputPath,includeCount};
}

if (process.argv[1] && resolve(process.argv[1])===new URL(import.meta.url).pathname) {
  try {
    const result=await buildFrontend({
      sourceDir: process.argv[2] || 'legacy/source',
      outputDir: process.argv[3] || 'dist',
    });
    console.log('M01 assembled '+result.includeCount+' includes into '+result.outputPath);
  } catch (error) {
    console.error('M01 build failed: '+error.message);
    process.exitCode=1;
  }
}
