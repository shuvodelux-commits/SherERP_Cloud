const panels=[...document.querySelectorAll('main > section')];
const byId=id=>document.getElementById(id);
const status=byId('status');
const mount=byId('google-button');
const ticket=byId('setup-ticket');
const code=byId('auth-code');
const cancelGoogle=byId('back-google');
const businessForm=byId('business-form');
const businessName=byId('business-name');
const businessOwnerEmail=byId('business-owner-email');
const businessOwnerEmailLabel=byId('business-owner-email-label');
const businessReceipt=byId('business-receipt');
const resumeBusiness=byId('resume-business');
const businessRoster=byId('business-roster');
const businessRosterList=byId('business-roster-list');
const businessRosterStatus=byId('business-roster-status');
const businessSearch=byId('business-search');
const businessStatusFilter=byId('business-status-filter');
const businessFilterSummary=byId('business-filter-summary');
const businessRecentCount=byId('business-recent-count');
const businessReadyCount=byId('business-ready-count');
const businessPendingCount=byId('business-pending-count');
const supportMode=byId('support-mode');
const supportForm=byId('support-form');
const supportReason=byId('support-reason');
const supportStart=byId('support-start');
const supportStatus=byId('support-status');
const supportSelected=byId('support-selected');
const supportDiagnostics=byId('support-diagnostics');
const supportCategories=byId('support-categories');
const supportUnits=byId('support-units');
const supportEnd=byId('support-end');
const supportClose=byId('support-close');
const signOut=byId('sign-out');
const inviteForm=byId('owner-invitation-form');
const inviteSubject=byId('owner-google-subject');
const inviteResult=byId('owner-invitation-result');
const inviteCode=byId('owner-invitation-code');
const gmailForm=byId('owner-gmail-form');
const gmailAddress=byId('owner-gmail-address');
const RESERVATION_DRAFT='shererp-platform-reservation-draft';
const setupStages={reserved:'Reserved',allocating:'Allocating database',allocated:'Preparing database',ready:'Ready'};
const setupFailures={
  'database-creation':'Database creation',
  'binding-verification':'Database binding verification',
  'schema-migrations':'Database schema setup',
  'owner-readiness':'Owner readiness',
};
let localProvisioning=false;
let supportEnabled=false;
let supportSelection=null;
let supportGrant=null;
let businessShops=[];
let generation=0;
let credential;
let sdk;

function clearInviteCode(){
  inviteCode.value='';
  inviteResult.hidden=true;
}

function clearSupport(){
  supportGrant=null;
  supportSelection=null;
  supportMode.hidden=true;
  supportForm.hidden=false;
  supportReason.value='';
  supportStatus.textContent='';
  supportSelected.textContent='';
  supportCategories.textContent='';
  supportUnits.textContent='';
  supportDiagnostics.hidden=true;
  supportStart.disabled=false;
  supportEnd.hidden=true;
  supportEnd.disabled=false;
  supportClose.disabled=false;
}
window.addEventListener('pagehide',()=>{
  clearInviteCode();
  // A page close drops the opaque bearer; it is never persisted.
  clearSupport();
});

function clearBusinessDirectory(){
  businessShops=[];
  businessSearch.value='';
  businessStatusFilter.value='all';
  businessRosterList.replaceChildren();
  businessRosterStatus.textContent='';
  businessFilterSummary.textContent='';
  businessRecentCount.textContent='0';
  businessReadyCount.textContent='0';
  businessPendingCount.textContent='0';
}

function show(view,message=''){
  generation++;
  credential=undefined;
  ticket.value='';
  code.value='';
  clearInviteCode();
  inviteSubject.value='';
  gmailAddress.value='';
  mount.replaceChildren();
  cancelGoogle.disabled=false;
  status.textContent=message;
  clearSupport();
  supportEnabled=false;
  clearBusinessDirectory();
  document.body.classList.toggle('platform-signed-in',view==='signed-in');
  if(view!=='signed-in')businessRoster.hidden=true;
  for(const panel of panels)panel.hidden=panel.id!==view;
  byId(view).querySelector('h1').focus();
  return generation;
}

async function api(path,method='POST',data){
  const response=await fetch('/api/platform'+path,{
    method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000),
    ...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}),
  });
  if(!response.ok)throw new Error(String(response.status));
  return response.json();
}

