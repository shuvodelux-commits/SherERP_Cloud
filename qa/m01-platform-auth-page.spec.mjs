import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {chromium} from 'playwright';
import privateWorker from '../src/m03-private-platform-auth-worker.js';

const origin='https://platform.example.test';
const pageRoot=new URL('../frontend/platform-auth/',import.meta.url);
const fakeGoogle=`
  window.google={accounts:{id:{
    initialize(options){window.fixtureGoogle=options;},
    renderButton(target){
      const button=document.createElement('button');
      button.textContent='Sign in with Google';
      button.onclick=()=>window.fixtureGoogle.callback({credential:'fixture-signed-assertion'});
      target.replaceChildren(button);
    }
  }}};
`;

test('private platform page sets up the admin, signs in with MFA, restores and signs out',async()=>{
  const html=await readFile(new URL('index.html',pageRoot));
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:320,height:640}});
    let active=false;
    let reservationsEnabled=false;
    let reservationAttempts=0;
    let delayedChallenge;
    const calls=[];
    await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({
      body:fakeGoogle,contentType:'text/javascript',
    }));
    await page.route(origin+'/**',async route=>{
      const request=route.request();
      const path=new URL(request.url()).pathname;
      if(!path.startsWith('/api/')){
        const reply=await privateWorker.fetch(new Request(request.url()),{
          PLATFORM_AUTH_SCOPE:'private-platform-auth',PLATFORM_AUTH_ORIGIN:origin,
          PLATFORM_CLIENT_ID:'123-example.apps.googleusercontent.com',
          PLATFORM_INGRESS:{limit(){}},CONTROL_DB:{prepare(){},batch(){}},
          ASSETS:{async fetch(assetRequest){
            const file=new URL(assetRequest.url).pathname.slice(1);
            return new Response(file==='index.html'?html:await readFile(new URL(file,pageRoot)));
          }},
        });
        return route.fulfill({
          status:reply.status,headers:Object.fromEntries(reply.headers),
          body:Buffer.from(await reply.arrayBuffer()),
        });
      }
      const input=request.postDataJSON();
      calls.push({path,input});
      if(path==='/api/platform/auth/session')
        return route.fulfill({status:active?200:401,json:active?{
          role:'PlatformSuperAdmin',...(reservationsEnabled?{shopReservationEnabled:true,ownerInvitationShopId:'11111111-1111-4111-8111-111111111111'}:{}),
        }:{}});
      if(path==='/api/platform/shops'){
        if(++reservationAttempts===1)return route.fulfill({status:503,json:{}});
        if(reservationAttempts===3)return route.fulfill({status:409,json:{}});
        return route.fulfill({status:200,json:{
          shopId:'11111111-1111-4111-8111-111111111111',displayName:input.displayName,status:'reserved',
        }});
      }
      if(path==='/api/platform/shops/invite-owner')
        return route.fulfill({status:201,json:{inviteCode:'a'.repeat(64),expiresAtMs:Date.now()+600_000}});
      if(path.endsWith('/challenge')){
        if(path==='/api/platform/auth/challenge'&&delayedChallenge)await delayedChallenge;
        return route.fulfill({json:{clientId:'123-example.apps.googleusercontent.com',nonce:'a'.repeat(43)}});
      }
      if(path==='/api/platform/setup')
        return route.fulfill({json:{enrolled:true}});
      if(path==='/api/platform/auth/login'){
        if(input?.code==='111111')return route.fulfill({status:401,json:{}});
        active=true;
        return route.fulfill({json:{role:'PlatformSuperAdmin'}});
      }
      if(path==='/api/platform/auth/logout'){
        active=false;
        return route.fulfill({json:{signedOut:true}});
      }
      return route.fulfill({status:404});
    });

    await page.goto(origin);
    await page.getByRole('heading',{name:'Platform sign-in'}).waitFor();
    await page.getByRole('button',{name:'Set up administrator'}).click();
    const ticket=page.getByLabel('Setup ticket');
    await ticket.fill('a'.repeat(64));
    await page.getByRole('button',{name:'Continue setup'}).click();
    await page.getByRole('button',{name:'Sign in with Google'}).click();
    await page.getByText('Setup complete. Sign in to continue.').waitFor();
    assert.deepEqual(calls.find(call=>call.path==='/api/platform/setup/challenge')?.input,{setupToken:'a'.repeat(64)});
    assert.deepEqual(calls.find(call=>call.path==='/api/platform/setup')?.input,{credential:'fixture-signed-assertion'});
    assert.equal(await ticket.inputValue(),'');

    async function openAuthenticator(){
      await page.getByRole('button',{name:'Start sign-in'}).click();
      await page.getByRole('button',{name:'Sign in with Google'}).click();
      await page.getByLabel('Authenticator code').waitFor();
    }
    let releaseChallenge;
    delayedChallenge=new Promise(resolve=>{releaseChallenge=resolve;});
    await page.getByRole('button',{name:'Start sign-in'}).click();
    try{
      assert.equal(await page.getByRole('button',{name:'Cancel'}).isDisabled(),true);
    }finally{
      releaseChallenge();
      delayedChallenge=undefined;
    }
    await page.getByRole('button',{name:'Sign in with Google'}).click();
    await page.getByLabel('Authenticator code').fill('111111');
    await page.getByRole('button',{name:'Verify and sign in'}).click();
    await page.getByText('Could not sign in. Start sign-in again.').waitFor();
    await openAuthenticator();
    await page.getByLabel('Authenticator code').fill('123456');
    await page.getByRole('button',{name:'Verify and sign in'}).click();
    await page.getByRole('heading',{name:'Signed in as Platform Super Admin'}).waitFor();
    assert.deepEqual(calls.filter(call=>call.path==='/api/platform/auth/login').at(-1)?.input,
      {credential:'fixture-signed-assertion',code:'123456'});
    assert.equal(await page.getByLabel('Authenticator code').inputValue(),'');
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length,location.search]),[0,0,'']);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);

    assert.equal(await page.getByRole('button',{name:'Create business'}).isVisible(),false);
    reservationsEnabled=true;
    await page.reload();
    const create=page.getByRole('button',{name:'Create business'});
    const businessName=page.getByRole('textbox',{name:'Business name'});
    await businessName.fill('আমার দোকান',{timeout:5000});
    await create.click();
    await page.getByText('Could not confirm the reservation. Retry to check the same request.').waitFor();
    await page.reload();
    await businessName.waitFor();
    assert.equal(await businessName.inputValue(),'আমার দোকান');
    await create.click();
    await page.getByText('Business reserved. Shop ID: 11111111-1111-4111-8111-111111111111.',{exact:false}).waitFor();
    const requests=calls.filter(call=>call.path==='/api/platform/shops').map(call=>call.input);
    assert.equal(requests.length,2);
    assert.deepEqual(requests[0],requests[1]);
    assert.equal(requests[0].displayName,'আমার দোকান');
    assert.match(requests[0].operationId,/^[0-9a-f-]{36}$/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
    assert.equal(await page.evaluate(()=>sessionStorage.length),0);

    await businessName.fill('Another business');
    await create.click();
    await page.getByText('This request conflicts with an existing reservation.',{exact:false}).waitFor();
    assert.equal(await businessName.isEditable(),true);
    assert.equal(await page.evaluate(()=>sessionStorage.length),0);

    await page.reload();
    await page.getByRole('heading',{name:'Signed in as Platform Super Admin'}).waitFor();
    await page.getByRole('textbox',{name:'Verified Google account ID'}).fill('123456789012345678901',{timeout:5000});
    await page.getByRole('button',{name:'Invite Owner'}).click();
    const issuedCode=page.getByRole('textbox',{name:'Owner invitation code'});
    await issuedCode.waitFor();
    assert.equal(await issuedCode.inputValue(),'a'.repeat(64));
    assert.deepEqual(calls.find(call=>call.path==='/api/platform/shops/invite-owner')?.input,
      {googleSubject:'123456789012345678901'});
    assert.equal(await page.evaluate(()=>sessionStorage.length),0);
    await page.getByRole('button',{name:'Sign out'}).click();
    await page.getByRole('heading',{name:'Platform sign-in'}).waitFor();
    assert.equal(await page.locator('#owner-invitation-code').inputValue(),'');
  }finally{
    await browser.close();
  }
});

