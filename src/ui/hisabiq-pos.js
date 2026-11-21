/* HisabIQ POS reference-preserving DOM adaptation.
 * Real Owner Worker / Shop D1 and the original POS actions remain authoritative.
 * Source: hisabiq_ui@e42a00a Pos.tsx, CartTable, CheckoutPanel, CustomerPicker.
 */
(function () {
  'use strict';
  var page=document.getElementById('page-pos');
  if(!page||!page.hasAttribute('data-hisabiq-pos')||page.dataset.hiPosMounted==='true')return;
  var sel=function(selector,parent){return (parent||page).querySelector(selector);};
  var make=function(tag,cls,text){
    var el=document.createElement(tag);if(cls)el.className=cls;
    if(text!==undefined)el.textContent=text;return el;
  };
  var state={customerMenuOpen:false,detailsOpen:false,discountMode:'amount',discountText:'',drag:null};
  var nativeDiscount=null,discountInput=null,primary=null,split=null,addPay=null,
    pickerLabel=null,pickerMeta=null,pickerMenu=null,feedback=null,amount=null;
  var cart=sel('#posCartList');
  var originalPaint=typeof posRenderCart_==='function'?posRenderCart_:null;

  function money(value){
    var n=Number(value);
    return '৳'+(Number.isFinite(n)?n:0).toLocaleString('en-BD',{maximumFractionDigits:2,minimumFractionDigits:0});
  }
  function sourceSubTotal(){
    if(typeof posState==='undefined'||!Array.isArray(posState.cart))return 0;
    return posState.cart.reduce(function(total,line){return total+(Number(line.lineTotal)||0);},0);
  }
  function nativeChange(el){
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function canSplit(){
    return typeof posState!=='undefined'&&posState.multiPaymentEnabled===true &&
      typeof posMultiPaymentEnabledForSale_==='function'&&posMultiPaymentEnabledForSale_();
  }
  function updateCustomer(){
    var chosen=sel('#posCustomerName');
    var id=chosen&&chosen.dataset.customerId;
    var guest=!id;
    if(pickerLabel)pickerLabel.textContent=guest?'Walk-in customer':chosen.value||'Selected customer';
    if(pickerMeta)pickerMeta.textContent=guest?'Guest checkout pending D1':
      (sel('#posCustomerPhone').value||'Registered customer');
    page.dataset.hiPosGuest=guest?'true':'false';
  }
  function selectGuest(){
    if(typeof posClearCustomer_==='function')posClearCustomer_();
    var input=sel('#posCustomerName');
    if(input){input.value='';input.dataset.customerId='';}
    var phone=sel('#posCustomerPhone');if(phone)phone.value='';
    state.customerMenuOpen=false;
    if(pickerMenu)pickerMenu.hidden=true;
    updateCustomer();
  }
  function selectCustomer(record){
    if(typeof posApplyCustomerSelection_==='function')posApplyCustomerSelection_(record);
    state.customerMenuOpen=false;if(pickerMenu)pickerMenu.hidden=true;
    updateCustomer();
  }
  function customerMatches(q){
    var customers=typeof posState!=='undefined'&&Array.isArray(posState.customers)?posState.customers:[];
    var query=(q||'').toLocaleLowerCase();
    return customers.filter(function(c){
      return !query||[c.name,c.phone,c.id].some(function(value){
        return String(value||'').toLocaleLowerCase().includes(query);
      });
    }).slice(0,25);
  }
  function renderCustomerMenu(query){
    if(!pickerMenu)return;
    pickerMenu.replaceChildren();
    var input=make('input');
    input.type='search';input.placeholder='Search customer by name or phone';
    input.setAttribute('aria-label','Search registered customers');
    input.value=query||'';
    pickerMenu.appendChild(input);
    var guest=make('button','hi-pos-customer-option','Walk-in customer');
    guest.type='button';guest.dataset.hiCustomerGuest='true';
    guest.addEventListener('click',selectGuest);
    pickerMenu.appendChild(guest);
    var matches=customerMatches(query);
    matches.forEach(function(customer){
      var item=make('button','hi-pos-customer-option',customer.name||customer.id);
      item.type='button';item.dataset.hiCustomerId=customer.id;
      item.appendChild(make('small','',customer.phone||customer.id||''));
      item.addEventListener('click',function(){selectCustomer(customer);});
      pickerMenu.appendChild(item);
    });
    if(!matches.length)pickerMenu.appendChild(make('div','hi-pos-unsupported-note',
      'No registered customers found in the connected Shop.'));
    input.addEventListener('input',function(){
      var q=input.value,from=input.selectionStart;
      renderCustomerMenu(q);
      var next=pickerMenu.querySelector('input');next.focus();
      try{next.setSelectionRange(from,from);}catch{}
    });
    input.addEventListener('keydown',function(e){
      if(e.key==='Escape'){state.customerMenuOpen=false;pickerMenu.hidden=true;sel('#hi-pos-customer-picker').focus();}
      if(e.key==='Enter'){
        var first=pickerMenu.querySelector('[data-hi-customer-id]');
        if(first){e.preventDefault();first.click();}
      }
    });
  }
  function refreshTotals(){
    if(!feedback)return;
    var total=Number((sel('#posGrandTotal')||{}).textContent?.replace(/[^0-9.-]/g,''))||0;
    var displaySubtotal=sel('#hi-pos-subtotal');
    var displayLabel=sel('#hi-pos-subtotal-label');
    var displayGrand=sel('#hi-pos-grand');
    var nativeMethod=sel('#posPaymentMethod');
    var proxyMethod=sel('#hi-pos-payment-method');
    var proxyAmount=sel('#hi-pos-payment-amount');
    if(displaySubtotal)displaySubtotal.textContent=money(sourceSubTotal());
    if(displayLabel)displayLabel.textContent='Subtotal · '+(posState?.cart?.length||0)+' items';
    if(displayGrand)displayGrand.textContent=money(total);
    if(proxyMethod&&nativeMethod&&document.activeElement!==proxyMethod)
      proxyMethod.value=nativeMethod.value;
    if(proxyAmount&&amount&&document.activeElement!==proxyAmount)
      proxyAmount.value=amount.value;
    var account=sel('#hi-pos-payment-account');
    if(account&&nativeMethod)
      account.textContent=nativeMethod.value==='Cash'?'Cash counter':
        nativeMethod.value==='Bank'?'Bank account':'Mobile banking account';
    if(canSplit()&&split&&split.childElementCount!==(posState.paymentRows||[]).length)
      renderPaymentRows();
    var paid=0;
    if(canSplit()){
      paid=(posState.paymentRows||[]).reduce(function(v,row){return v+(Number(row.amount)||0);},0);
    }else paid=Number(amount&&amount.value)||0;
    var copy=feedback.querySelectorAll('strong span');
    if(copy[0])copy[0].textContent=money(Math.min(total,paid));
    if(copy[1])copy[1].textContent=money(Math.max(0,paid-total));
    if(copy[2])copy[2].textContent=money(Math.max(0,total-paid));
    if(primary)primary.hidden=canSplit();
    if(split)split.hidden=!canSplit();
    if(addPay){
      addPay.disabled=!canSplit();
      addPay.title=canSplit()?'Add another payment':'Multiple payments are not connected for this Shop yet';
    }
  }
  function fillPayment(value){
    if(canSplit()){
      var rows=sel('#posMultiPaymentRows');
      var first=rows&&rows.querySelector('[data-payment-field="amount"]');
      if(first){first.value=String(value);nativeChange(first);}
    }else if(amount){
      amount.value=String(value);nativeChange(amount);
      var visible=sel('#hi-pos-payment-amount');
      if(visible)visible.value=String(value);
    }
    refreshTotals();
  }
  function computeDiscount(){
    if(!nativeDiscount||!discountInput)return;
    var value=Number(discountInput.value),subtotal=sourceSubTotal();
    var valid=Number.isFinite(value)&&value>=0&&
      (state.discountMode!=='percent'||value<=100);
    if(!valid){discountInput.setCustomValidity('Enter a valid discount.');return;}
    discountInput.setCustomValidity('');
    var discount=state.discountMode==='percent'?Math.round(subtotal*value)/100:value;
    nativeDiscount.value=String(Math.round(discount*100)/100);
    nativeChange(nativeDiscount);
    refreshTotals();
  }
  function setMode(mode){
    state.discountMode=mode;
    var buttons=page.querySelectorAll('[data-hi-discount-mode]');
    buttons.forEach(function(b){b.setAttribute('aria-pressed',b.dataset.hiDiscountMode===mode?'true':'false');});
    if(discountInput){
      discountInput.value='';nativeDiscount.value='';nativeChange(nativeDiscount);
      discountInput.placeholder=mode==='percent'?'%':'0';
    }
  }
  function cartMove(from,to){
    if(typeof posState==='undefined'||!Array.isArray(posState.cart))return;
    var rows=posState.cart;
    if(from<0||to<0||from>=rows.length||to>=rows.length||from===to)return;
    var next=rows.splice(from,1)[0];rows.splice(to,0,next);
    if(typeof posRenderCart_==='function')posRenderCart_();
    decorateCart();
  }
  function decorateCart(){
    if(!cart)return;
    // The original POS V2 route owns its native, pointer-draggable handles.
    // Never add a second grip or override that protected presentation route.
    if(document.body.classList.contains('pos-v2-active')){
      cart.querySelectorAll('.hi-pos-grip').forEach(function(grip){grip.remove();});
      return;
    }
    var entry=cart.querySelector('.pos-cart-entry-row:not(.is-active) input[data-cart-product-mode="add"]');
    if(entry)entry.placeholder='⌕ Add product... name, SKU or বাংলা';
    var rows=Array.from(cart.querySelectorAll(':scope > .cart-row:not(.pos-cart-entry-row)'));
    rows.forEach(function(row,index){
      if(row.querySelector('.hi-pos-grip'))return;
      var button=make('button','hi-pos-grip','⋮⋮');
      button.type='button';button.draggable=true;
      button.dataset.hiPosRow=String(index+1);
      button.setAttribute('aria-label','Reorder cart item '+(index+1));
      button.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown');
      button.title='Drag to reorder · use Up / Down keys';
      button.addEventListener('keydown',function(event){
        if(event.key==='ArrowUp'||event.key==='ArrowDown'){
          event.preventDefault();
          cartMove(index,index+(event.key==='ArrowUp'?-1:1));
        }
      });
      button.addEventListener('dragstart',function(event){
        state.drag=index;row.classList.add('hi-pos-dragging');
        if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',String(index));}
      });
      button.addEventListener('dragend',function(){row.classList.remove('hi-pos-dragging');state.drag=null;});
      button.addEventListener('pointerdown',function(event){
        if(event.pointerType==='mouse')return;
        state.drag=index;button.setPointerCapture(event.pointerId);
      });
      button.addEventListener('pointerup',function(event){
        if(state.drag===null)return;
        var target=document.elementFromPoint(event.clientX,event.clientY);
        var rowTarget=target&&target.closest('#posCartList > .cart-row');
        var next=rows.indexOf(rowTarget);
        if(next>=0)cartMove(state.drag,next);state.drag=null;
      });
      row.addEventListener('dragover',function(event){event.preventDefault();});
      row.addEventListener('drop',function(event){
        event.preventDefault();if(state.drag!==null)cartMove(state.drag,index);state.drag=null;
      });
      row.prepend(button);
      var unit= row.querySelector('.c-unit-wrap .c-unit');
      if(unit && !unit.querySelector('[data-hi-pos-unit]')){
        var current=String(posState?.cart?.[index]?.unit||unit.textContent||'').trim();
        var wrap=make('span','hi-pos-inline-unit');
        var unitButton=make('select');unitButton.dataset.hiPosUnit=String(index);
        unitButton.setAttribute('aria-label','Sale unit for item '+(index+1));
        var option=make('option','',current||'Unit');option.value=current;unitButton.appendChild(option);
        // Do not permit unverified multi-unit stock/money posting. The current
        // Owner D1 sale accepts only one Standard SKU and whole base units.
        unitButton.disabled=true;
        unitButton.title='Unit switching requires verified multi-unit Shop D1 checkout';
        wrap.appendChild(unitButton);unit.replaceChildren(wrap);
      }
    });
  }
  function renderQuickProducts(){
    var card=sel('.pos-product-card');
    if(!card||card.querySelector('.hi-pos-quick-heading'))return;
    var title=make('div','hi-pos-quick-heading','Quick items · দ্রুত যোগ');
    title.appendChild(make('small','','Tap to add'));
    card.prepend(title);
  }
  function mount(){
    var layout=sel('.pos-layout'),catalog=sel('.pos-product-card'),
      nativeCustomer=sel('.pos-customer-section'),nativeCart=sel('.pos-cart-section');
    if(!layout||!catalog||!nativeCustomer||!nativeCart||!cart)return;
    page.dataset.hiPosMounted='true';
    // The actual navigation POS route uses the annotated Owner layout. The
    // separate legacy 'posv2' QA route keeps the original V2 presentation,
    // invoice preview, amount-in-words, dark theme and original mobile tabs.
    // POS V2 is the sole authenticated user-facing POS route. Keep the
    // annotated layout active there as well as in the direct POS view.
    // A presentation-only legacy fallback is available for visual regression
    // and rollback; it does not change checkout, permissions or D1 authority.
    var legacyVisual=new URLSearchParams(window.location.search).get('posLegacy')==='1';
    function syncPosPresentation(){
      if(legacyVisual)page.removeAttribute('data-hisabiq-pos');
      else page.setAttribute('data-hisabiq-pos','');
      decorateCart();
    }
    new MutationObserver(syncPosPresentation).observe(document.body,{
      attributes:true,attributeFilter:['class']
    });
    syncPosPresentation();
    var heading=make('header','hi-pos-head');
    var headingTitle=make('h1','', 'New sale');
    headingTitle.appendChild(make('small','','নতুন বিক্রি'));
    var actions=make('div','hi-pos-top-actions');
    var settings=make('button','hi-pos-action','⚙ Settings');
    settings.type='button';settings.addEventListener('click',function(){if(typeof goToPage==='function')goToPage('settings');});
    var search=make('button','hi-pos-action','⌨ Search');
    search.type='button';search.addEventListener('click',function(){
      var input=cart.querySelector('[data-cart-product-input][data-cart-product-mode="add"]')||sel('#posSearch');
      if(input){input.focus();input.scrollIntoView({block:'nearest'});}
    });
    search.appendChild(make('span','hi-pos-shortcut','F2'));
    var drafts=make('button','hi-pos-action','▤ Drafts');
    drafts.type='button';drafts.addEventListener('click',function(){if(typeof goToPage==='function')goToPage('draftSales');});
    actions.append(settings,search,drafts);
    heading.append(headingTitle,actions);
    layout.before(heading);

    // Do not reparent original POS controls: the native posv2 adapter owns
    // their anchors and moves them on resize. Read/proxy the same DOM instead.
    var card=make('aside','hi-pos-customer-panel');
    var invoice=make('div','hi-pos-invoice-head');
    var info=make('div');
    var number=make('div','hi-pos-invoice-number','New invoice');
    number.id='hi-pos-invoice-number';
    info.append(number,make('div','hi-pos-invoice-date',
      'Invoice number assigned after successful checkout'));
    var clear=make('button','hi-pos-action','♜ Clear');
    clear.type='button';clear.addEventListener('click',function(){sel('#posClearCartBtn').click();});
    invoice.append(info,clear);
    var customerRow=make('div','hi-pos-customer-row');
    var picker=make('button','hi-pos-customer-picker');
    picker.id='hi-pos-customer-picker';picker.type='button';picker.setAttribute('aria-haspopup','listbox');
    var avatar=make('span','hi-pos-avatar','♙');
    var pickerText=make('span','hi-pos-customer-picker-text');
    pickerLabel=make('span','','Walk-in customer');
    pickerMeta=make('small','','Cash sale · customer optional');
    pickerText.append(pickerLabel,pickerMeta);
    picker.append(avatar,pickerText,make('span','','⌄'));
    pickerMenu=make('div','hi-pos-customer-menu');pickerMenu.id='hi-pos-customer-menu';pickerMenu.hidden=true;
    picker.addEventListener('click',function(){
      state.customerMenuOpen=!state.customerMenuOpen;pickerMenu.hidden=!state.customerMenuOpen;
      if(state.customerMenuOpen){renderCustomerMenu('');pickerMenu.querySelector('input').focus();}
    });
    var plus=make('button','hi-pos-plus','+');plus.id='hi-pos-quick-add';
    plus.type='button';plus.setAttribute('aria-label','Quick add customer');
    plus.addEventListener('click',function(){
      if(typeof custOpenAdd_!=='function'){
        if(typeof showToast==='function')showToast('Customer create is not connected for this Shop','error');
        return;
      }
      custOpenAdd_(function(id){
        var source=Array.isArray(posState.customers)?posState.customers:[];
        var found=source.find(function(c){return String(c.id)===String(id);});
        if(found)return selectCustomer(found);
        if(typeof serverCall==='function')
          serverCall('getPosBootstrap',authToken).then(function(data){
            if(Array.isArray(data.customers))posState.customers=data.customers;
            var saved=(posState.customers||[]).find(function(c){return String(c.id)===String(id);});
            if(saved)selectCustomer(saved);
            else if(typeof showToast==='function')showToast('Customer saved. Refresh POS to select it.','info');
          }).catch(function(){if(typeof showToast==='function')showToast('Customer list unavailable.','error');});
      });
    });
    customerRow.append(picker,plus);
    var mode=make('div','hi-pos-sale-mode');
    var regular=make('button','','Regular sale');regular.type='button';regular.setAttribute('aria-pressed','true');
    var installment=make('button','','Installment sale');installment.type='button';
    installment.disabled=true;installment.title='Installment sale posting not connected to this Shop D1';
    mode.append(regular,installment);
    var details=make('div','hi-pos-details');
    var toggle=make('button','hi-pos-details-toggle');
    toggle.id='hi-pos-details-toggle';toggle.type='button';toggle.setAttribute('aria-expanded','false');
    var label=make('span','','Invoice customer details');
    label.appendChild(make('small','','Name · Phone · Guardian · Address'));
    var chevron=make('span','','⌄');toggle.append(label,chevron);
    var detailBody=make('div','hi-pos-details-body');
    detailBody.id='hi-pos-details-body';detailBody.dataset.open='false';
    var mappedFields=[
      ['Customer Name','posCustomerName','text'],
      ['Phone Number','posCustomerPhone','tel'],
      ['Guardian Name','posCustomerFatherName','text'],
      ['Address','posCustomerAddress','text'],
    ];
    mappedFields.forEach(function(fields){
      var row=make('label','hi-pos-detail-input');
      row.appendChild(make('span','',fields[0]));
      var input=make('input');input.type=fields[2];
      input.dataset.hiNativeField=fields[1];input.setAttribute('aria-label',fields[0]);
      input.addEventListener('input',function(){
        var target=document.getElementById(fields[1]);
        if(target){target.value=input.value;nativeChange(target);}
      });
      row.appendChild(input);detailBody.appendChild(row);
    });
    details.append(toggle,detailBody);
    toggle.addEventListener('click',function(){
      state.detailsOpen=!state.detailsOpen;detailBody.dataset.open=state.detailsOpen?'true':'false';
      toggle.setAttribute('aria-expanded',state.detailsOpen?'true':'false');
      chevron.textContent=state.detailsOpen?'⌃':'⌄';
      if(state.detailsOpen)detailBody.querySelectorAll('[data-hi-native-field]').forEach(function(input){
        var from=document.getElementById(input.dataset.hiNativeField);if(from)input.value=from.value;
      });
    });
    card.append(invoice,customerRow,pickerMenu,mode,details,make('div','hi-pos-card-divider'));

    // Custom subtotal/discount/total are projections of real native POS state.
    // The original summary remains exactly where the native controller placed it.
    var summary=make('div','hi-pos-preview-summary');
    var subtotal=make('div','hi-pos-value-row');
    subtotal.append(make('span','','Subtotal · 3 items'),make('strong','','৳0'));
    subtotal.querySelector('span').id='hi-pos-subtotal-label';
    subtotal.querySelector('strong').id='hi-pos-subtotal';
    var discountRow=make('div','hi-pos-discount-row');
    discountRow.appendChild(make('label','','Discount'));
    var discountControls=make('div','hi-pos-discount-toggle');
    var taka=make('button','','৳');taka.type='button';taka.dataset.hiDiscountMode='amount';taka.setAttribute('aria-pressed','true');
    var pct=make('button','','%');pct.type='button';pct.dataset.hiDiscountMode='percent';pct.setAttribute('aria-pressed','false');
    taka.addEventListener('click',function(){setMode('amount');});
    pct.addEventListener('click',function(){setMode('percent');});
    nativeDiscount=sel('#posDiscount');
    discountInput=make('input');discountInput.id='hi-pos-discount-input';
    discountInput.type='number';discountInput.step='0.01';discountInput.min='0';discountInput.placeholder='0';
    discountInput.setAttribute('aria-label','Discount amount or percent');
    discountInput.addEventListener('input',computeDiscount);
    discountControls.append(taka,pct,discountInput);discountRow.append(discountControls);
    var totalRow=make('div','hi-pos-payable');
    var payableLabel=make('span','','Total payable · মোট');
    var payableValue=make('strong','','৳0');payableValue.id='hi-pos-grand';
    totalRow.append(payableLabel,payableValue);
    summary.append(subtotal,discountRow,totalRow);
    card.appendChild(summary);

    var payments=make('section','hi-pos-payments');
    var payHeading=make('div','hi-pos-payments-heading');
    var payTitle=make('div','','Payments · পেমেন্ট');
    addPay=make('button','','+ Add');addPay.id='hi-pos-add-payment';addPay.type='button';
    addPay.addEventListener('click',function(){
      var native=sel('#posAddPaymentRowBtn');if(canSplit()&&native){native.click();renderPaymentRows();}
    });
    payHeading.append(payTitle,addPay);
    primary=make('div','hi-pos-primary-payment');
    var method=make('select');method.id='hi-pos-payment-method';method.setAttribute('aria-label','Payment method');
    ['Cash','Bank','Mobile Banking'].forEach(function(v){
      var opt=make('option','',v);opt.value=v;method.appendChild(opt);
    });
    method.addEventListener('change',function(){
      var original=sel('#posPaymentMethod');if(original){original.value=method.value;nativeChange(original);}
    });
    var accountLabel=make('div','hi-pos-payment-account','Cash counter');
    accountLabel.id='hi-pos-payment-account';
    var input=make('input');input.id='hi-pos-payment-amount';input.type='number';input.min='0';input.step='0.01';
    input.setAttribute('aria-label','Amount received');
    amount=sel('#posAmountReceived');
    input.addEventListener('input',function(){
      if(amount){amount.value=input.value;nativeChange(amount);}refreshTotals();
    });
    var fill=make('button','hi-pos-remaining','Remaining');
    fill.id='hi-pos-fill-remaining';fill.type='button';
    fill.addEventListener('click',function(){
      var value=Number(sel('#posGrandTotal').textContent.replace(/[^0-9.-]/g,''))||0;
      fillPayment(value);
    });
    primary.append(method,accountLabel,input,fill);
    split=make('div','hi-pos-proxy-split');
    split.id='hi-pos-proxy-split';
    payments.append(payHeading,primary,split);
    var presets=make('div','hi-pos-payment-presets');presets.id='hi-pos-payment-presets';
    [['Exact',0],['৳2,000',2000],['৳5,000',5000]].forEach(function(item){
      var button=make('button','',item[0]);button.type='button';
      button.addEventListener('click',function(){
        var total=Number(sel('#posGrandTotal').textContent.replace(/[^0-9.-]/g,''))||0;
        fillPayment(item[1]===0?total:item[1]);
      });
      presets.appendChild(button);
    });
    payments.appendChild(presets);
    feedback=make('div','hi-pos-payment-feedback');
    var labels=make('span');labels.append(make('span','','Paid'),make('span','','Change to return'),make('span','','Remaining'));
    var values=make('strong');values.append(make('span','','৳0'),make('span','','৳0'),make('span','','৳0'));
    feedback.append(labels,values);
    payments.appendChild(feedback);
    card.appendChild(payments);
    var error=make('div','hi-pos-payment-error');
    error.id='hi-pos-proxy-error';
    error.setAttribute('role','alert');
    card.appendChild(error);
    var actions=make('div','hi-pos-proxy-actions');
    var draft=make('button','hi-pos-action','Save Draft');
    draft.type='button';
    draft.addEventListener('click',function(){sel('#posSaveDraftBtn').click();});
    var finish=make('button','hi-pos-action hi-pos-action-primary','Complete Sale');
    finish.id='hi-pos-proxy-complete';finish.type='button';
    finish.addEventListener('click',function(){
      sel('#posCompleteBtn').click();
      var nativeError=sel('#posFormError');
      error.textContent=nativeError&&nativeError.style.display!=='none'?nativeError.textContent:'';
    });
    actions.append(draft,finish);card.appendChild(actions);
    var note=make('div','hi-pos-unsupported-note');
    note.id='hi-pos-capability-note';
    note.textContent='Mixed units, split payments, Customer Quick Add, installment and Store Credit require verified Shop D1 posting. Unsupported actions remain gated.';
    card.appendChild(note);
    layout.appendChild(card);

    // The original Customer modal lives under the hidden Customer page.
    // Promote that SAME modal node (and its original listeners/IDs) to body
    // so POS Quick Add is visible without navigating away or losing the cart.
    var existingCustomerModal=document.getElementById('custModal');
    if(existingCustomerModal&&existingCustomerModal.closest('.page')!==page)
      document.body.appendChild(existingCustomerModal);

    renderQuickProducts();updateCustomer();decorateCart();refreshTotals();
    var observer=new MutationObserver(function(){decorateCart();refreshTotals();});
    observer.observe(cart,{childList:true});
    var total=sel('#posGrandTotal');
    if(total)new MutationObserver(refreshTotals).observe(total,{childList:true,characterData:true,subtree:true});
    var productGrid=sel('#posProductGrid');
    if(productGrid)new MutationObserver(renderQuickProducts).observe(productGrid,{childList:true});
    sel('#posCustomerName').addEventListener('change',updateCustomer);
    sel('#posCustomerPhone').addEventListener('change',updateCustomer);
    if(amount)amount.addEventListener('input',refreshTotals);
    document.addEventListener('click',function(event){
      if(state.customerMenuOpen&&!picker.contains(event.target)&&!pickerMenu.contains(event.target)){
        state.customerMenuOpen=false;pickerMenu.hidden=true;
      }
    });
    window.addEventListener('keydown',function(event){
      if(event.key==='F2'&&!event.defaultPrevented&&!page.hidden){event.preventDefault();search.click();}
    });
  }
  function renderPaymentRows(){
    if(!split)return;
    split.replaceChildren();
    if(!canSplit())return;
    (posState.paymentRows||[]).forEach(function(row,index){
      var host=make('div','hi-pos-primary-payment');
      var method=make('select');
      ['Cash','Bank','Mobile Banking'].forEach(function(m){
        var opt=make('option','',m);opt.value=m;opt.selected=row.method===m;method.appendChild(opt);
      });
      method.setAttribute('aria-label','Payment '+(index+1)+' method');
      method.addEventListener('change',function(){
        var native=sel('#posMultiPaymentRows [data-payment-row="'+row.id+'"] [data-payment-field="method"]');
        if(native){native.value=method.value;nativeChange(native);}
      });
      var account=make('div','hi-pos-payment-account',row.accountId||'Account');
      var amountInput=make('input');
      amountInput.type='number';amountInput.min='0';amountInput.step='0.01';amountInput.value=row.amount||'';
      amountInput.setAttribute('aria-label','Payment '+(index+1)+' amount');
      amountInput.addEventListener('input',function(){
        var native=sel('#posMultiPaymentRows [data-payment-row="'+row.id+'"] [data-payment-field="amount"]');
        if(native){native.value=amountInput.value;nativeChange(native);}refreshTotals();
      });
      var due=make('button','hi-pos-remaining','Remaining');
      due.type='button';due.addEventListener('click',function(){
        var native=sel('#posMultiPaymentRows [data-payment-row="'+row.id+'"] [data-payment-action="remaining"]');
        if(native){native.click();amountInput.value=posState.paymentRows[index]?.amount||'';refreshTotals();}
      });
      host.append(method,account,amountInput,due);
      split.appendChild(host);
    });
  }
  mount();
})();