function reservationDraft(){
  const saved=sessionStorage.getItem(RESERVATION_DRAFT);
  if(saved===null)return null;
  const draft=JSON.parse(saved);
  if(typeof draft?.operationId!=='string'||typeof draft.displayName!=='string'||
     (localProvisioning?typeof draft.ownerEmail!=='string':Object.hasOwn(draft,'ownerEmail'))){
    throw new Error('Invalid draft');
  }
  return localProvisioning
    ?{operationId:draft.operationId,displayName:draft.displayName,ownerEmail:draft.ownerEmail}
    :{operationId:draft.operationId,displayName:draft.displayName};
}

function businessBusy(busy){
  businessForm.querySelector('button[type="submit"]').disabled=busy;
  resumeBusiness.disabled=busy;
  signOut.disabled=busy;
}

function showSetupReceipt(receipt,draft){
  if(!receipt||receipt.operationId!==draft.operationId||receipt.displayName!==draft.displayName||
     receipt.ownerEmail!==draft.ownerEmail.trim().toLowerCase()||
     typeof receipt.shopId!=='string'||!Object.hasOwn(setupStages,receipt.status)||
     (receipt.failedStage!==null&&!Object.hasOwn(setupFailures,receipt.failedStage))){
    throw new Error('Setup response does not match request');
  }
  businessReceipt.textContent='Business '+receipt.displayName+'. Shop ID: '+receipt.shopId+
    '. Setup: '+setupStages[receipt.status]+'.'+
    (receipt.failedStage?' Last issue: '+setupFailures[receipt.failedStage]+'.':'');
  businessReceipt.hidden=false;
  resumeBusiness.hidden=receipt.status==='ready';
  if(receipt.status==='ready'){
    sessionStorage.removeItem(RESERVATION_DRAFT);
    businessName.value='';
    businessName.readOnly=false;
    businessOwnerEmail.value='';
    businessOwnerEmail.readOnly=false;
  }
}

function validRosterShop(shop){
  return shop!==null&&typeof shop==='object'&&
    Object.keys(shop).length===6&&
    ['operationId','displayName','shopId','ownerEmail'].every(k=>typeof shop[k]==='string')&&
    Object.hasOwn(setupStages,shop.status)&&
    (shop.failedStage===null||Object.hasOwn(setupFailures,shop.failedStage));
}

async function resumeRosterShop(shop,button){
  const view=generation;
  button.disabled=true;
  businessRosterStatus.textContent='Resuming business setup…';
  try{
    const result=await api('/shops/resume','POST',{operationId:shop.operationId});
    if(view!==generation)return;
    if(!validRosterShop(result)||result.operationId!==shop.operationId||
       result.shopId!==shop.shopId||result.ownerEmail!==shop.ownerEmail){
      throw new Error('Unexpected setup response');
    }
    await loadBusinessRoster(view);
    if(view===generation && businessRosterStatus.textContent===''){
      businessRosterStatus.textContent=result.status==='ready'
        ?'Business ready.':'Setup is not ready. Review its stage and resume again.';
    }
  }catch(error){
    if(view!==generation)return;
    if(error.message==='401')show('login','Sign in again to resume business setup.');
    else businessRosterStatus.textContent='Could not complete setup. Retry the same business.';
  }finally{
    button.disabled=false;
  }
}

async function endSupportSession(){
  if(!supportGrant)return true;
  const current=supportGrant;
  supportEnd.disabled=true;
  supportStatus.textContent='Ending read-only support…';
  try{
    const result=await api('/support/end','POST',{
      shopId:current.shopId,operationId:current.operationId,
    });
    if(result.status!=='revoked')throw new Error('Invalid support end result');
    supportGrant=null;
    supportReason.value='';
    supportForm.hidden=false;
    supportEnd.hidden=true;
    supportDiagnostics.hidden=true;
    supportCategories.textContent='';
    supportUnits.textContent='';
    supportStatus.textContent='Support session ended.';
    return true;
  }catch(error){
    if(error.message==='401'||error.message==='403'){
      show('login','Sign in again to use Support Mode.');
    }else{
      supportStatus.textContent='Could not confirm support end. Retry or sign out.';
    }
    return false;
  }finally{
    supportEnd.disabled=false;
  }
}

async function selectSupportShop(shop){
  if(!supportEnabled||shop.status!=='ready')return;
  if(supportGrant && !await endSupportSession())return;
  supportSelection={shopId:shop.shopId,displayName:shop.displayName};
  supportMode.hidden=false;
  supportForm.hidden=false;
  supportSelected.textContent='Business: '+shop.displayName+'. Read-only setup inspection.';
  supportStatus.textContent='';
  supportDiagnostics.hidden=true;
  supportReason.value='';
  supportEnd.hidden=true;
  supportReason.focus();
}

supportForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(supportMode.hidden||!supportEnabled||!supportSelection||supportGrant)return;
  const reason=supportReason.value.trim();
  if(reason.length<12||reason.length>180){
    supportStatus.textContent='Describe the reason in at least 12 characters.';
    supportReason.focus();
    return;
  }
  const shopId=supportSelection.shopId;
  const view=generation;
  supportStart.disabled=true;
  supportStatus.textContent='Starting audited, read-only support…';
  try{
    const operationId=crypto.randomUUID();
    const result=await api('/support/start','POST',{shopId,operationId,reason});
    if(view!==generation)return;
    if(result.status!=='created'||result.operationId!==operationId||
       !/^[a-f0-9]{64}$/.test(result.supportToken)){
      throw new Error('Unexpected support grant');
    }
    supportGrant={shopId,operationId,token:result.supportToken};
    supportForm.hidden=true;
    supportEnd.hidden=false;
    const inspected=await api('/support/diagnostics','POST',{
      shopId,eventId:crypto.randomUUID(),supportToken:supportGrant.token,
    });
    if(view!==generation)return;
    if(inspected.shopId!==shopId)throw new Error('Wrong Shop diagnostics');
    if(inspected.status==='ok'&&inspected.catalog?.status==='available'&&
       Number.isSafeInteger(inspected.catalog.categories)&&
       Number.isSafeInteger(inspected.catalog.units)){
      supportCategories.textContent='Categories: '+inspected.catalog.categories;
      supportUnits.textContent='Units: '+inspected.catalog.units;
      supportDiagnostics.hidden=false;
      supportStatus.textContent='Read-only setup diagnostics. ERP operations are not enabled.';
    }else if(inspected.status==='schema-incomplete'){
      supportDiagnostics.hidden=true;
      supportStatus.textContent='Catalog schema incomplete. No ERP readiness claim is possible.';
    }else{
      throw new Error('Unsupported diagnostic response');
    }
  }catch(error){
    if(view!==generation)return;
    if(error.message==='401'||error.message==='403'){
      show('login','Sign in again to use Support Mode.');
    }else{
      supportStatus.textContent=supportGrant
        ?'Could not read diagnostics. End support and retry.'
        :'Could not start Support Mode. Check permissions and retry.';
    }
  }finally{
    supportStart.disabled=false;
  }
});
supportEnd.addEventListener('click',()=>void endSupportSession());
supportClose.addEventListener('click',async()=>{
  if(supportGrant && !await endSupportSession())return;
  clearSupport();
});

