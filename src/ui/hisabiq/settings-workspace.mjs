/* HisabIQ Settings workspace reference: pinned hisabiq_ui@e42a00a.
 * Private Owner ERP, presentation-only until authorized Shop D1 settings and
 * M04 staff membership endpoints are integrated. No mock persistence. */
(function () {
  'use strict';
  const pages={settings:'Business profile',invoiceDesign:'Invoices & printing',users:'Users & roles',roles:'Role permissions'};
  const groups=[
    {title:'Business',entries:[
      ['settings','Business profile','ব্যবসার পরিচিতি','▣'],
      [null,'Names & Khata','নাম ও খাতা','☷'],
      [null,'Sales & POS','বিক্রি ও পিওএস','▤'],
      [null,'Products & stock','পণ্য ও স্টক','▥'],
      [null,'Purchases','ক্রয়','▦'],
      ['invoiceDesign','Invoices & printing','বিল ও প্রিন্ট','▧'],
      [null,'Money & accounts','টাকা ও হিসাব','৳'],
      [null,'Notifications & SMS','বার্তা ও এসএমএস','◌']
    ]},
    {title:'Workspace',entries:[
      [null,'Interface & workflows','ইন্টারফেস','⚙'],
      ['users','Users & roles','ব্যবহারকারী ও ভূমিকা','♙'],
      ['roles','Role permissions','কে কী করতে পারবে','▤'],
      [null,'Logged-in devices','লগইন ডিভাইস','▣'],
      [null,'Staff activity','কর্মীদের কাজ','☷'],
      [null,'Data & backup','ডেটা ও ব্যাকআপ','▥'],
      [null,'Offline selling','অফলাইন বিক্রি','◌']
    ]},
    {title:'You',entries:[
      [null,'Appearance','থিম ও পছন্দ','◐'],
      [null,'Account & security','নিরাপত্তা','◇']
    ]}
  ];
  const groupClasses='hisabiq-settings-layout';
  const build=(tag,className,text)=>{
    const node=document.createElement(tag);
    if(className)node.className=className;
    if(text!==undefined)node.textContent=text;
    return node;
  };
  function makeNav(current){
    const aside=build('aside','hisabiq-settings-nav');
    const home=build('button','hisabiq-settings-home');
    home.type='button';
    home.addEventListener('click',()=>{if(typeof window.goToPage==='function')window.goToPage('settings');});
    home.append(build('strong','','Settings home'),build('span','','সেটিংস হোম'));
    aside.append(home);
    const input=build('input','hisabiq-settings-search');
    input.type='search';input.placeholder='Search settings';input.setAttribute('aria-label','Search settings');
    aside.append(input);
    const nav=build('nav','hisabiq-settings-directory');
    nav.setAttribute('aria-label','Settings categories');
    const items=[];
    groups.forEach(group=>{
      const section=build('div','hisabiq-settings-group');
      section.append(build('p','hisabiq-settings-group-title',group.title));
      group.entries.forEach(([key,label,bn,glyph])=>{
        const entry=build(key?'button':'span',key?'hisabiq-settings-nav-item':'hisabiq-settings-nav-item hisabiq-settings-coming');
        if(key){entry.type='button';entry.dataset.settingsPage=key;
          if(key===current){entry.classList.add('is-active');entry.setAttribute('aria-current','page');}
          entry.addEventListener('click',()=>{if(typeof window.goToPage==='function')window.goToPage(key);});
        }else{entry.setAttribute('aria-disabled','true');entry.title='Not connected to this Shop yet';}
        entry.append(build('span','hisabiq-settings-nav-icon',glyph));
        const copy=build('span','hisabiq-settings-nav-copy');
        copy.append(build('span','',label),build('small','',bn));entry.append(copy);
        section.append(entry);items.push({entry,section,text:(label+' '+bn+' '+group.title).toLowerCase()});
      });nav.append(section);
    });
    const empty=build('p','hisabiq-settings-empty','No matching settings.');empty.hidden=true;
    nav.append(empty);aside.append(nav);
    input.addEventListener('input',()=>{
      const value=input.value.trim().toLowerCase();let total=0;
      items.forEach(({entry,text})=>{entry.hidden=!!value&&!text.includes(value);if(!entry.hidden)total++;});
      nav.querySelectorAll('.hisabiq-settings-group').forEach(section=>{
        section.hidden=![...section.querySelectorAll('.hisabiq-settings-nav-item')].some(n=>!n.hidden);
      });empty.hidden=total>0;
    });
    return aside;
  }
  function notice(message){
    const node=build('p','hisabiq-settings-alert',message);
    node.setAttribute('role','status');return node;
  }
  function disableUnconnectedForm(content){
    // This private Owner Worker does not expose the source settings/users/roles
    // write RPCs. Preserve the original markup for future M03/M04 integration,
    // but NEVER offer buttons which can only fail (or falsely claim a save).
    content.querySelectorAll('input,textarea,select,button').forEach(el=>{
      el.disabled=true;el.setAttribute('aria-disabled','true');
    });
    content.classList.add('hisabiq-settings-readonly');
  }
  function mountPage(key){
    const page=document.getElementById('page-'+key);
    if(!page||page.dataset.hisabiqSettings==='installed')return;
    page.dataset.hisabiqSettings='installed';
    const legacy=build('div','hisabiq-settings-legacy');
    while(page.firstChild)legacy.append(page.firstChild);
    const layout=build('div',groupClasses);
    const article=build('article','hisabiq-settings-main');
    const header=build('header','hisabiq-settings-heading');
    header.append(build('h2','',pages[key]));
    header.append(build('p','',key==='invoiceDesign'?'বিল ও প্রিন্ট':key==='settings'?'ব্যবসার পরিচিতি':key==='users'?'ব্যবহারকারী ও ভূমিকা':'অনুমতির তালিকা'));
    article.append(header);
    if(key==='invoiceDesign'){
      article.append(notice('Preview only · নমুনা মাত্র। Invoice designs, paper, language and visibility changes are not saved to your business. Existing printing remains unchanged.'));
      article.append(makeInvoiceStudio());
    }else if(key==='users'||key==='roles'){
      article.append(notice('Business-scoped staff access is pending secure M04 integration. Existing user and role fields are read-only until login, permissions and revocation are connected.'));
    }else{
      article.append(notice('These fields are read-only for the current Owner session. No Shop D1 settings-save endpoint is connected.'));
    }
    disableUnconnectedForm(legacy);
    if(key==='invoiceDesign'){
      const details=build('details','hisabiq-settings-original');
      details.append(build('summary','','Existing invoice fields · backend connection pending'),legacy);
      article.append(details);
    }else article.append(legacy);
    layout.append(makeNav(key),article);page.append(layout);
  }
  function makeInvoiceStudio(){
    const state={template:'Standard',paper:'A4',language:'English + বাংলা',checks:{business:true,customer:true,sku:true,discount:true,payments:true,due:true,words:true,signature:true,warranty:true}};
    const workspace=build('div','hisabiq-invoice-studio');
    const gallery=build('section','hisabiq-settings-card');
    gallery.append(build('h3','','Choose a design'),build('p','hisabiq-settings-description','ডিজাইন বাছাই · Three printable reference designs; three additional designs are not connected.'));
    const designs=build('div','hisabiq-invoice-design-grid');designs.setAttribute('role','radiogroup');designs.setAttribute('aria-label','Invoice design preview');
    const designButtons=[];
    ['Standard','Classic','Compact','Modern','Elegant','Bold'].forEach(name=>{
      const supported=['Standard','Classic','Compact'].includes(name);
      const button=build('button','hisabiq-invoice-design');button.type='button';button.disabled=!supported;button.dataset.invoiceDesign=name;
      button.setAttribute('role','radio');button.setAttribute('aria-checked',String(state.template===name));
      const thumb=build('span','hisabiq-invoice-thumbnail '+name.toLowerCase());
      thumb.append(build('i','','◯ ▬'),build('i','','━━━━━━'),build('i','','━━━━━'),build('i','','──────'),build('i','','━━━━━━'));
      button.append(thumb,build('strong','',name),build('small','',supported?'Live preview':'Unavailable'));
      if(supported)button.addEventListener('click',()=>{
        state.template=name;designButtons.forEach(b=>{b.setAttribute('aria-checked',String(b.dataset.invoiceDesign===name));b.classList.toggle('is-active',b===button);});
        updatePreview();
      });
      designs.append(button);designButtons.push(button);
    });
    designButtons[0].classList.add('is-active');gallery.append(designs);
    const controls=build('section','hisabiq-settings-card');
    controls.append(build('h3','','Print & language'),build('p','hisabiq-settings-description','কাগজ ও ভাষা · Preview preferences only'));
    const fields=build('div','hisabiq-invoice-controls');
    const selectors=Object.create(null),visibility=Object.create(null);
    [['paper','Paper size','কাগজের মাপ',['A4','80 mm','58 mm','Business Pad']],['language','Document language','বিলের ভাষা',['English','English + বাংলা','Bangla']]].forEach(([field,title,bn,options])=>{
      const label=build('label','hisabiq-invoice-field');label.append(build('span','',title+' · '+bn));
      const select=build('select','');select.dataset.touchSelectSkip='true';select.setAttribute('aria-label',title);
      options.forEach(opt=>{const o=build('option','',opt);o.value=opt;select.append(o);});
      select.value=state[field];selectors[field]=select;select.addEventListener('change',()=>{state[field]=select.value;updatePreview();});
      label.append(select);fields.append(label);
    });controls.append(fields);
    const visibilityCard=build('section','hisabiq-settings-card');
    visibilityCard.append(build('h3','','Invoice content'),build('p','hisabiq-settings-description','বিলে কী দেখাবেন · Preview options, not business settings'));
    const toggles=build('div','hisabiq-invoice-toggles');
    const flags=[['business','Business information','ব্যবসার পরিচিতি'],['customer','Customer details','ক্রেতার তথ্য'],['sku','Product code','পণ্যের কোড'],['discount','Discount','ছাড়'],['payments','Payment breakdown','পেমেন্ট'],['due','Due amount','বাকি'],['words','Amount in words','কথায় টাকা'],['signature','Signature','স্বাক্ষর'],['warranty','Warranty','ওয়ারেন্টি']];
    flags.forEach(([key,label,bn])=>{
      const row=build('label','hisabiq-invoice-toggle');const box=build('input','');
      box.type='checkbox';box.checked=state.checks[key];visibility[key]=box;box.addEventListener('change',()=>{state.checks[key]=box.checked;updatePreview();});
      row.append(box,build('span','',label+' · '+bn));toggles.append(row);
    });visibilityCard.append(toggles);
    const previewCard=build('section','hisabiq-settings-card hisabiq-invoice-preview-card');
    const titleRow=build('div','hisabiq-invoice-preview-heading');
    titleRow.append(build('h3','','Live sample preview'),build('span','','Not a saved invoice'));
    previewCard.append(titleRow);
    const preview=build('div','hisabiq-invoice-preview');preview.setAttribute('aria-label','Invoice sample preview');
    previewCard.append(preview);
    const left=build('div','hisabiq-invoice-editor');left.append(gallery,controls,visibilityCard);
    workspace.append(left,previewCard);
    function updatePreview(){
      preview.replaceChildren();
      preview.dataset.paper=state.paper.replaceAll(' ','').toLowerCase();
      const paper=build('div','hisabiq-invoice-paper hisabiq-invoice-'+state.template.toLowerCase());
      const heading=build('div','hisabiq-invoice-paper-head');
      if(state.checks.business){
        heading.append(build('strong','','Demo Business'),build('small','',state.language==='Bangla'?'নমুনা ব্যবসা':'Sample hardware store'));
      }
      heading.append(build('span','',state.language==='Bangla'?'বিক্রির চালান':'SALES INVOICE'));
      paper.append(heading);
      paper.append(build('p','hisabiq-invoice-meta','INV-PREVIEW · 21 Nov 2026'));
      if(state.checks.customer)paper.append(build('p','hisabiq-invoice-meta',state.language==='Bangla'?'ক্রেতা: রহিম ট্রেডার্স':'Customer: Rahim Traders'));
      const table=build('table','hisabiq-invoice-lines');
      const thead=build('thead','');const tr=build('tr','');
      ['Item','Qty','Price','Amount'].forEach(t=>tr.append(build('th','',t)));thead.append(tr);table.append(thead);
      const body=build('tbody','');[['LED bulb','2 Pcs','৳250','৳500'],['Electric cable','1 Roll','৳1500','৳1500']].forEach((line,index)=>{
        const tr=build('tr','');line.forEach((text,i)=>tr.append(build('td','',i===0&&state.checks.sku?text+(index?' · WIRE-001':' · LED-001'):text)));
        body.append(tr);
      });table.append(body);paper.append(table);
      const totals=build('div','hisabiq-invoice-totals');
      if(state.checks.discount)totals.append(build('p','','Discount  ৳0'));
      totals.append(build('strong','','Total  ৳2,000'));
      if(state.checks.payments)totals.append(build('p','','Paid · Cash  ৳1,500'));
      if(state.checks.due)totals.append(build('p','','Due  ৳500'));
      paper.append(totals);
      if(state.checks.words)paper.append(build('p','hisabiq-invoice-note','Two thousand taka only'));
      if(state.checks.warranty)paper.append(build('p','hisabiq-invoice-note','Warranty applies where specified.'));
      if(state.checks.signature)paper.append(build('div','hisabiq-invoice-signatures','Customer signature             Authorized signature'));
      paper.append(build('footer','','Thank you · ধন্যবাদ'));
      preview.append(paper);
      workspace.dispatchEvent(new Event('hisabiq-invoice-draft-change'));
    }
    // Client persistence adapter is separate, and cannot alter the original
    // receipt renderer or invoke an unrelated Settings/Users RPC.
    workspace.invoiceDraft={
      snapshot:()=>JSON.parse(JSON.stringify(state)),
      apply(profile){
        if(!profile || typeof profile!=='object')throw new TypeError('Invalid profile');
        state.template=profile.template;state.paper=profile.paper;
        state.language=profile.language;state.checks={...profile.checks};
        designButtons.forEach(b=>{
          const selected=b.dataset.invoiceDesign===state.template;
          b.classList.toggle('is-active',selected);b.setAttribute('aria-checked',String(selected));
        });
        Object.entries(selectors).forEach(([key,input])=>input.value=state[key]);
        Object.entries(visibility).forEach(([key,input])=>input.checked=state.checks[key]);
        updatePreview();
      }
    };
    updatePreview();return workspace;
  }
  function mount(){
    // The Owner Worker has no approved source Settings/User/Role RPCs.
    // Prevent legacy page-enter bootstraps from displaying misleading network
    // failure toasts in the new read-only interface; never fake a response.
    ['setState','ivState','usrState','rolState'].forEach(name=>{
      if(window[name] && typeof window[name]==='object')window[name]._loaded=true;
    });
    Object.keys(pages).forEach(mountPage);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
