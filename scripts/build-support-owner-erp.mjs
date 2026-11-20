#!/usr/bin/env node
/**
 * Generate the read-only Support ERP UI from THE SAME compiled Owner frontend.
 * No custom ERP screens, no cloned business logic, no git-committed HTML.
 * Admin Worker authorizes support APIs. The UI is defense-in-depth only.
 */
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {buildOwnerFrontend} from './build-owner-frontend.mjs';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const SESS='/api/platform/support/erp/session';
const ACTIVITY='/api/platform/support/erp/activity';
const mainMarker='<div class="main">\n      ';
const sessionStart='  function bootstrapSession_() {';
const sessionEnd='\n  function wireLoginForm_() {';
const rpcMarker='  function serverCall(fnName) {';
const authMarker="if (!payload || payload.role !== 'Owner' || typeof payload.shopId !== 'string' ||\n        !payload.user || payload.user.role !== 'Owner')";

const style=`<style id="support-erp-readonly-style">
  #support-erp-banner {position:sticky;top:0;z-index:500;background:#103a38;color:#fff;padding:11px 15px;
    font:600 13px/1.5 system-ui,sans-serif;box-shadow:0 2px 6px #0b413d22}
  #support-erp-banner strong{font-size:14px}
  #support-erp-banner span{display:inline-block;font-weight:400;margin-left:10px}
  #support-erp-banner a,#support-erp-banner button{display:inline-flex;margin-left:10px;padding:6px 10px;
    border-radius:5px;border:1px solid #fff7;color:#fff;background:#ffffff18;font:600 12px system-ui;cursor:pointer}
  #support-erp-log[hidden]{display:none!important}
  #support-erp-log{background:#fff;border:1px solid #d1d9df;padding:14px;margin:12px 16px;
    border-radius:8px;max-height:340px;overflow:auto;color:#1d2939;font:13px/1.5 system-ui}
  #support-erp-log li{padding:7px 0;border-bottom:1px solid #ebeff2}
  #support-erp-log small{color:#667085;display:block}
  #support-erp-log ol{padding-left:20px}
  @media(max-width:600px){#support-erp-banner{position:static}#support-erp-banner span{display:block;margin-left:0}}
  @media print{#support-erp-banner,#support-erp-log{display:none!important}}
</style>`;
const banner=`<div id="support-erp-banner" role="status">
  <strong>Super Admin Support · READ ONLY</strong>
  <span id="support-erp-expiry">Time-limited access · all business writes denied</span>
  <button type="button" id="support-erp-activity-button">Shop Activity Log</button>
  <button type="button" id="support-erp-end">End Support</button>
  <a href="/" id="support-erp-exit">Return to Super Admin</a>
</div>
<section id="support-erp-log" aria-label="Shop activity log" hidden>
  <h2>Shop activity · existing business records</h2>
  <p>Actual recorded actions for this shop; no demo entries and no financial changes.</p>
  <p id="support-erp-log-status" role="status"></p>
  <ol id="support-erp-log-items"></ol>
</section>
`;

const bootstrap=`  function bootstrapSession_() {
    fetch('${SESS}',{credentials:'same-origin',cache:'no-store'})
      .then(function(response){if(!response.ok)throw Error('Support session expired');return response.json();})
      .then(function(session){
        if(!session||session.role!=='PlatformSupport'||
          typeof session.shopId!=='string'||typeof session.dashboard?.displayName!=='string'||
          !Number.isSafeInteger(session.expiresAtMs))throw Error('Invalid support session');
        var expiry=document.getElementById('support-erp-expiry');
        if(expiry)expiry.textContent='Shop: '+session.dashboard.displayName+
          ' · Expires '+new Date(session.expiresAtMs).toLocaleTimeString()+
          ' · all business writes denied';
        // A compatibility projection only: the server never issues an Owner
        // cookie or grants Owner permissions to the visiting Super Admin.
        onAuthenticated_({role:'Support',shopId:session.shopId,shopName:session.dashboard.displayName,
          user:{id:'support',name:'Super Admin Support',mobile:'',role:'Support'}});
      })
      .catch(function(){window.location.replace('/');});
    // Revoke the visible interface after a server-side expiry/revocation.
    window.setInterval(function(){
      fetch('${SESS}',{credentials:'same-origin',cache:'no-store'})
        .then(function(response){if(!response.ok)window.location.replace('/');})
        .catch(function(){window.location.replace('/');});
    },15000);
  }
`;

