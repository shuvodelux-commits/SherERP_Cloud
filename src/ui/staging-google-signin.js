// This bridge is copied only by the opt-in staging build. The frozen password
// form and default browser build retain their original behavior.
(() => {
  const passwordBootstrap=window.bootstrapSession_;
  const passwordShell=window.getAppShellDataOnce_;
  const passwordLogout=window.doLogout_;
  const passwordLogin=window.doLogin_;
  const showPasswordForm=window.showLogin_;
  let googleShell;
  let googleMode=false;
  let mountPromise;
  let googlePending=false;

  async function call(path,options={},allowMissing=false){
    const response=await fetch('/api/auth/google'+path,{credentials:'same-origin',...options});
    if(allowMissing && response.status===404)return;
    if(!response.ok)throw new Error('Google sign-in is unavailable.');
    const payload=await response.json();
    if(payload?.success!==true)throw new Error('Google sign-in is unavailable.');
    return payload.data;
  }

  async function showGoogleShell(profile){
    if(authToken)return;
    const user=profile?.user;
    if(typeof user?.id!=='string' || !user.id || typeof user.name!=='string' ||
       !user.name || user.role!=='Administrator')throw new Error('Google session is unavailable.');
    const shell=await call('/shell');
    if(typeof shell?.shopName!=='string' || !Array.isArray(shell.navItems))
      throw new Error('Could not load app settings.');
    if(authToken)return;
    googleMode=true;
    googleShell=shell;
    currentUser=user;
    allowedModules=null;
    userPermissions=null;
    hideLogin_();
    return loadAppShell_();
  }

  function loadGoogleSdk(){
    if(window.google?.accounts?.id)return Promise.resolve(window.google.accounts.id);
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://accounts.google.com/gsi/client';
      script.async=true;
      script.onload=()=>{
        const google=window.google?.accounts?.id;
        if(google)resolve(google);
        else reject(new Error('Google Sign-In did not load.'));
      };
      script.onerror=reject;
      document.head.append(script);
    });
  }

  async function mount(){
    const target=document.getElementById('shererp-google-signin');
    const options=await call('/challenge',{method:'POST'});
    const google=await loadGoogleSdk();
    google.initialize({
      client_id:options.clientId,
      nonce:options.nonce,
      ux_mode:'popup',
      callback:async({credential})=>{
        if(googlePending || authToken || document.getElementById('loginSubmitBtn')?.disabled)return;
        googlePending=true;
        try{
          await call('',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({credential})});
          await showGoogleShell(await call('/session'));
        }catch{
          showToast('Google sign-in failed. Reload the page to try again.','error');
        }finally{
          googlePending=false;
        }
      },
    });
    google.renderButton(target,{theme:'outline',size:'large',text:'signin_with'});
  }

  window.showLogin_=function(){
    showPasswordForm();
    if(!mountPromise)mountPromise=mount().catch(()=>{});
  };
  window.bootstrapSession_=function(){
    if(readStoredToken_())return passwordBootstrap();
    return call('/session').then(showGoogleShell).catch(()=>showLogin_());
  };
  window.getAppShellDataOnce_=function(){
    return googleMode && !authToken?Promise.resolve(googleShell):passwordShell();
  };
  window.doLogin_=function(){
    if(!googlePending)return passwordLogin();
  };
  window.doLogout_=function(){
    const passwordMode=!googleMode || Boolean(authToken);
    return call('/logout',{method:'POST'},passwordMode).then(()=>{
      if(passwordMode)return passwordLogout();
      window.location.reload();
    }).catch(()=>{
      showToast('Could not sign out securely. Check your connection and try again.','error');
    });
  };
})();
