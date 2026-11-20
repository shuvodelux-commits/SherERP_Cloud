import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright';

const origin='https://platform.example.test';
const root=new URL('../frontend/platform-auth/',import.meta.url);
const originalCodes=Array.from({length:8},(_,i)=>
  (String(i+1).padStart(8,'0')+'-01234567-89abcdef-01234567'));
const freshCodes=Array.from({length:8},(_,i)=>
  (String(i+11).padStart(8,'0')+'-01234567-89abcdef-01234567'));
const qr='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
const mockGoogle=`
window.google={accounts:{id:{
 initialize(options){window.fixtureGoogle=options;},
 renderButton(target){
  const button=document.createElement('button');
  button.textContent='Sign in with Google';
  button.onclick=()=>window.fixtureGoogle.callback({credential:'verified-google-fixture'});
  target.replaceChildren(button);
 }
}}};
`;

test('Admin browser creates offline codes; lost phone completes Google + code + replacement MFA without storage',async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:320,height:700}});
    let active=false;
    const calls=[];
    await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({
      body:mockGoogle,contentType:'text/javascript'
    }));
    await page.route(origin+'/**',async route=>{
      const r=route.request(),path=new URL(r.url()).pathname;
      if(!path.startsWith('/api/')){
        const file=path==='/'?'index.html':path.slice(1);
        return route.fulfill({
          body:await readFile(new URL(file,root)),
          contentType:file.endsWith('.js')?'text/javascript':
            file.endsWith('.css')?'text/css':'text/html'
        });
      }
      const payload=r.method()==='POST'?r.postDataJSON():null;
      calls.push({path,payload});
      const json=(result,status=200)=>route.fulfill({status,json:result});
      if(path==='/api/platform/auth/session')return json(active
        ?{role:'PlatformSuperAdmin',adminRecoveryEnabled:true}: {},active?200:401);
      if(path==='/api/platform/wizard')return json({setup:false,recoveryEnabled:true});
      if(path==='/api/platform/auth/challenge')return json({
        clientId:'fixture.apps.googleusercontent.com',nonce:'nonce'
      });
      if(path==='/api/platform/auth/login'){
        active=true;return json({role:'PlatformSuperAdmin',adminRecoveryEnabled:true});
      }
      if(path==='/api/platform/auth/logout'){
        active=false;return json({signedOut:true});
      }
      if(path==='/api/platform/auth/recovery/codes'){
        assert.deepEqual(payload,{code:'123456'});
        return json({codes:originalCodes});
      }
      if(path==='/api/platform/auth/recovery/start'){
        assert.deepEqual(payload,{
          credential:'verified-google-fixture',recoveryCode:originalCodes[0]
        });
        return json({manualKey:'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',qr});
      }
      if(path==='/api/platform/auth/recovery/finish'){
        assert.deepEqual(payload,{code:'654321'});
        active=true;
        return json({recoveryCompleted:true,codes:freshCodes});
      }
      return json({},404);
    });
    await page.goto(origin);
    await page.getByRole('button',{name:'Lost authenticator? Use a recovery code'}).waitFor();
    await page.getByRole('button',{name:'Start sign-in'}).click();
    await page.getByRole('button',{name:'Sign in with Google'}).click();
    await page.getByLabel('Authenticator code').fill('123456');
    await page.getByRole('button',{name:'Verify and sign in'}).click();
    await page.getByRole('heading',{name:'Signed in as Platform Super Admin'}).waitFor();
    await page.getByText('Authenticator recovery and backup codes').click();
    await page.getByLabel('Current six-digit MFA code').fill('123456');
    await page.getByRole('button',{name:'Generate 8 backup codes'}).click();
    await page.getByLabel('Your one-time recovery codes').waitFor();
    assert.ok((await page.getByLabel('Your one-time recovery codes').inputValue())
      .includes(originalCodes[0]));
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length,
      document.documentElement.scrollWidth]),[0,0,320]);
    await page.getByRole('button',{name:"I've saved these codes"}).click();
    assert.equal(await page.getByLabel('Your one-time recovery codes').inputValue(),'');
    await page.getByRole('button',{name:'Sign out'}).click();
    await page.getByRole('button',{name:'Lost authenticator? Use a recovery code'}).click();
    await page.getByRole('button',{name:'Sign in with Google'}).click();
    await page.getByLabel('Saved recovery code').fill(originalCodes[0]);
    await page.getByRole('button',{name:'Set up replacement authenticator'}).click();
    await page.getByRole('heading',{name:'Confirm your new authenticator'}).waitFor();
    await page.getByLabel('Six-digit code from your new authenticator').fill('654321');
    await page.getByRole('button',{name:'Replace authenticator and sign in'}).click();
    await page.getByRole('heading',{name:'Signed in as Platform Super Admin'}).waitFor();
    assert.ok((await page.getByLabel('Your one-time recovery codes').inputValue())
      .includes(freshCodes[0]));
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length,
      document.documentElement.scrollWidth]),[0,0,320]);
    assert.equal(calls.filter(v=>v.path==='/api/platform/auth/recovery/start').length,1);
    assert.equal(calls.filter(v=>v.path==='/api/platform/auth/recovery/finish').length,1);
    await page.reload();
    await page.getByRole('heading',{name:'Signed in as Platform Super Admin'}).waitFor();
    assert.equal(await page.getByLabel('Your one-time recovery codes').inputValue(),'',
      'one-time codes are never persisted across reloads');
  }finally{
    await browser.close();
  }
});
