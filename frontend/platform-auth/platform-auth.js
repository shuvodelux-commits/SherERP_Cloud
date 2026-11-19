const panels=[...document.querySelectorAll('main > section')];
const byId=id=>document.getElementById(id);
const status=byId('status');
const mount=byId('google-button');
const ticket=byId('setup-ticket');
const code=byId('auth-code');
const cancelGoogle=byId('back-google');
const businessForm=byId('business-form');
const businessName=byId('business-name');
const businessReceipt=byId('business-receipt');
const signOut=byId('sign-out');
const inviteForm=byId('owner-invitation-form');
const inviteSubject=byId('owner-google-subject');
const inviteResult=byId('owner-invitation-result');
const inviteCode=byId('owner-invitation-code');
const RESERVATION_DRAFT='shererp-platform-reservation-draft';
let generation=0;
let credential;
let sdk;

function clearInviteCode(){
  inviteCode.value='';
  inviteResult.hidden=true;
}

window.addEventListener('pagehide',clearInviteCode);

function show(view,message=''){
  generation++;
  credential=undefined;
  ticket.value='';
  code.value='';
  clearInviteCode();
  inviteSubject.value='';
  mount.replaceChildren();
  cancelGoogle.disabled=false;
  status.textContent=message;
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
  if(typeof draft?.operationId!=='string'||typeof draft.displayName!=='string')throw new Error('Invalid draft');
  return {operationId:draft.operationId,displayName:draft.displayName};
}

function showSignedIn(session){
  show('signed-in');
  businessForm.hidden=session.shopReservationEnabled!==true;
  inviteForm.hidden=typeof session.ownerInvitationShopId!=='string';
  byId('owner-invitation-shop').textContent=inviteForm.hidden?'':'Shop '+session.ownerInvitationShopId;
  businessReceipt.hidden=true;
  businessReceipt.textContent='';
  businessName.value='';
  businessName.readOnly=false;
  if(businessForm.hidden)return;
  try{
    const draft=reservationDraft();
    if(draft){
      businessName.value=draft.displayName;
      businessName.readOnly=true;
    }
  }catch{
    status.textContent='This browser could not restore the reservation request.';
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
  let draft;
  try{
    draft=reservationDraft()??{operationId:crypto.randomUUID(),displayName:name};
    sessionStorage.setItem(RESERVATION_DRAFT,JSON.stringify(draft));
  }catch{
    status.textContent='This browser could not save the reservation request.';
    return;
  }
  businessName.value=draft.displayName;
  businessName.readOnly=true;
  businessReceipt.hidden=true;
  button.disabled=signOut.disabled=true;
  status.textContent='Reserving business…';
  try{
    const receipt=await api('/shops','POST',draft);
    if(receipt.status!=='reserved'||typeof receipt.shopId!=='string'||receipt.displayName!==draft.displayName){
      throw new Error('Reservation missing');
    }
    sessionStorage.removeItem(RESERVATION_DRAFT);
    businessName.value='';
    businessName.readOnly=false;
    businessReceipt.textContent='Business reserved. Shop ID: '+receipt.shopId+'. Database setup is next.';
    businessReceipt.hidden=false;
    status.textContent='';
  }catch(error){
    if(error.message==='401'){
      show('login','Sign in again to resume the reservation.');
    }else if(error.message==='400'||error.message==='409'){
      sessionStorage.removeItem(RESERVATION_DRAFT);
      businessName.readOnly=false;
      status.textContent=error.message==='409'
        ?'This request conflicts with an existing reservation. Check it before submitting a new request.'
        :'Enter a valid business name and try again.';
    }else{
      status.textContent='Could not confirm the reservation. Retry to check the same request.';
    }
  }finally{
    button.disabled=signOut.disabled=false;
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
    const reply=await api('/auth/logout');
    if(reply.signedOut!==true)throw new Error('Sign-out missing');
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