function renderBusinessRoster(){
  const ready=businessShops.filter(shop=>shop.status==='ready').length;
  businessRecentCount.textContent=String(businessShops.length);
  businessReadyCount.textContent=String(ready);
  businessPendingCount.textContent=String(businessShops.length-ready);
  const query=businessSearch.value.trim().toLocaleLowerCase();
  const mode=businessStatusFilter.value;
  const visible=businessShops.filter(shop=>
    (mode==='all'||(mode==='ready'?shop.status==='ready':shop.status!=='ready'))&&
    (!query||shop.displayName.toLocaleLowerCase().includes(query)||
      shop.ownerEmail.toLocaleLowerCase().includes(query))
  );
  businessRosterList.replaceChildren();
  for(const shop of visible){
    const row=document.createElement('li');
    const info=document.createElement('div');
    const name=document.createElement('strong');
    name.textContent=shop.displayName;
    const details=document.createElement('p');
    details.textContent='Owner: '+shop.ownerEmail+'. Setup: '+setupStages[shop.status]+
      (shop.failedStage?' — '+setupFailures[shop.failedStage]:'');
    info.append(name,details);
    row.append(info);
    if(shop.status!=='ready'){
      const button=document.createElement('button');
      button.type='button';
      button.className='secondary';
      button.textContent='Resume setup';
      button.setAttribute('aria-label','Resume setup for '+shop.displayName);
      button.addEventListener('click',()=>resumeRosterShop(shop,button));
      row.append(button);
    else if(supportEnabled){
      const button=document.createElement('button');
      button.type='button';
      button.className='secondary';
      button.textContent='Inspect setup';
      button.setAttribute('aria-label','Inspect setup for '+shop.displayName);
      button.addEventListener('click',()=>void selectSupportShop(shop));
      row.append(button);
    }
    businessRosterList.append(row);
  }
  businessFilterSummary.textContent=businessShops.length===0?'':visible.length===0
    ?'No businesses match your filters.'
    :'Showing '+visible.length+' of '+businessShops.length+' recent businesses.';
}

businessSearch.addEventListener('input',renderBusinessRoster);
businessStatusFilter.addEventListener('change',renderBusinessRoster);

async function loadBusinessRoster(view){
  if(!localProvisioning||businessRoster.hidden)return;
  businessRosterStatus.textContent='Checking local businesses…';
  try{
    const result=await api('/shops/list','GET');
    if(view!==generation)return;
    if(!Array.isArray(result.shops)||result.shops.length>50||
       !result.shops.every(validRosterShop)){
      throw new Error('Invalid business roster');
    }
    businessShops=result.shops;
    renderBusinessRoster();
    businessRosterStatus.textContent=result.shops.length?'':'No local businesses yet.';
  }catch(error){
    if(view!==generation)return;
    businessShops=[];
    renderBusinessRoster();
    if(error.message==='401')show('login','Sign in again to view local businesses.');
    else businessRosterStatus.textContent='Could not load business status. Reload to retry.';
  }
}

async function restoreLocalSetup(draft,view){
  status.textContent='Checking saved business setup…';
  try{
    const receipt=await api('/shops/setup/'+encodeURIComponent(draft.operationId),'GET');
    if(view!==generation)return;
    showSetupReceipt(receipt,draft);
    status.textContent='';
  }catch(error){
    if(view!==generation)return;
    if(error.message==='401')show('login','Sign in again to resume business setup.');
    else status.textContent='Could not verify saved setup. Retry Create business with the same request.';
  }
}

function showSignedIn(session){
  const view=show('signed-in');
  localProvisioning=session.localProvisioningEnabled===true;
  supportEnabled=session.supportDiagnosticsEnabled===true;
  businessRoster.hidden=!localProvisioning;
  if(localProvisioning)void loadBusinessRoster(view);
  businessForm.hidden=session.shopReservationEnabled!==true;
  businessOwnerEmail.hidden=businessOwnerEmailLabel.hidden=!localProvisioning;
  businessOwnerEmail.required=localProvisioning;
  gmailForm.hidden=typeof session.ownerGmailApprovalShopId!=='string';
  byId('owner-gmail-shop').textContent=gmailForm.hidden?'':'Shop '+session.ownerGmailApprovalShopId;
  inviteForm.hidden=typeof session.ownerInvitationShopId!=='string';
  byId('owner-invitation-shop').textContent=inviteForm.hidden?'':'Shop '+session.ownerInvitationShopId;
  businessReceipt.hidden=true;
  businessReceipt.textContent='';
  resumeBusiness.hidden=true;
  businessName.value='';
  businessName.readOnly=false;
  businessOwnerEmail.value='';
  businessOwnerEmail.readOnly=false;
  if(businessForm.hidden)return;
  try{
    const draft=reservationDraft();
    if(draft){
      businessName.value=draft.displayName;
      businessName.readOnly=true;
      if(localProvisioning){
        businessOwnerEmail.value=draft.ownerEmail;
        businessOwnerEmail.readOnly=true;
        void restoreLocalSetup(draft,view);
      }
    }
  }catch{
    sessionStorage.removeItem(RESERVATION_DRAFT);
    status.textContent='This browser could not restore the reservation request. Enter a new request.';
  }
}

businessForm.addEventListener('submit',async event=>{
  event.preventDefault();
  if(businessForm.hidden)return;
  const button=businessForm.querySelector('button[type="submit"]');
  if(button.disabled||signOut.disabled)return;
  const name=businessName.value.trim();
  if(!name){
    status.textContent='Enter a business name.';
    businessName.focus();
    return;
  }
  const email=businessOwnerEmail.value.trim();
  if(localProvisioning&&!/^[a-z0-9][a-z0-9.+_-]{0,63}@gmail\.com$/i.test(email)){
    status.textContent='Enter a valid Owner Gmail address.';
    businessOwnerEmail.focus();
    return;
  }
  let draft;
  try{
    draft=reservationDraft()??{
      operationId:crypto.randomUUID(),displayName:name,
      ...(localProvisioning?{ownerEmail:email}:{})
    };
    sessionStorage.setItem(RESERVATION_DRAFT,JSON.stringify(draft));
  }catch{
    status.textContent='This browser could not save the reservation request.';
    return;
  }
  businessName.value=draft.displayName;
  businessName.readOnly=true;
  if(localProvisioning){
    businessOwnerEmail.value=draft.ownerEmail;
    businessOwnerEmail.readOnly=true;
  }
  businessReceipt.hidden=true;
  resumeBusiness.hidden=true;
  businessBusy(true);
  status.textContent='Reserving business…';
  let confirmed=false;
  try{
    const receipt=await api('/shops','POST',draft);
    if(localProvisioning){
      showSetupReceipt(receipt,draft);
      confirmed=true;
      if(receipt.status!=='ready'){
        status.textContent='Setting up business…';
        showSetupReceipt(await api('/shops/resume','POST',{operationId:draft.operationId}),draft);
      }
      status.textContent='';
    }else{
      if(receipt.status!=='reserved'||typeof receipt.shopId!=='string'||
         receipt.displayName!==draft.displayName)throw new Error('Reservation missing');
      sessionStorage.removeItem(RESERVATION_DRAFT);
      businessName.value='';
      businessName.readOnly=false;
      businessReceipt.textContent='Business reserved. Shop ID: '+receipt.shopId+'. Database setup is next.';
      businessReceipt.hidden=false;
      status.textContent='';
    }
  }catch(error){
    if(error.message==='401'){
      show('login','Sign in again to resume the reservation.');
    }else if(!confirmed&&(error.message==='400'||error.message==='409')){
      sessionStorage.removeItem(RESERVATION_DRAFT);
      businessName.readOnly=false;
      businessOwnerEmail.readOnly=false;
      status.textContent=error.message==='409'
        ?'This request conflicts with an existing reservation. Check it before submitting a new request.'
        :localProvisioning?'Enter a valid business name and Owner Gmail.'
          :'Enter a valid business name and try again.';
    }else{
      status.textContent=confirmed
        ?'Could not confirm setup completion. Resume the saved operation.'
        :'Could not confirm the reservation. Retry to check the same request.';
    }
  }finally{
    businessBusy(false);
    if(localProvisioning&&!businessRoster.hidden)void loadBusinessRoster(generation);
  }
});

resumeBusiness.addEventListener('click',async()=>{
  if(!localProvisioning||resumeBusiness.hidden||resumeBusiness.disabled||signOut.disabled)return;
  let draft;
  try{draft=reservationDraft();}catch{return;}
  if(!draft)return;
  businessBusy(true);
  status.textContent='Resuming business setup…';
  try{
    showSetupReceipt(await api('/shops/resume','POST',{operationId:draft.operationId}),draft);
    status.textContent='';
  }catch(error){
    if(error.message==='401')show('login','Sign in again to resume business setup.');
    else status.textContent='Could not complete setup. Check the stage and resume the same operation.';
  }finally{
    businessBusy(false);
    if(localProvisioning&&!businessRoster.hidden)void loadBusinessRoster(generation);
  }
});

inviteForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=inviteForm.querySelector('button[type="submit"]');
  if(inviteForm.hidden||button.disabled||signOut.disabled)return;
  const googleSubject=inviteSubject.value.trim();
  if(!googleSubject){
    status.textContent='Enter the verified Google account ID.';
    inviteSubject.focus();
    return;
  }
  button.disabled=signOut.disabled=true;
  status.textContent='Preparing the Owner invitation…';
  try{
    const result=await api('/shops/invite-owner','POST',{googleSubject});
    if(typeof result.inviteCode!=='string'||!/^[a-f0-9]{64}$/.test(result.inviteCode)){
      throw new Error('Invitation missing');
    }
    inviteSubject.value='';
    inviteCode.value=result.inviteCode;
    inviteResult.hidden=false;
    status.textContent='Owner invitation created.';
    inviteCode.focus();
  }catch(error){
    if(error.message==='401')show('login','Sign in again to invite the Owner.');
    else if(error.message==='400')status.textContent='Check the verified Google account ID.';
    else if(error.message==='409')status.textContent='The shop binding could not be verified or an invitation is already active.';
    else status.textContent='Could not confirm the invitation. Check before issuing another.';
  }finally{
    button.disabled=signOut.disabled=false;
  }
});

