#!/usr/bin/env node
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildFrontend} from './build-frontend.mjs';
import {patchServerCall} from './patch-rpc.mjs';
import {patchAuthenticatedShellCall} from './patch-auth-shell.mjs';
import {patchPosV2HiddenVisibility} from './patch-posv2-visibility.mjs';
import {patchM01Accessibility} from './patch-m01-a11y.mjs';
import {installM01ProductsPreviewAssets,patchM01ProductsPreview} from './patch-m01-products-preview.mjs';

const ownerNotice='<div id="owner-data-notice" role="status" style="padding:10px 16px;background:#fff4ce;color:#573b00;border-bottom:1px solid #e8c86b;font-weight:600;">Business data is not connected. ERP screens are visible, but reads and saves are unavailable.</div>';
const ownerLogin=`<div id="loginOverlay" class="login-overlay" hidden>
  <div class="login-card"><div class="login-brand">SherERP Cloud</div>
    <h2 class="login-title">Owner session required</h2>
    <p>Your session could not be restored. Sign in again to continue.</p>
    <a href="/">Return to Owner sign-in</a>
  </div>
</div>`;

export function patchOwnerApp(html){
  if(typeof html!=='string')throw new TypeError('Missing compiled ERP frontend');
  const overlay=/<div id="loginOverlay" class="login-overlay" hidden>[\s\S]*?\n<\/div>/g;
  const overlays=[...html.matchAll(overlay)];
  if(overlays.length!==1)throw new Error('Expected exactly one original staff login form');
  if(html.includes('id="owner-data-notice"'))throw new Error('Owner ERP notice already installed');
  const app='<div id="app" style="visibility:hidden;">';
  const main='<div class="main">\n      <header class="topbar">';
  if(html.split(app).length!==2||html.split(main).length!==2)throw new Error('Original ERP app shell boundary changed');
  html=html.replace(overlay,ownerLogin).replace(main,'<div class="main">\n      '+ownerNotice+'\n      <header class="topbar">');

  const start='  function bootstrapSession_() {';
  const next='\n  function wireLoginForm_() {';
  const a=html.indexOf(start),b=html.indexOf(next,a);
  if(a<0||b<0||html.indexOf(start,a+start.length)>=0)throw new Error('Owner session bootstrap boundary changed');
  const bootstrap=`  function bootstrapSession_() {
    fetch('/api/owner/auth/session', {credentials:'same-origin',cache:'no-store'})
      .then(function (response) {
        if (!response.ok) throw new Error('Owner session unavailable');
        return response.json();
      })
      .then(function (session) {
        if (!session || session.role !== 'Owner' ||
            typeof session.shopId !== 'string' ||
            !/^[0-9a-f-]{36}$/.test(session.shopId) ||
            typeof session.dashboard?.displayName !== 'string' ||
            session.dashboard.dataAvailable !== false) {
          throw new Error('Invalid Owner session');
        }
        onAuthenticated_({role:'Owner',shopId:session.shopId,shopName:session.dashboard.displayName,
          user:{id:session.shopId,name:session.dashboard.displayName,mobile:'',role:'Owner'}});
      })
      .catch(function () { window.location.replace('/'); });
  }
`;
  html=html.slice(0,a)+bootstrap+html.slice(b);

  const authStart='  function onAuthenticated_(payload) {';
  const authEnd='\n  function doLogout_() {';
  const c=html.indexOf(authStart),d=html.indexOf(authEnd,c);
  if(c<0||d<0||html.indexOf(authStart,c+authStart.length)>=0)throw new Error('Original authenticated handler changed');
  const authenticated=`  function onAuthenticated_(payload) {
    if (!payload || payload.role !== 'Owner' || typeof payload.shopId !== 'string' ||
        !payload.user || payload.user.role !== 'Owner') throw new Error('Invalid Owner session');
    authToken = '';
    currentUser = payload.user;
    allowedModules = null;
    userPermissions = null;
    hideLogin_();
    return loadAppShell_();
  }
`;
  html=html.slice(0,c)+authenticated+html.slice(d);

  const shellGuard="    if (!authToken) return Promise.reject(new Error('Session required'));\n";
  if(html.split(shellGuard).length!==2)throw new Error('Compiled Owner shell auth guard changed');
  html=html.replace(shellGuard,'');

  const rpcStart='  function serverCall(fnName) {';
  const rpcEnd='  // ---------------- 6. Shared across every page ----------------';
  const e=html.indexOf(rpcStart),f=html.indexOf(rpcEnd,e);
  if(e<0||f<0||html.indexOf(rpcStart,e+rpcStart.length)>=0)throw new Error('Original RPC wrapper changed');
  const rpc=`  function serverCall(fnName) {
    var path, method = 'GET';
    if (fnName === 'getAppShellData') path = '/api/owner/app-shell';
    else if (fnName === 'logout') { path = '/api/owner/auth/logout'; method = 'POST'; }
    else return Promise.reject(new Error('Shop business data is not connected yet.'));
    return fetch(path, {method:method,credentials:'same-origin',cache:'no-store'})
      .then(function (response) {
        return response.json().catch(function () { throw new Error('Owner request failed.'); })
          .then(function (result) {
            if (!response.ok) throw new Error('Owner session is unavailable.');
            return result && result.data !== undefined ? result.data : result;
          });
      });
  }

`;
  html=html.slice(0,e)+rpc+html.slice(f);
  return html;
}

export async function buildOwnerFrontend({sourceDir='legacy/source',outputDir='dist-owner'}={}){
  const output=resolve(outputDir);
  const built=await buildFrontend({sourceDir,outputDir:output});
  let html=await readFile(built.outputPath,'utf8');
  html=patchM01ProductsPreview(patchM01Accessibility(
    patchPosV2HiddenVisibility(patchAuthenticatedShellCall(patchServerCall(html)))));
  await installM01ProductsPreviewAssets(output);
  html=patchOwnerApp(html);
  const indexPath=join(output,'owner-erp.html');
  await writeFile(indexPath,html,'utf8');
  await copyFile('frontend/owner-auth/index.html',built.outputPath);
  await copyFile('frontend/owner-auth/owner-auth.css',join(output,'owner-auth.css'));
  await copyFile('frontend/owner-auth/owner-auth.js',join(output,'owner-auth.js'));
  return {...built,outputDir:output,indexPath};
}

if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
  try{
    const result=await buildOwnerFrontend({sourceDir:process.argv[2]||'legacy/source',outputDir:process.argv[3]||'dist-owner'});
    console.log('Owner-authenticated ERP frontend built in '+result.outputDir);
  }catch(error){
    console.error('Owner ERP frontend build failed: '+error.message);
    process.exitCode=1;
  }
}
