const panels=[...document.querySelectorAll('main > section')];
const byId=id=>document.getElementById(id);
const status=byId('status');
const mount=byId('google-button');
const ticket=byId('setup-ticket');
const code=byId('auth-code');
const cancelGoogle=byId('back-google');
let generation=0;
let credential;
let sdk;

function show(view,message=''){
  generation++;
  credential=undefined;
  ticket.value='';
  code.value='';
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
    show('signed-in');
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
  session=>show(session.role==='PlatformSuperAdmin'?'signed-in':'login'),
  error=>show('login',error.message==='401'?'':'Could not restore your session.'),
);