gmailForm.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=gmailForm.querySelector('button[type="submit"]');
  if(gmailForm.hidden||button.disabled||signOut.disabled)return;
  button.disabled=signOut.disabled=true;
  status.textContent='Saving Owner approval…';
  try{
    await api('/shops/approve-owner','POST',{email:gmailAddress.value.trim()});
    gmailAddress.value='';
    status.textContent='Owner Gmail approved.';
  }catch(error){
    if(error.message==='401')show('login','Sign in again to approve the Owner.');
    else if(error.message==='400')status.textContent='Enter a Gmail address.';
    else if(error.message==='409')status.textContent='This shop already has an Owner or its database could not be verified.';
    else status.textContent='Could not save Owner approval. Try again.';
  }finally{
    button.disabled=signOut.disabled=false;
  }
});

function googleSdk(){
  if(sdk)return sdk;
  sdk=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const failed=()=>{
      clearTimeout(timeout);
      script.remove();
      reject(new Error('Google Sign-In unavailable'));
    };
    const timeout=setTimeout(failed,8000);
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;
    script.onerror=failed;
    script.onload=()=>{
      clearTimeout(timeout);
      const google=window.google?.accounts?.id;
      if(google)resolve(google);
      else failed();
    };
    document.head.append(script);
  }).catch(error=>{
    sdk=undefined;
    throw error;
  });
  return sdk;
}

