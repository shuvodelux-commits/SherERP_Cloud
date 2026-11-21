/* Optional, fail-closed Owner Invoice Studio preview-preference client.
 * The production Owner Worker does NOT yet expose this route. A 404 leaves
 * the UI strictly preview-only with no Save action. Do not treat the current
 * source invoice printer as connected to these options.
 */
(function(){
  'use strict';
  function connect(){
  const page=document.getElementById('page-invoiceDesign');
  const workspace=page?.querySelector('.hisabiq-invoice-studio');
  const draft=workspace?.invoiceDraft;
  if(!page||!workspace||!draft)return;
  const editor=workspace.querySelector('.hisabiq-invoice-editor');
  if(!editor)return;
  const API='/api/owner/invoice-profile';
  const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
  const choices={
    template:['Standard','Classic','Compact'],
    paper:['A4','80 mm','58 mm','Business Pad'],
    language:['English','English + বাংলা','Bangla']
  };
  const flags=['business','customer','sku','discount','payments','due','words','signature','warranty'];
  const model={loaded:false,status:'preview',shopId:null,revision:null,saved:null,busy:false};
  const panel=document.createElement('section');
  panel.className='hisabiq-settings-card hisabiq-invoice-profile-save';
  panel.hidden=true;
  const title=document.createElement('h3');title.textContent='Business preview preferences';
  const status=document.createElement('p');status.setAttribute('role','status');
  status.className='hisabiq-settings-description';
  const button=document.createElement('button');
  button.type='button';button.textContent='Save preview preferences';
  panel.append(title,status,button);editor.append(panel);
  const currentShop=()=>{
    const owner=window.currentUser;
    return owner?.role==='Owner' && typeof owner.id==='string'&&UUID.test(owner.id)?
      owner.id:null;
  };
  function normalize(profile){
    if(!profile||typeof profile!=='object'||Array.isArray(profile)||
       Object.keys(profile).length!==4 || !Object.hasOwn(profile,'checks'))
      throw new Error('Invalid profile response');
    for(const [key,values] of Object.entries(choices)){
      if(!Object.hasOwn(profile,key)||!values.includes(profile[key]))
        throw new Error('Unsupported profile response');
    }
    const checks=profile.checks;
    if(!checks||typeof checks!=='object'||Array.isArray(checks)||
       Object.keys(checks).length!==flags.length||
       flags.some(key=>typeof checks[key]!=='boolean'))
      throw new Error('Invalid visibility response');
    return {template:profile.template,paper:profile.paper,language:profile.language,
      checks:Object.fromEntries(flags.map(key=>[key,checks[key]]))};
  }
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function render(){
    panel.hidden=model.status==='preview'||model.status==='loading';
    if(panel.hidden)return;
    const unchanged=model.saved&&same(draft.snapshot(),model.saved);
    button.hidden=model.status!=='ready';
    button.disabled=model.busy||unchanged;
    if(model.status==='ready'){
      status.textContent=unchanged
        ?'Business preview preferences are current. Invoice printing is unchanged.'
        :'Unsaved preview preferences · নমুনার পরিবর্তন সংরক্ষিত নয়।';
    }else if(model.status==='saving')status.textContent='Saving preview preferences...';
    else if(model.status==='conflict')status.textContent=
      'The saved preferences changed elsewhere. Reload this page before saving.';
    else if(model.status==='denied')status.textContent=
      'Your Owner session or business access changed. Sign in again.';
    else status.textContent='Save outcome not confirmed. Reload and review stored preferences.';
  }
  function verifyEnvelope(json,shopId){
    if(json?.success!==true || !json.data || json.data.shopId!==shopId ||
       (json.data.revision!==null && typeof json.data.revision!=='string'))
      throw new Error('Invalid saved profile response');
    const profile=normalize(json.data.profile);
    if(json.data.revision!==null && JSON.stringify(profile)!==json.data.revision)
      throw new Error('Unverifiable saved profile revision');
    return {profile,revision:json.data.revision};
  }
  async function load(){
    const shopId=currentShop();
    if(!shopId||model.loaded||page.hidden)return;
    model.loaded=true;model.status='loading';
    const before=JSON.stringify(draft.snapshot());
    try{
      const response=await fetch(API,{method:'GET',credentials:'same-origin',
        cache:'no-store',headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(10000)});
      if(response.status===404){model.status='preview';return;}
      if(response.status===401||response.status===403){
        model.status='denied';render();return;
      }
      if(!response.ok)throw new Error('Profile read unavailable');
      const envelope=verifyEnvelope(await response.json(),shopId);
      if(currentShop()!==shopId){model.status='denied';render();return;}
      if(JSON.stringify(draft.snapshot())!==before){
        // Never discard a user's in-progress preview due to a delayed read.
        model.status='uncertain';render();return;
      }
      model.shopId=shopId;model.revision=envelope.revision;model.saved=envelope.profile;
      draft.apply(envelope.profile);model.status='ready';render();
    }catch{
      if(model.status==='loading'){model.status='uncertain';render();}
    }
  }
  workspace.addEventListener('hisabiq-invoice-draft-change',render);
  button.addEventListener('click',async()=>{
    const shopId=currentShop();
    if(model.status!=='ready'||model.busy||!shopId||model.shopId!==shopId||
       !model.saved||same(draft.snapshot(),model.saved))return;
    const intended=normalize(draft.snapshot());
    const revision=model.revision;
    model.busy=true;model.status='saving';render();
    try{
      const response=await fetch(API,{method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json','Content-Type':'application/json'},
        body:JSON.stringify({expectedRevision:revision,profile:intended}),
        signal:AbortSignal.timeout(10000)});
      if(response.status===401||response.status===403){model.status='denied';return;}
      if(response.status===409){model.status='conflict';return;}
      if(!response.ok)throw new Error('Unconfirmed save');
      const confirmed=verifyEnvelope(await response.json(),shopId);
      if(!same(confirmed.profile,intended)||confirmed.revision===null)
        throw new Error('Unexpected saved profile');
      // An HTTP success must not outlive the current authenticated Shop.
      const session=await fetch('/api/owner/auth/session',{method:'GET',
        credentials:'same-origin',cache:'no-store',
        headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(!session.ok)throw new Error('Owner session changed');
      const user=await session.json();
      if(user?.role!=='Owner'||user.shopId!==shopId||currentShop()!==shopId)
        throw new Error('Owner Shop changed');
      model.revision=confirmed.revision;model.saved=confirmed.profile;model.status='ready';
    }catch{
      if(model.status==='saving')model.status='uncertain';
    }finally{
      model.busy=false;render();
    }
  });
  const observer=new MutationObserver(()=>{if(!page.hidden)void load();});
  observer.observe(page,{attributes:true,attributeFilter:['hidden']});
  if(!page.hidden)void load();
  }
  if(document.readyState==='complete')connect();
  else document.addEventListener('DOMContentLoaded',connect,{once:true});
})();