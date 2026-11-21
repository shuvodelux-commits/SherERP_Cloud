#!/usr/bin/env node
import {copyFile,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {buildFrontend} from './build-frontend.mjs';
import {patchServerCall} from './patch-rpc.mjs';
import {patchAuthenticatedShellCall} from './patch-auth-shell.mjs';
import {patchPosV2HiddenVisibility} from './patch-posv2-visibility.mjs';
import {patchM01Accessibility} from './patch-m01-a11y.mjs';
import {installM01ProductsPreviewAssets,patchM01ProductsPreview} from './patch-m01-products-preview.mjs';
import {installOwnerHisabiqParties} from './patch-owner-hisabiq-parties.mjs';
import {installOwnerHisabiqSettings} from './patch-owner-hisabiq-settings.mjs';
import {installOwnerHisabiqUnitEditor} from './patch-owner-hisabiq-unit-editor.mjs';
import {installOwnerHisabiqPos} from './patch-owner-hisabiq-pos.mjs';

const ownerNotice='<div id="owner-data-notice" role="status" style="padding:10px 16px;background:#fff4ce;color:#573b00;border-bottom:1px solid #e8c86b;font-weight:600;">Business data is not connected. ERP screens are visible, but reads and saves are unavailable.</div>';
const ownerSupportActivity="<section id=\"owner-support-activity\" aria-label=\"Owner support activity\" hidden><div class=\"owner-support-title\">Support activity · read-only</div><p>The Super Admin support history for this shop. Only your own business is shown.</p><button type=\"button\" id=\"owner-support-refresh\" aria-controls=\"owner-support-events\">View support activity</button><p id=\"owner-support-status\" role=\"status\" aria-live=\"polite\"></p><ol id=\"owner-support-events\" aria-label=\"Recorded support actions\"></ol></section>";
const ownerSupportCss="<style>#owner-support-activity[hidden]{display:none!important}#owner-support-activity{margin:0;padding:12px 16px;background:#fff;color:#172033;border-bottom:1px solid #e4e7ec;font:14px/1.45 Arial,sans-serif;max-width:100%;overflow-wrap:anywhere}#owner-support-activity .owner-support-title{font-weight:700;margin-bottom:4px}#owner-support-activity p{margin:4px 0 8px;color:#475467}#owner-support-refresh{padding:8px 12px;min-height:36px;border-radius:6px;border:1px solid #1a56db;background:#fff;color:#123fae;font:inherit;cursor:pointer}#owner-support-refresh:focus-visible{outline:2px solid #1a56db;outline-offset:3px}#owner-support-refresh:disabled{opacity:.65;cursor:wait}#owner-support-events{padding-left:22px;margin:10px 0 0;max-width:100%}#owner-support-events li{padding:5px 0;overflow-wrap:anywhere}</style>";
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
  html=html.replace(overlay,ownerLogin).replace(main,'<div class="main">\n      '+ownerNotice+'\n      '+ownerSupportActivity+'\n      <header class="topbar">');

  const start='  function bootstrapSession_() {';
  const next='\n  function wireLoginForm_() {';
  const a=html.indexOf(start),b=html.indexOf(next,a);
  if(a<0||b<0||html.indexOf(start,a+start.length)>=0)throw new Error('Owner session bootstrap boundary changed');
  const bootstrap=`  function ownerSupportActivityInit_(session) {
    var panel = document.getElementById('owner-support-activity');
    var button = document.getElementById('owner-support-refresh');
    var status = document.getElementById('owner-support-status');
    var list = document.getElementById('owner-support-events');
    if (!panel || !button || !status || !list) return;
    panel.hidden = session.supportAuditEnabled !== true;
    list.replaceChildren();
    status.textContent = '';
    if (panel.hidden || button.dataset.wired === 'yes') return;
    button.dataset.wired = 'yes';
    button.addEventListener('click', async function () {
      button.disabled = true;
      list.replaceChildren();
      status.textContent = 'Checking your shop support activity…';
      try {
        var response = await fetch('/api/owner/support/audit', {
          method:'GET',credentials:'same-origin',cache:'no-store',
          signal:AbortSignal.timeout(8000)
        });
        if (response.status === 401) {
          panel.hidden = true;
          status.textContent = 'Sign in again to view support activity.';
          return;
        }
        if (!response.ok) throw new Error('Audit is not available');
        var body = await response.json();
        if (!body || !Array.isArray(body.events) || body.events.length > 50)
          throw new Error('Invalid support audit');
        var items = [];
        for (var row of body.events) {
          if (!row || !['START','READ','END'].includes(row.eventType) ||
              !Number.isSafeInteger(row.eventAtMs) || row.eventAtMs <= 0 ||
              typeof row.reason !== 'string' || row.reason.length > 180 ||
              typeof row.operationId !== 'string' ||
              row.actor !== 'Platform Super Admin') throw new Error('Invalid support event');
          var stamp = new Date(row.eventAtMs);
          if (!Number.isFinite(stamp.getTime())) throw new Error('Invalid event time');
          var li = document.createElement('li');
          li.textContent = row.eventType + ' · ' + stamp.toLocaleString() +
            ' · ' + row.reason + ' · Platform Super Admin';
          items.push(li);
        }
        list.replaceChildren(...items);
        status.textContent = items.length ? 'Recent support activity for this shop:' :
          'No support activity recorded.';
      } catch {
        list.replaceChildren();
        status.textContent = 'Support activity is temporarily unavailable.';
      } finally {
        button.disabled = false;
      }
    });
  }

  function bootstrapSession_() {
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
        ownerSupportActivityInit_(session);
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
  const rpc=`  var ownerProductsEnabled = false;
  var ownerProductSaveInProgress = false;
  var ownerProductPendingSave = null;

  function saveOwnerProduct_(payload) {
    if (!ownerProductsEnabled || prodState.addSource !== 'products') {
      return Promise.reject(new Error('Product creation is available from the Products page.'));
    }
    if (ownerProductSaveInProgress) return Promise.reject(new Error('Product save is in progress.'));
    var fingerprint = JSON.stringify(payload);
    if (ownerProductPendingSave?.fingerprint !== fingerprint) {
      ownerProductPendingSave = {fingerprint:fingerprint,body:JSON.stringify({
        ...payload,operationId:crypto.randomUUID()
      })};
    }
    ownerProductSaveInProgress = true;
    var save = document.getElementById('prodSaveBtn');
    save.disabled = true;
    var uncertain = 'Could not confirm save. Retry Save Product.';
    return fetch('/api/owner/catalog', {method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:ownerProductPendingSave.body
    }).catch(function () { throw new Error(uncertain); }).then(async function (response) {
      var result = await response.json().catch(function () { throw new Error(uncertain); });
      if (response.status >= 500) throw new Error(uncertain);
      if (!response.ok) throw new Error(result.message || 'Product save is unavailable.');
      if (result.success !== true || typeof result.data?.id !== 'string') throw new Error(uncertain);
      ownerProductPendingSave = null;
      return result.data;
    }).finally(function () {
      ownerProductSaveInProgress = false;
      save.disabled = false;
    });
  }

  function setOwnerProductsMode_(operational) {
    ownerProductsEnabled = operational;
    var add = document.getElementById('prodAddBtn');
    add.hidden = !operational;
    if (operational) add.style.removeProperty('display');
    else add.style.setProperty('display','none','important');
    document.documentElement.toggleAttribute('data-owner-clean-products', operational);
    document.querySelector('#prodTable [data-sort-key="purchasePrice"]').firstChild.textContent =
      operational ? 'Purchase price ' : 'Saved purchase price ';
    document.querySelector('#prodTable [data-sort-key="stockQty"]').firstChild.textContent =
      operational ? 'Opening stock ' : 'Stock at backup ';
    document.getElementById('owner-data-notice').textContent = operational
      ? 'Standard products start with zero opening stock.'
      : 'Purchase price and stock are from the backup. Stock value and saves are unavailable.';
  }

  var ownerSupplierSaveInProgress = false;
  var ownerSupplierPendingSave = null;

  function saveOwnerSupplier_(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return Promise.reject(new Error('Supplier is required.'));
    // The preserved Supplier form includes an opening-balance edit reason,
    // which is not part of the clean-Shop create contract. Do not pass it to
    // the strict D1 endpoint or silently drop a nonempty historical reason.
    if (Object.keys(payload).some(function (key) {
      return !['name','phone','address','notes','openingBalance','openingBalanceReason'].includes(key);
    }) || (payload.openingBalanceReason != null &&
      (typeof payload.openingBalanceReason !== 'string' || payload.openingBalanceReason.trim())))
      return Promise.reject(new Error('Historical opening balances are not connected.'));
    if (ownerSupplierSaveInProgress) return Promise.reject(new Error('Supplier save is in progress.'));
    var fingerprint = JSON.stringify(payload);
    if (ownerSupplierPendingSave?.fingerprint !== fingerprint) {
      ownerSupplierPendingSave = {fingerprint:fingerprint,body:JSON.stringify({
        name:payload.name,phone:payload.phone,address:payload.address,
        notes:payload.notes,openingBalance:payload.openingBalance,
        operationId:crypto.randomUUID()
      })};
    }
    ownerSupplierSaveInProgress = true;
    var saveButton = document.getElementById('supSaveBtn');
    if (saveButton) saveButton.disabled = true;
    var uncertain = 'Could not confirm supplier save. Retry Save Supplier.';
    return fetch('/api/owner/suppliers',{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:ownerSupplierPendingSave.body
    }).catch(function () { throw new Error(uncertain); }).then(async function (response) {
      var result = await response.json().catch(function () { throw new Error(uncertain); });
      if (response.status >= 500) throw new Error(uncertain);
      if (!response.ok) throw new Error(result.message || 'Supplier save is unavailable.');
      if (result.success !== true || typeof result.data?.id !== 'string') throw new Error(uncertain);
      ownerSupplierPendingSave = null;
      return result.data;
    }).finally(function () {
      ownerSupplierSaveInProgress = false;
      if (saveButton) saveButton.disabled = false;
    });
  }

  // Original paySupplier RPC: bounded same-day Cash only, replay-safe.
  // Bank, discounts and historical entries stay deliberately unavailable.
  var ownerSupplierCashPendingSave = null;
  var ownerSupplierCashSaving = false;
  function saveOwnerSupplierCash_(supplierId,amount,method,bankId,notes,date,reason,discount,discountReason) {
    if(typeof supplierId!=='string'||!/^SUP-[0-9]{6,}$/.test(supplierId))
      return Promise.reject(new Error('Invalid Supplier ID.'));
    if(method!=='Cash'||bankId||reason||Number(discount)!==0||discountReason)
      return Promise.reject(new Error('Only Cash supplier payment without a discount or Bank is connected.'));
    if(typeof amount!=='string'||!/^(?:0|[1-9][0-9]{0,8})(?:\\.[0-9]{1,2})?$/.test(amount))
      return Promise.reject(new Error('Enter a valid Cash payment amount.'));
    if(date!==new Date(Date.now()+21600000).toISOString().slice(0,10))
      return Promise.reject(new Error('Only today’s Cash supplier payment is connected.'));
    if(ownerSupplierCashSaving)
      return Promise.reject(new Error('Supplier payment is already saving.'));
    var payload={supplierId:supplierId,amount:amount,paymentMethod:'Cash',
      bankAccountId:'',notes:notes||'',date:date,backdatedReason:''};
    var fingerprint=JSON.stringify(payload);
    if(ownerSupplierCashPendingSave?.fingerprint!==undefined &&
       ownerSupplierCashPendingSave.fingerprint!==fingerprint)
      return Promise.reject(new Error('Previous payment may have been saved. Reload the Supplier ledger before changing it.'));
    if(!ownerSupplierCashPendingSave)
      ownerSupplierCashPendingSave={fingerprint:fingerprint,
        body:JSON.stringify({operationId:crypto.randomUUID(),payload:payload})};
    ownerSupplierCashSaving=true;
    return ownerPurchasePost_('/api/owner/suppliers/'+supplierId+'/cash-pay',
      ownerSupplierCashPendingSave.body,
      'Could not confirm Cash payment. Retry Pay unchanged to check the same operation.')
      .then(function(result){
        if(!result || typeof result.paymentId!=='string' ||
           result.supplierId!==supplierId || !Number.isFinite(result.currentDue))
          throw new Error('Could not verify saved Supplier payment. Retry unchanged.');
        ownerSupplierCashPendingSave=null;
        return result;
      }).finally(function(){ownerSupplierCashSaving=false;});
  }

  var ownerPurchasePendingSave = null;
  var ownerPurchaseSaveInProgress = false;
  var ownerCashPendingAction = null;

  function ownerPurchasePost_(path,body,uncertain) {
    return fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json'},body:body
    }).catch(function () { throw new Error(uncertain); }).then(async function (response) {
      var payload = await response.json().catch(function () { throw new Error(uncertain); });
      if (response.status >= 500) throw new Error(uncertain);
      if (!response.ok || payload.success !== true) {
        throw new Error(payload.message || 'Business transaction unavailable.');
      }
      return payload.data;
    });
  }

  function saveOwnerCreditPurchase_(payload) {
    if (ownerPurchaseSaveInProgress) return Promise.reject(new Error('Purchase is already saving.'));
    var fingerprint = JSON.stringify(payload);
    if (ownerPurchasePendingSave?.fingerprint !== fingerprint) {
      ownerPurchasePendingSave={fingerprint:fingerprint,body:JSON.stringify({
        operationId:crypto.randomUUID(),payload:payload
      })};
    }
    ownerPurchaseSaveInProgress=true;
    var btn=document.getElementById('purSubmitBtn');
    if (btn) btn.disabled=true;
    return ownerPurchasePost_('/api/owner/purchases',ownerPurchasePendingSave.body,
      'Could not confirm the purchase. Retry Complete Purchase to check the same operation.')
      .then(function (result) {
        if (!result || typeof result.purchaseId !== 'string')
          throw new Error('Could not confirm purchase. Retry Complete Purchase.');
        ownerPurchasePendingSave=null;
        return result;
      }).finally(function () {
        ownerPurchaseSaveInProgress=false;
        if(btn)btn.disabled=false;
      });
  }

  // One read-only, Owner-authorized physical cash carry suggestion.
  // Never assume a previous drawer was emptied without a cash movement.
  function ownerNextOpeningCash_() {
    return fetch('/api/owner/cash-session/next-opening',{
      method:'GET',credentials:'same-origin',cache:'no-store'
    }).then(function(response) {
      return response.json().then(function(body){
        if(!response.ok || body.success!==true ||
            !Number.isFinite(Number(body.data?.openingCash)) ||
            Number(body.data.openingCash)<0)
          throw new Error('Cannot verify the previous counted cash. Reload Cash Session.');
        return Number(body.data.openingCash);
      });
    });
  }

  // The original Cash Session topbar opens a dialog without a new RPC
  // method. Add one private, read-only count suggestion on that same click,
  // instead of depending on a separate asynchronous summary response path.
  // This preserves the legacy event handlers and never overwrites edits.
  document.addEventListener('DOMContentLoaded',function(){
    var toggle=document.getElementById('cashSessionToggleBtn');
    if(!toggle)return;
    toggle.addEventListener('click',function(){
      if(typeof posState==='undefined'||posState.activeSession)return;
      var field=document.getElementById('posOpeningCash');
      if(!field)return;
      var before=field.value;
      ownerNextOpeningCash_().then(function(opening){
        if(field.value===before)field.value=opening.toFixed(2);
      }).catch(function(error){
        showToast(error.message||'Unable to verify previous drawer cash.','error');
      });
    });
  });

  function ownerCashAction_(type,amount,notes) {
    var path=type==='startCashSession'?'/api/owner/cash-session/start':'/api/owner/cash-session/close';
    var intent={operationId:crypto.randomUUID(),notes:notes||''};
    if(type==='startCashSession')intent.openingCash=amount;
    else intent.countedCash=amount;
    var fingerprint=type+JSON.stringify({amount,notes});
    if(ownerCashPendingAction?.fingerprint!==fingerprint)
      ownerCashPendingAction={fingerprint:fingerprint,body:JSON.stringify(intent)};
    return ownerPurchasePost_(path,ownerCashPendingAction.body,
      'Could not confirm Cash Session. Retry the same action.')
      .then(function (result) {ownerCashPendingAction=null;return result;});
  }

  function ownerPurchaseDayBar_(session) {
    var page=document.getElementById('page-purchase');
    if(!page)return;
    var bar=document.getElementById('owner-purchase-day-bar');
    if(!bar) {
      bar=document.createElement('div');
      bar.id='owner-purchase-day-bar';
      bar.setAttribute('role','status');
      bar.style.cssText='padding:10px 12px;margin:8px 0 12px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
      var label=document.createElement('span');
      label.id='owner-purchase-day-state';
      var start=document.createElement('button');
      start.type='button';
      start.className='btn btn-primary';
      start.id='owner-purchase-start-day';
      start.textContent='Start Day (0 opening cash)';
      start.addEventListener('click',function(){
        start.disabled=true;
        ownerNextOpeningCash_().then(function(openingCash){
          return ownerCashAction_('startCashSession',openingCash,'MVP shop daily opening');
        }).then(function(r){ownerPurchaseDayBar_({sessionId:r.sessionId,status:'Open'});})
          .catch(function(e){showToast(e.message,'error');})
          .finally(function(){start.disabled=false;});
      });
      bar.append(label,start);
      page.prepend(bar);
    }
    var active=session?.status==='Open';
    document.getElementById('owner-purchase-day-state').textContent=active
      ?'Day Open · Original Cash Session records Sale, Return and counted daily cash.'
      :'Start Day before purchasing. Unpaid purchases only; payments, returns and Tiles are not connected.';
    document.getElementById('owner-purchase-start-day').hidden=active;
    if(!active){
      // Suggest a verified opening before posting, but re-read on click.
      ownerNextOpeningCash_().then(function(value){
        var b=document.getElementById('owner-purchase-start-day');
        if(b&&!b.hidden)b.textContent='Start Day (opening '+value.toFixed(2)+')';
      }).catch(function(){
        var b=document.getElementById('owner-purchase-start-day');
        if(b&&!b.hidden)b.textContent='Start Day (verify previous counted cash)';
      });
    }
    document.getElementById('owner-data-notice').textContent=
      'Shop D1 supports credit Purchase, one-product Cash POS and opt-in original Cash Returns. Split payments, Customer Due, Store Credit and full ledgers are not connected.';
  }

  // Source POS still calls completeSale(authToken,payload). Only this
  // private Owner adapter can submit the narrowly authorized real cash MVP.
  // An uncertain response MUST retry the identical payload and operation ID.
  var ownerSalePendingSave = null;
  var ownerSaleSaveInProgress = false;

  function saveOwnerCashSale_(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return Promise.reject(new Error('Invalid POS checkout.'));
    if (ownerSaleSaveInProgress)
      return Promise.reject(new Error('Sale already saving.'));
    var fingerprint=JSON.stringify(payload);
    if (ownerSalePendingSave && ownerSalePendingSave.fingerprint!==fingerprint)
      return Promise.reject(new Error('Previous checkout changed. Reload and review the original sale before posting again.'));
    if (!ownerSalePendingSave) {
      ownerSalePendingSave={fingerprint:fingerprint,body:JSON.stringify({
        operationId:payload.operationId || crypto.randomUUID(),payload:payload
      })};
    }
    ownerSaleSaveInProgress=true;
    return ownerPurchasePost_('/api/owner/pos/sales',ownerSalePendingSave.body,
      'Could not confirm the Sale. Retry Complete Sale unchanged to check the same transaction.')
      .then(function(invoice){
        if(!invoice || typeof invoice.invoiceId!=='string' || !Array.isArray(invoice.items))
          throw new Error('Could not confirm saved invoice. Retry unchanged checkout.');
        ownerSalePendingSave=null;
        return invoice;
      }).finally(function(){ownerSaleSaveInProgress=false;});
  }

  var ownerReturnPendingSave = null;
  var ownerReturnSaveInProgress = false;

  function saveOwnerCashReturn_(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      return Promise.reject(new Error('Invalid Sales Return.'));
    if (ownerReturnSaveInProgress)
      return Promise.reject(new Error('Return already saving.'));
    var fingerprint=JSON.stringify(payload);
    if (ownerReturnPendingSave && ownerReturnPendingSave.fingerprint!==fingerprint)
      return Promise.reject(new Error('Previous refund changed. Reload the original invoice before posting again.'));
    if (!ownerReturnPendingSave) {
      ownerReturnPendingSave={fingerprint:fingerprint,body:JSON.stringify({
        operationId:payload.operationId || crypto.randomUUID(),payload:payload
      })};
    }
    ownerReturnSaveInProgress=true;
    return ownerPurchasePost_('/api/owner/returns',ownerReturnPendingSave.body,
      'Could not confirm the Return. Retry Complete Return unchanged to check the same transaction.')
      .then(function(result){
        if (!result || typeof result.returnId!=='string' ||
            !Number.isFinite(Number(result.totalReturnAmount)))
          throw new Error('Could not confirm saved Return. Retry unchanged.');
        ownerReturnPendingSave=null;
        return result;
      }).finally(function(){ownerReturnSaveInProgress=false;});
  }

  function supplierDisplayAmount_(paisa) {
    if (!Number.isSafeInteger(paisa)) throw new Error('Supplier purchase ledger is unavailable.');
    var amount = paisa / 100;
    // The original ledger uses Intl with at most two decimals. Verify its displayed minor units.
    var decimal = amount.toLocaleString('en-US', {useGrouping:false,minimumFractionDigits:2,maximumFractionDigits:2});
    if (BigInt(decimal.replace('.', '')) !== BigInt(paisa))
      throw new Error('The supplier ledger cannot display this amount accurately.');
    return amount;
  }

  function serverCall(fnName) {
    if (fnName === 'addProduct') return saveOwnerProduct_(arguments[2]);
    if (fnName === 'addSupplier') return saveOwnerSupplier_(arguments[2]);
    if (fnName === 'paySupplier') return saveOwnerSupplierCash_(arguments[2],arguments[3],
      arguments[4],arguments[5],arguments[6],arguments[7],arguments[8],arguments[9],arguments[10]);
    if (fnName === 'createPurchase') return saveOwnerCreditPurchase_(arguments[2]);
    if (fnName === 'completeSale') return saveOwnerCashSale_(arguments[2]);
    if (fnName === 'completeReturn') return saveOwnerCashReturn_(arguments[2]);
    if (fnName === 'startCashSession'||fnName === 'closeCashSession')
      return ownerCashAction_(fnName,arguments[2],arguments[3]);
    var path, method = 'GET';
    if (fnName === 'getAppShellData') path = '/api/owner/app-shell';
    else if (fnName === 'getProductsBootstrap') path = '/api/owner/catalog';
    else if (fnName === 'getSuppliersBootstrap') path = '/api/owner/suppliers';
    else if (fnName === 'getSupplierDetail') {
      var supplierId = arguments[2];
      if (typeof supplierId !== 'string' || !/^SUP-[0-9]{6}$/.test(supplierId))
        return Promise.reject(new Error('Invalid supplier ID.'));
      path = '/api/owner/suppliers/' + supplierId + '/ledger';
    }
    else if (fnName === 'getPurchaseBootstrap') path = '/api/owner/purchase/bootstrap';
    else if (fnName === 'getPosBootstrap') path = '/api/owner/pos/bootstrap';
    else if (fnName === 'getSalesDraftList') path = '/api/owner/pos/drafts';
    else if (fnName === 'searchInvoicesForReturn') {
      var search=arguments[2];
      if(typeof search!=='string'||!search.trim()||search.length>80)
        return Promise.reject(new Error('Enter an invoice ID or phone number.'));
      path='/api/owner/returns/search/'+encodeURIComponent(search.trim());
    }
    else if (fnName === 'getInvoiceForReturn') {
      var returnInvoice=arguments[2];
      if(typeof returnInvoice!=='string'||!/^INV-[0-9]{6,}$/.test(returnInvoice))
        return Promise.reject(new Error('Invalid Return invoice ID.'));
      path='/api/owner/returns/invoices/'+returnInvoice;
    }
    else if (fnName === 'findInvoice') {
      var invoiceId=arguments[2];
      if(typeof invoiceId!=='string'||!/^INV-[0-9]{6,}$/.test(invoiceId))
        return Promise.reject(new Error('Invalid Invoice ID.'));
      path='/api/owner/pos/invoices/'+invoiceId;
    }
    else if (fnName === 'getPurchaseManagementList') path = '/api/owner/purchases';
    else if (fnName === 'getCashSessionSummary') path = '/api/owner/cash-session';
    else if (fnName === 'getPurchaseDetail') {
      var purchaseId=arguments[2];
      if(typeof purchaseId !== 'string'||!/^PUR-[0-9]{6,}$/.test(purchaseId))
        return Promise.reject(new Error('Invalid Purchase ID.'));
      path='/api/owner/purchases/'+purchaseId;
    }
    else if (fnName === 'logout') { path = '/api/owner/auth/logout'; method = 'POST'; }
    else return Promise.reject(new Error('Shop business data is not connected yet.'));
    return fetch(path, {method:method,credentials:'same-origin',cache:'no-store'})
      .then(function (response) {
        if (response.status === 401) throw new Error('Your session expired. Sign in again.');
        var unavailable = fnName === 'getProductsBootstrap' ? 'Product catalog is unavailable.' :
          fnName === 'getSuppliersBootstrap' ? 'Supplier list is unavailable.' :
          fnName === 'getSupplierDetail' ? 'Supplier purchase ledger is unavailable.' :
          fnName.startsWith('getPurchase') ? 'Purchase data is unavailable.' :
          fnName === 'getPosBootstrap' || fnName === 'getSalesDraftList' || fnName === 'findInvoice' ? 'POS data is unavailable.' :
          fnName === 'searchInvoicesForReturn' || fnName === 'getInvoiceForReturn' ? 'Returns data is unavailable.' :
          fnName === 'getCashSessionSummary' ? 'Cash session data is unavailable.' : 'Owner session is unavailable.';
        if (!response.ok) throw new Error(unavailable);
        return response.json().catch(function () { throw new Error(unavailable); })
          .then(function (result) {
            if (result?.success === false) throw new Error(unavailable);
            if (fnName === 'getSupplierDetail') {
              var detail = result?.data;
              if (result?.success !== true || !['purchase-credit-only','purchase-and-cash-payment'].includes(detail?.scope) ||
                  detail.supplierId !== supplierId || !Array.isArray(detail.entries) ||
                  typeof detail.hasMore !== 'boolean') throw new Error(unavailable);
              return {
                supplier:{'Supplier ID':supplierId,'Supplier Name':detail.supplierName,
                  Phone:detail.phone,'Current Due':supplierDisplayAmount_(detail.currentDuePaisa)},
                ledger:detail.entries.map(function (entry) {
                  if (!['Purchase','Supplier Payment'].includes(entry.kind))
                    throw new Error(unavailable);
                  return {Type:entry.kind,Date:entry.purchaseDate,Reference:entry.reference,
                    Debit:supplierDisplayAmount_(entry.debitPaisa),Credit:supplierDisplayAmount_(entry.creditPaisa),
                    Balance:supplierDisplayAmount_(entry.balancePaisa)};
                }),
                hasMore:detail.hasMore,cashPayAvailable:detail.cashPayAvailable===true,
                ledgerScope:detail.scope
              };
            }
            if (fnName === 'getProductsBootstrap') {
              var operational = result.mode === 'operational';
              var products = result.data.map(function (row) {
                return {'Product ID':row.productId,'Product Name':row.name, 'Brand':row.brand,
                  'Category':row.category,'Unit':row.unit,'Selling Price':row.listedPrice,
                  'Purchase Price':row.savedPurchasePrice,'Current Stock':operational ? row.stock : row.stockAtBackup};
              });
              setOwnerProductsMode_(operational);
              if (operational) return {products:products,units:result.units,categories:result.categories};
              return {products:products,units:[],categories:Array.from(new Set(products.map(function (row) {
                return row.Category;
              }).filter(Boolean))).map(function (name) { return {name:name}; })};
            }
            if (fnName === 'getPurchaseBootstrap' && result?.success===true) {
              ownerPurchaseDayBar_(result.data.cashSession);
            }
            return result && result.data !== undefined ? result.data : result;
          });
      });
  }

