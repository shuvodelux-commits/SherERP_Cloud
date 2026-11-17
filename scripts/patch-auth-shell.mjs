#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

// Only compiled output is patched. The frozen GAS javascript.html remains
// source-of-truth and unchanged. Pre-login branding uses the existing static
// fallback; never request a private D1 app shell before a session exists.
const ORIGINAL=[
  '  function getAppShellDataOnce_() {',
  '    if (!appShellDataPromise_) {',
  "      appShellDataPromise_ = serverCall('getAppShellData').catch(function (err) {"
].join('\n');
const PATCHED=[
  '  function getAppShellDataOnce_() {',
  "    if (!authToken) return Promise.reject(new Error('Session required'));",
  '    if (!appShellDataPromise_) {',
  "      appShellDataPromise_ = serverCall('getAppShellData', authToken).catch(function (err) {"
].join('\n');

export function patchAuthenticatedShellCall(html){
  if(typeof html!=='string')throw new TypeError('Missing compiled app shell HTML source');
  const patchedAt=html.indexOf(PATCHED);
  if(patchedAt>=0){
    if(html.indexOf(PATCHED,patchedAt+PATCHED.length)>=0 ||
       html.includes(ORIGINAL))
      throw new Error('Duplicate or inconsistent compiled app shell boundary');
    return html;
  }
  const at=html.indexOf(ORIGINAL);
  if(at<0||html.indexOf(ORIGINAL,at+ORIGINAL.length)>=0)
    throw new Error('Original compiled app shell source boundary changed');
  // The login handler must assign authToken *before* loading app shell.
  if(!html.includes('authToken = payload.token;') ||
     !html.includes("serverCall('validateSession', saved)"))
    throw new Error('Original login/session sequence changed');
  return html.slice(0,at)+PATCHED+html.slice(at+ORIGINAL.length);
}

if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const file=process.argv[2]||'dist/index.html';
  try{
    const html=await readFile(file,'utf8');
    await writeFile(file,patchAuthenticatedShellCall(html),'utf8');
    console.log('Private app shell bearer patch applied to compiled '+file);
  }catch(error){
    console.error('M04 app shell patch rejected: '+error.message);
    process.exitCode=1;
  }
}