test('Owner page redeems an invite, signs in, restores and signs out',async()=>{
  const {default:ownerWorker}=await import('../src/m03-owner-redemption-worker.js');
  const ownerOrigin='https://owner.example.test';
  const assets=new URL('../frontend/owner-auth/',import.meta.url);
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:320,height:640}});
    let active=false;
    const seen=[];
    const shopId='11111111-1111-4111-8111-111111111111';
    await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({
      body:fakeGoogle,contentType:'text/javascript',
    }));
    await page.route(ownerOrigin+'/**',async route=>{
      const request=route.request();
      const path=new URL(request.url()).pathname;
      if(!path.startsWith('/api/')){
        const reply=await ownerWorker.fetch(new Request(request.url()),{
          OWNER_AUTH_ORIGIN:ownerOrigin,PLATFORM_AUTH_ORIGIN:origin,PLATFORM_OWNER_CLIENT_ID:'654-example.apps.googleusercontent.com',
          OWNER_LOGIN_ENABLED:'true',OWNER_REDEMPTION_ENABLED:'true',OWNER_INGRESS:{limit:async()=>({success:true})},
          CONTROL_DB:{prepare(){}},
          ASSETS:{async fetch(asset){return new Response(await readFile(new URL(new URL(asset.url).pathname.slice(1),assets)));}},
        });
        return route.fulfill({status:reply.status,headers:Object.fromEntries(reply.headers),body:Buffer.from(await reply.arrayBuffer())});
      }
      seen.push({path,data:request.postDataJSON()});
      if(path.endsWith('/session'))return route.fulfill({status:active?200:401,json:active?{shopId,role:'Owner'}:{}});
      if(path.endsWith('/challenge'))return route.fulfill({json:{clientId:'654-example.apps.googleusercontent.com',nonce:'a'.repeat(43)}});
      if(path.endsWith('/setup'))return route.fulfill({status:201,json:{shopId,role:'Owner'}});
      if(path.endsWith('/login')){active=true;return route.fulfill({json:{role:'Owner'}});}
      if(path.endsWith('/logout')){active=false;return route.fulfill({json:{signedOut:true}});}
      return route.fulfill({status:404});
    });
    await page.goto(ownerOrigin);
    await page.getByRole('button',{name:'Accept invitation'}).click({timeout:5000});
    await page.getByLabel('Owner invitation code').fill('b'.repeat(64));
    await page.getByRole('button',{name:'Continue setup'}).click();
    await page.getByRole('button',{name:'Sign in with Google'}).click();
    await page.getByText('Invitation accepted. Sign in to continue.').waitFor();
    assert.equal(await page.locator('#invite-code').inputValue(),'');
    assert.deepEqual(seen.find(item=>item.path==='/api/owner/setup/challenge')?.data,{inviteCode:'b'.repeat(64)});
    assert.deepEqual(seen.find(item=>item.path==='/api/owner/setup')?.data,{credential:'fixture-signed-assertion'});
    await page.getByRole('button',{name:'Start sign-in'}).click();
    await page.getByRole('button',{name:'Sign in with Google'}).click();
    await page.getByRole('heading',{name:'Signed in as Shop Owner'}).waitFor();
    await page.reload();
    await page.getByRole('heading',{name:'Signed in as Shop Owner'}).waitFor();
    await page.getByText(shopId,{exact:false}).waitFor();
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length,location.search]),[0,0,'']);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
    await page.getByRole('button',{name:'Sign out'}).click();
    await page.getByRole('heading',{name:'Shop Owner sign-in'}).waitFor();
  }finally{
    await browser.close();
  }
});
