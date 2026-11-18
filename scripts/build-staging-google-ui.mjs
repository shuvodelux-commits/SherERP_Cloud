import {constants} from 'node:fs';
import {copyFile,cp,lstat,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';

const [inputArg,outputArg]=process.argv.slice(2);
if(!inputArg || !outputArg)throw new Error('Provide the normal build and a fresh staging output directory');
const input=resolve(inputArg);
const output=resolve(outputArg);
if(output===input || output.startsWith(input+sep))throw new Error('Use a separate staging output directory');

const entry=resolve(input,'index.html');
const browserScript='staging-google-signin.js';
if(!(await lstat(entry)).isFile())throw new Error('The normal build entry must be a regular file');
const html=await readFile(entry,'utf8');
const footnote='<p class="login-footnote">';
const closing=/<\/body>\s*<\/html>\s*$/;
if(html.split(footnote).length!==2 || !closing.test(html) || html.includes('shererp-google-signin'))
  throw new Error('The original login card or compiled page changed');
const staged=html.replace(footnote,'<div id="shererp-google-signin"></div>\n    '+footnote)
  .replace(closing,'<script defer src="/staging-google-signin.js"></script>\n</body>\n</html>\n');

await mkdir(output);
await cp(input,output,{recursive:true,filter:async source=>{
  if((await lstat(source)).isSymbolicLink())throw new Error('Build assets must not contain symbolic links');
  return source!==entry && source!==resolve(input,browserScript);
}});
await writeFile(resolve(output,'index.html'),staged,{flag:'wx'});
await copyFile(new URL('../src/ui/staging-google-signin.js',import.meta.url),
  resolve(output,browserScript),constants.COPYFILE_EXCL);