const script=`<script id="support-erp-activity-script">
(function(){
  'use strict';
  var button=document.getElementById('support-erp-activity-button');
  var panel=document.getElementById('support-erp-log');
  var list=document.getElementById('support-erp-log-items');
  var status=document.getElementById('support-erp-log-status');
  var end=document.getElementById('support-erp-end');
  end.addEventListener('click',async function(){
    end.disabled=true;
    try {
      var result=await fetch('${SESS}',{credentials:'same-origin',cache:'no-store'});
      if(!result.ok)throw Error('Support session expired');
      var session=await result.json();
      if(!session||session.role!=='PlatformSupport'||
        typeof session.shopId!=='string'||typeof session.operationId!=='string')
        throw Error('Invalid support session');
      var terminated=await fetch('/api/platform/support/end',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({shopId:session.shopId,operationId:session.operationId})
      });
      if(!terminated.ok)throw Error('Could not revoke support');
      window.location.replace('/');
    }catch {
      status.textContent='Could not verify End Support. Return to Admin and end the grant.';
    }finally{end.disabled=false;}
  });
  button.addEventListener('click',async function(){
    panel.hidden=!panel.hidden;
    if(panel.hidden)return;
    status.textContent='Reading recorded Shop activity…';
    list.replaceChildren();
    button.disabled=true;
    try{
      var response=await fetch('${ACTIVITY}',{method:'GET',credentials:'same-origin',cache:'no-store'});
      if(!response.ok)throw Error('Support grant expired or activity unavailable');
      var result=await response.json();
      if(result?.success!==true||!Array.isArray(result.data?.items)||result.data.items.length>60)
        throw Error('Invalid activity response');
      for(var row of result.data.items){
        if(!row||typeof row.eventType!=='string'||
          !Number.isSafeInteger(row.eventAtMs)||row.eventAtMs<=0)throw Error('Invalid activity record');
        var li=document.createElement('li');
        li.textContent=row.eventType+' · '+new Date(row.eventAtMs).toLocaleString();
        if(typeof row.reason==='string'&&row.reason){
          var small=document.createElement('small');
          small.textContent='Reason: '+row.reason;
          li.append(small);
        }
        list.append(li);
      }
      status.textContent=result.data.items.length
        ?'Recorded events for this Shop (most recent first).'
        :'No activity recorded in the available Shop log tables.';
    }catch{
      list.replaceChildren();
      status.textContent='Cannot read this Shop activity log. Check the active support grant.';
    }finally{button.disabled=false;}
  });
}());
</script>`;

export function patchSupportOwnerErp(html){
  if(typeof html!=='string'||!html.includes('id="owner-data-notice"'))
    throw Error('Owner UI build unavailable');
  if(html.split(mainMarker).length!==2)throw Error('Owner main layout changed');
  if(html.split(authMarker).length!==2)throw Error('Owner role guard changed');
  if(html.split(rpcMarker).length!==2)throw Error('Owner RPC boundary changed');
  const a=html.indexOf(sessionStart),b=html.indexOf(sessionEnd,a);
  if(a<0||b<0||html.indexOf(sessionStart,a+sessionStart.length)>=0)
    throw Error('Owner bootstrap changed');
  html=html.slice(0,a)+bootstrap+html.slice(b);
  html=html.replace(authMarker,
    "if (!payload || payload.role !== 'Support' || typeof payload.shopId !== 'string' ||\n        !payload.user || payload.user.role !== 'Support')");
  html=html.replaceAll('/api/owner/','/api/platform/support/erp/');
  html=html.replace(rpcMarker,`${rpcMarker}
    if (['addProduct','addSupplier','createPurchase','completeSale',
      'completeReturn','startCashSession','closeCashSession','logout'].includes(fnName))
      return Promise.reject(new Error('Super Admin Support is read-only. No business writes are permitted.'));
`);
  html=html.replace(mainMarker,mainMarker+style+banner);
  if(!html.includes('</body>'))throw Error('Owner document boundary changed');
  html=html.replace('</body>',script+'</body>');
  if(html.includes('/api/owner/'))throw Error('Leaked Owner API path in support view');
  return html;
}

export async function buildSupportOwnerErp({sourceDir='legacy/source',outputDir='dist-support'}={}){
  const target=resolve(outputDir);
  const built=await buildOwnerFrontend({sourceDir,outputDir:target});
  const html=await readFile(built.indexPath,'utf8');
  const readOnly=patchSupportOwnerErp(html);
  await writeFile(built.indexPath,readOnly,'utf8');
  await stat(join(target,'m05-products','m01-products-preview-controller.mjs'));
  return {path:built.indexPath,bytes:Buffer.byteLength(readOnly)};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  buildSupportOwnerErp().then(out=>console.log('Compiled original Owner ERP in read-only Support Mode',out.bytes))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
