const byId=id=>document.getElementById(id);
const panels=[...document.querySelectorAll('main > section')];
const status=byId('status');
const mount=byId('google-button');
const invite=byId('invite-code');
const cancel=byId('cancel-google');
let generation=0;
let sdk;
const gmailMode=document.body.dataset.gmailSignin==='enabled';

function show(view,message=''){
  generation++;
  invite.value='';
  mount.replaceChildren();
  cancel.disabled=false;
  status.textContent=message;
  for(const panel of panels)panel.hidden=panel.id!==view;
  byId(view).querySelector('h1').focus();
  return generation;
}

async function api(path,method='POST',data){
  const response=await fetch('/api/owner'+path,{
    method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000),
    ...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{}),
  });
  if(!response.ok)throw new Error(String(response.status));
  return response.json();
}

function googleSdk(){
  if(sdk)return sdk;
  sdk=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const failed=()=>{
      clearTimeout(timer);
      script.remove();
      reject(new Error('Google Sign-In unavailable'));
    };
    const timer=setTimeout(failed,8000);
    script.src='https://accounts.google.com/gsi/client';
    script.async=true;
    script.onerror=failed;
    script.onload=()=>{
      clearTimeout(timer);
      const google=window.google?.accounts?.id;
      if(google)resolve(google);
      else failed();
    };
    document.head.append(script);
  }).catch(error=>{sdk=undefined;throw error;});
  return sdk;
}

function showSession(session){
  if(session.role!=='Owner'||typeof session.shopId!=='string')throw new Error('Owner session missing');
  byId('shop-reference').textContent='Shop ID: '+session.shopId;
  show('signed-in');
}

async function startGoogle(mode,inviteCode){
  const setup=mode==='setup';
  const current=show('google','Preparing Google Sign-In…');
  try{
    const {clientId,nonce}=await api(setup?'/setup/challenge':'/auth/challenge','POST',setup?{inviteCode}:undefined);
    const google=await googleSdk();
    if(current!==generation)return;
    google.initialize({
      client_id:clientId,nonce,ux_mode:'popup',
      callback:async result=>{
        if(current!==generation||cancel.disabled||typeof result?.credential!=='string')return;
        cancel.disabled=true;
        mount.replaceChildren();
        status.textContent='Verifying with Google…';
        try{
          const response=await api(setup?'/setup':'/auth/login','POST',{credential:result.credential});
          if(response.role!=='Owner')throw new Error('Owner account missing');
          if(setup)show('login','Invitation accepted. Sign in to continue.');
          else showSession(await api('/auth/session','GET'));
        }catch{
          show(mode,'Could not complete Google verification. Try again.');
        }
      },
    });
    google.renderButton(mount,{theme:'outline',size:'large',text:'signin_with',width:Math.min(320,Math.floor(mount.getBoundingClientRect().width))});
    status.textContent='';
  }catch(error){
    if(current!==generation)return;
    show(mode,error.message==='429'?'Too many attempts. Try again in a minute.':(gmailMode?'Could not start Google sign-in. Ask your Super Admin to confirm your Gmail approval.':'Could not start Google Sign-In. Check your invitation or try signing in again.'));
  }
}

byId('open-setup').hidden=gmailMode||document.body.dataset.redemption!=='enabled';
if(gmailMode){
  byId('start-login').textContent='Sign in with Google';
  byId('gmail-signin-help').hidden=false;
}
byId('open-setup').addEventListener('click',()=>show('setup'));
byId('back-setup').addEventListener('click',()=>show('login'));
cancel.addEventListener('click',()=>show('login'));
byId('start-login').addEventListener('click',()=>startGoogle('login'));
byId('invite-form').addEventListener('submit',event=>{
  event.preventDefault();
  startGoogle('setup',invite.value);
});
byId('sign-out').addEventListener('click',async event=>{
  const button=event.currentTarget;
  button.disabled=true;
  try{
    const response=await api('/auth/logout');
    if(response.signedOut!==true)throw new Error('Sign-out missing');
    byId('shop-reference').textContent='';
    show('login');
  }catch{
    status.textContent='Could not sign out securely. Try again.';
  }finally{
    button.disabled=false;
  }
});
api('/auth/session','GET').then(showSession).catch(error=>show('login',error.message==='401'?'':'Could not restore your session.'));