`;
  html=html.slice(0,e)+rpc+html.slice(f);
  html=html.replace('</head>', '<style>[data-owner-clean-products] #m01ProductUnitPanel {display:none!important}</style></head>');
  html=html.replace('</head>',ownerSupportCss+'</head>');
  const screenReplacements=[
    ['id="supDetailDue"></div></div>\n        <div class="mobile-payment-workspace" style="',
      'id="supDetailDue"></div></div>\n        <fieldset id="owner-supplier-cash-pay" disabled aria-label="Cash supplier payment" class="mobile-payment-workspace" style="border:0;padding:0;margin:0;'],
    ['id="supPayError"></div>\n        </div>', 'id="supPayError"></div>\n        </fieldset>'],
    ['<div class="empty-state" id="supLedgerEmpty"', '<p id="ownerSupplierLedgerScope"></p><div class="empty-state" id="supLedgerEmpty"'],
    ["withLoader(serverCall('getSupplierDetail', authToken, id)).then(function (data) {",
      "withLoader(serverCall('getSupplierDetail', authToken, id)).then(function (data) {\n    if (supState.detailId !== id) return;"],
    ['    supState.ledger = data.ledger;', `
    document.getElementById('owner-supplier-cash-pay').disabled = !data.cashPayAvailable;
    document.getElementById('ownerSupplierLedgerScope').textContent =
      (data.cashPayAvailable ? 'Cash supplier payments only. No discount, Bank or backdating.' :
        data.ledgerScope === 'purchase-and-cash-payment'
          ? 'Credit purchases and recorded Cash payments. New payment entry is not enabled.'
          : 'Credit purchases only. Supplier payments are unavailable.') +
      (data.hasMore ? ' Showing the latest 50 ledger entries.' : '');
    supState.ledger = data.ledger;`],
    ["    prodState.addSource = source || 'products';", `    prodState.addSource = source || 'products';
    if (ownerProductsEnabled) {
      ['prodType','prodManageCategoriesBtn','prodManageUnitsBtn'].forEach(function (id) {
        document.getElementById(id).disabled = true;
      });
    }`],
    ["    document.getElementById('prodStock').disabled = false;\n    document.getElementById('prodFormError').style.display = 'none';",
      "    document.getElementById('prodStock').disabled = ownerProductsEnabled;\n    document.getElementById('prodFormError').style.display = 'none';"],
    ['id="prodAddBtn"', 'id="prodAddBtn" hidden style="display:none!important"'],
    ['id="prodUnpricedLotsBtn"', 'id="prodUnpricedLotsBtn" hidden style="display:none!important"'],
    ['No products yet. Click "Add Product" or load demo data from the Sheet menu.', 'No matching products.'],
    ['data-sort-key="purchasePrice">Purchase ', 'data-sort-key="purchasePrice">Saved purchase price '],
    ['data-sort-key="stockQty">Stock ', 'data-sort-key="stockQty">Stock at backup '],
    ["(isBundle ? '—' : formatMoney(p['Purchase Price']))","escapeHtml(p['Purchase Price'] ?? 'Unavailable')"],
    ["formatMoney(p['Selling Price']) + '</span></td>'","escapeHtml(p['Selling Price'] || 'Unavailable') + '</span></td>'"],
    ["escapeHtml(p['Product Name']) + '</div></td>'","escapeHtml(p['Product Name']) + '</div>' + escapeHtml(p['Unit'] || '') + '</td>'"],
    ["+ stockCell + '</td>'","+ escapeHtml(p['Current Stock'] ?? 'Unavailable') + '</td>'"],
    ["(isBundle ? '—' : formatMoney(p['Stock Value']))","'Unavailable'"],
  ];
  for(const [original,replacement] of screenReplacements){
    if(html.split(original).length!==2)throw new Error('Owner screen boundary changed: '+original);
    html=html.replace(original,replacement);
  }
  // Cash-only pilot: preserve original Supplier form but do not offer
  // unsupported Bank, discount, settlement discount or backdating controls.
  const cashOnlySourceReplacements=[
    ['<select id="supPayMethod" style="max-width:120px;"><option value="Cash">Cash</option><option value="Bank">Bank</option><option value="Mobile Banking">Mobile Banking</option></select>',
      '<select id="supPayMethod" style="max-width:120px;"><option value="Cash">Cash</option></select>'],
    ["document.getElementById('supPayDiscount').disabled = !canDiscount;",
      "document.getElementById('supPayDiscount').disabled = true;"],
    ["document.getElementById('supPaySettleFullBtn').disabled = !canDiscount || payment <= 0 || payment > supState.detailDue;",
      "document.getElementById('supPaySettleFullBtn').disabled = true;"],
    ['<label>Payment Date</label><input id="supPayDate" type="date">',
      '<label>Payment Date (today)</label><input id="supPayDate" type="date" readonly>'],
    ["  function supPayToday_() {\n    var d = new Date();\n    var m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');\n    return d.getFullYear() + '-' + m + '-' + day;\n  }",
      "  function supPayToday_() {\n    return new Date(Date.now()+21600000).toISOString().slice(0,10);\n  }"]
  ];
  for(const [original,replacement] of cashOnlySourceReplacements){
    if(html.split(original).length!==2)throw new Error('Owner Supplier cash-only boundary changed: '+original);
    html=html.replace(original,replacement);
  }

  const rowActionStart="        '<td>' + statusBadge + '</td>' +\n        '<td class=\"erp-sticky-action-col\">' +\n          rowActionTriggerHtml_(";
  const rowActionEnd="\n      body.appendChild(tr);";
  const rowStart=html.indexOf(rowActionStart,html.indexOf('  function prodRender() {'));
  const rowEnd=html.indexOf(rowActionEnd,rowStart);
  if(rowStart<0||rowEnd<0)throw new Error('Owner catalog action boundary changed');
  return html.slice(0,rowStart)+"        '<td>—</td><td>—</td>';"+html.slice(rowEnd);
}

export async function buildOwnerFrontend({sourceDir='legacy/source',outputDir='dist-owner'}={}){
  const output=resolve(outputDir);
  const built=await buildFrontend({sourceDir,outputDir:output});
  let html=await readFile(built.outputPath,'utf8');
  html=patchM01ProductsPreview(patchM01Accessibility(
    patchPosV2HiddenVisibility(patchAuthenticatedShellCall(patchServerCall(html)))));
  await installM01ProductsPreviewAssets(output);
  html=patchOwnerApp(html);
  html=await installOwnerHisabiqParties(html);
  html=await installOwnerHisabiqSettings(html);
  html=await installOwnerHisabiqUnitEditor(html);
  html=await installOwnerHisabiqPos(html);
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