async function startGoogle(mode,setupToken){
  const current=show('google','Preparing Google Sign-In…');
  cancelGoogle.disabled=true;
  try{
    const path=mode==='setup'?'/setup/challenge':'/auth/challenge';
    const {clientId,nonce}=await api(path,'POST',setupToken?{setupToken}:undefined);
    cancelGoogle.disabled=false;
    const google=await googleSdk();
    if(current!==generation)return;
    google.initialize({
      client_id:clientId,
      nonce,
      ux_mode:'popup',
      callback:async result=>{
        if(current!==generation||typeof result?.credential!=='string'||cancelGoogle.disabled)return;
        if(mode==='login'){
          show('mfa');
          credential=result.credential;
          code.focus();
          return;
        }
        cancelGoogle.disabled=true;
        mount.replaceChildren();
        status.textContent='Verifying setup…';
        try{
          const response=await api('/setup','POST',{credential:result.credential});
          if(response.enrolled!==true)throw new Error('Enrollment missing');
          show('login','Setup complete. Sign in to continue.');
        }catch{
          show('setup','Could not complete setup. Check your ticket and Google account.');
        }
      },
    });
    const width=Math.min(320,Math.floor(mount.getBoundingClientRect().width));
    google.renderButton(mount,{theme:'outline',size:'large',text:'signin_with',width});
    status.textContent='';
  }catch(error){
    if(current!==generation)return;
    const message=error.message==='429'
      ?'Too many attempts. Try again in a minute.'
      :'Could not start Google Sign-In. Try again.';
    show(mode,message);
  }
}

byId('start-login').addEventListener('click',()=>startGoogle('login'));
byId('open-setup').addEventListener('click',()=>show('setup'));
for(const id of ['back-setup','back-google','back-mfa'])byId(id).addEventListener('click',()=>show('login'));

byId('setup-form').addEventListener('submit',event=>{
  event.preventDefault();
  startGoogle('setup',ticket.value);
});

byId('mfa-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(!credential)return;
  const input={credential,code:code.value};
  credential=undefined;
  code.value='';
  const submit=event.currentTarget.querySelector('button[type="submit"]');
  const cancel=byId('back-mfa');
  submit.disabled=cancel.disabled=true;
  status.textContent='Verifying your sign-in…';
  try{
    const session=await api('/auth/login','POST',input);
    if(session.role!=='PlatformSuperAdmin')throw new Error('Role missing');
    showSignedIn(session);
  }catch{
    show('login','Could not sign in. Start sign-in again.');
  }finally{
    submit.disabled=cancel.disabled=false;
  }
});

byId('sign-out').addEventListener('click',async event=>{
  const button=event.currentTarget;
  button.disabled=true;
  try{
    // Best effort: sign-out revokes the Admin session even if support END fails.
    // This blocks future support reads and the bearer expires after 5 minutes.
    if(supportGrant){
      try{
        await api('/support/end','POST',{
          shopId:supportGrant.shopId,operationId:supportGrant.operationId,
        });
      }catch{}
      supportGrant=null;
    }
    const reply=await api('/auth/logout');
    if(reply.signedOut!==true)throw new Error('Sign-out missing');
    sessionStorage.removeItem(RESERVATION_DRAFT);
    show('login');
  }catch{
    status.textContent='Could not sign out securely. Try again.';
  }finally{
    button.disabled=false;
  }
});

api('/auth/session','GET').then(
  session=>session.role==='PlatformSuperAdmin'?showSignedIn(session):show('login'),
  error=>show('login',error.message==='401'?'':'Could not restore your session.'),
);
