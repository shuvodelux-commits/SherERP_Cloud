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
    if(pickerMeta)pickerMeta.textContent=guest?'Cash sale · customer optional':
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
    }else if(amount){amount.value=String(value);nativeChange(amount);}
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
    var rows=Array.from(cart.querySelectorAll(':scope > .cart-row:not(.pos-cart-entry-row)'));
    rows.forEach(function(row,index){
      if(row.querySelector('.hi-pos-grip'))return;
      var button=make('button','hi-pos-grip','⋮⋮');
      button.type='button';button.draggable=true;
      button.dataset.hiPosRow=String(index);
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
    var layout=sel('.pos-layout'),product=sel('.pos-product-card'),
      checkout=sel('.pos-cart-section'),customer=sel('.pos-customer-section');
    if(!layout||!product||!checkout||!customer||!cart)return;
    page.dataset.hiPosMounted='true';
    var head=make('header','hi-pos-head');
    var title=make('h1','', 'New sale');
    title.appendChild(make('small','','নতুন বিক্রি'));
    var actions=make('div','hi-pos-top-actions');
    var settings=make('button','hi-pos-action','⚙ Settings');
    settings.type='button';settings.addEventListener('click',function(){
      if(typeof goToPage==='function')goToPage('settings');
    });
    var search=make('button','hi-pos-action','⌨ Search');
    search.type='button';search.addEventListener('click',function(){
      var input=cart.querySelector('[data-cart-product-input][data-cart-product-mode="add"]')||sel('#posSearch');
      if(input){input.focus();input.scrollIntoView({block:'nearest'});}
    });
    search.appendChild(make('span','hi-pos-shortcut','F2'));
    var drafts=make('button','hi-pos-action','▤ Drafts');
    drafts.type='button';drafts.title='Open saved sales drafts';
    drafts.addEventListener('click',function(){if(typeof goToPage==='function')goToPage('draftSales');});
    actions.append(settings,search,drafts);head.append(title,actions);
    page.insertBefore(head,layout);

    var invoice=make('div','hi-pos-invoice-head');
    var info=make('div');
    var number=make('div','hi-pos-invoice-number','New invoice');
    number.id='hi-pos-invoice-number';
    info.appendChild(number);
    info.appendChild(make('div','hi-pos-invoice-date','Invoice number assigned after successful checkout'));
    var clear=make('button','hi-pos-action','♜ Clear');
    clear.type='button';clear.addEventListener('click',function(){sel('#posClearCartBtn').click();});
    invoice.append(info,clear);

    var customerRow=make('div','hi-pos-customer-row');
    var picker=make('button','hi-pos-customer-picker');
    picker.type='button';picker.id='hi-pos-customer-picker';
    picker.setAttribute('aria-haspopup','listbox');
    var avatar=make('span','hi-pos-avatar','♙');
    var captions=make('span','hi-pos-customer-picker-text');
    pickerLabel=make('span','', 'Walk-in customer');
    pickerMeta=make('small','','Cash sale · customer optional');
    captions.append(pickerLabel,pickerMeta);
    picker.append(avatar,captions,make('span','','⌄'));
    pickerMenu=make('div','hi-pos-customer-menu');
    pickerMenu.id='hi-pos-customer-menu';pickerMenu.hidden=true;
    picker.addEventListener('click',function(){
      state.customerMenuOpen=!state.customerMenuOpen;
      pickerMenu.hidden=!state.customerMenuOpen;
      if(state.customerMenuOpen){
        renderCustomerMenu('');pickerMenu.querySelector('input').focus();
      }
    });
    var plus=make('button','hi-pos-plus','+');
    plus.type='button';plus.id='hi-pos-quick-add';
    plus.setAttribute('aria-label','Quick add customer');
    plus.title='Add a Customer from POS';
    plus.addEventListener('click',function(){
      if(typeof custOpenAdd_!=='function'){
        if(typeof showToast==='function')showToast('Customer creation is not connected in this Shop.','error');
        return;
      }
      custOpenAdd_(function(id){
        // Customer ID must come from the real source/Owner callback, never
        // infer a Customer relationship from entered name or phone alone.
        var source=Array.isArray(posState.customers)?posState.customers:[];
        var found=source.find(function(c){return String(c.id)===String(id);});
        if(found)selectCustomer(found);
        else if(typeof serverCall==='function'){
          serverCall('getPosBootstrap',authToken).then(function(data){
            if(Array.isArray(data.customers))posState.customers=data.customers;
            var saved=posState.customers.find(function(c){return String(c.id)===String(id);});
            if(saved)selectCustomer(saved);
            else if(typeof showToast==='function')showToast('Customer saved. Refresh POS to select the new Customer.','info');
          }).catch(function(){if(typeof showToast==='function')showToast('Customer saved, but POS customer list could not refresh.','error');});
        }
      });
    });
    customerRow.append(picker,plus);
    var modes=make('div','hi-pos-sale-mode');
    var regular=make('button','', 'Regular sale');regular.type='button';regular.setAttribute('aria-pressed','true');
    var instalment=make('button','', 'Installment sale');
    instalment.type='button';instalment.disabled=true;
    instalment.title='Installment backend and ledger are not connected';
    modes.append(regular,instalment);

    var details=make('div','hi-pos-details');
    var detailToggle=make('button','hi-pos-details-toggle');
    detailToggle.type='button';detailToggle.id='hi-pos-details-toggle';
    detailToggle.setAttribute('aria-expanded','false');
    var detailText=make('span','','Invoice customer details');
    detailText.appendChild(make('small','','Name · Phone · Guardian · Address'));
    var arrow=make('span','','⌄');
    detailToggle.append(detailText,arrow);
    var detailBody=make('div','hi-pos-details-body');
    detailBody.id='hi-pos-details-body';detailBody.dataset.open='false';
    details.append(detailToggle,detailBody);
    detailToggle.addEventListener('click',function(){
      state.detailsOpen=!state.detailsOpen;
      detailBody.dataset.open=state.detailsOpen?'true':'false';
      detailToggle.setAttribute('aria-expanded',state.detailsOpen?'true':'false');
      arrow.textContent=state.detailsOpen?'⌃':'⌄';
    });
    Array.from(customer.children).forEach(function(el){
      if(el.matches('label,.pos-customer-input-wrap,#posCustomerDueRow,#posCustomerMoreFields,.pos-customer-actions'))
        detailBody.appendChild(el);
    });
    customer.prepend(invoice,customerRow,pickerMenu,modes,details,make('div','hi-pos-card-divider'));

    var summary=checkout.querySelector('.pos-checkout-summary');
    var errors=checkout.querySelector('#posFormError');
    var footer=checkout.querySelector('.pos-checkout-actions');
    if(summary)customer.appendChild(summary);
    if(errors)customer.appendChild(errors);
    if(footer)customer.appendChild(footer);
    var totals=summary&&summary.querySelector('.pos-checkout-totals');
    var fields=summary&&summary.querySelector('.pos-checkout-fields');
    nativeDiscount=sel('#posDiscount');
    if(totals&&fields&&nativeDiscount){
      var originalRow=nativeDiscount.closest('.totals-row');
      var discountRow=make('div','hi-pos-discount-row');
      discountRow.append(make('label','','Discount'));
      var controls=make('div','hi-pos-discount-toggle');
      var taka=make('button','', '৳');taka.type='button';taka.dataset.hiDiscountMode='amount';taka.setAttribute('aria-pressed','true');
      var pct=make('button','', '%');pct.type='button';pct.dataset.hiDiscountMode='percent';pct.setAttribute('aria-pressed','false');
      taka.addEventListener('click',function(){setMode('amount');});
      pct.addEventListener('click',function(){setMode('percent');});
      discountInput=make('input');discountInput.id='hi-pos-discount-input';
      discountInput.type='number';discountInput.min='0';discountInput.step='0.01';discountInput.placeholder='0';
      discountInput.setAttribute('aria-label','Discount amount or percent');
      controls.append(taka,pct,discountInput);discountRow.append(controls);
      nativeDiscount.hidden=true;nativeDiscount.setAttribute('aria-hidden','true');
      discountRow.appendChild(nativeDiscount);
      discountInput.addEventListener('input',computeDiscount);
      var subtotal=sel('#posSubtotal').closest('.totals-row');
      if(subtotal)subtotal.after(discountRow);else totals.prepend(discountRow);
      if(originalRow && originalRow.isConnected&&originalRow!==discountRow)originalRow.remove();
    }

    var pays=make('section','hi-pos-payments');
    var payHeading=make('div','hi-pos-payments-heading');
    var payTitle=make('div','', 'Payments · পেমেন্ট');
    var add=make('button','', '+ Add');
    add.type='button';add.id='hi-pos-add-payment';
    payHeading.append(payTitle,add);
    primary=make('div','hi-pos-primary-payment');
    var method=sel('#posPaymentMethod'),account=sel('#posBankAccountRow');
    amount=sel('#posAmountReceived');
    if(method)primary.appendChild(method);
    if(account)primary.appendChild(account);
    if(amount)primary.appendChild(amount);
    var remaining=make('button','hi-pos-remaining','Remaining');
    remaining.type='button';remaining.id='hi-pos-fill-remaining';
    remaining.addEventListener('click',function(){
      var total=Number(sel('#posGrandTotal').textContent.replace(/[^0-9.-]/g,''))||0;
      fillPayment(total);
    });
    primary.appendChild(remaining);
    split=sel('#posMultiPaymentFields');
    addPay=add;
    add.addEventListener('click',function(){
      var original=sel('#posAddPaymentRowBtn');
      if(canSplit()&&original)original.click();
    });
    pays.append(payHeading,primary);
    if(split)pays.appendChild(split);
    var presets=make('div','hi-pos-payment-presets');
    [
      ['Exact',0],['৳2,000',2000],['৳5,000',5000]
    ].forEach(function(item){
      var btn=make('button','',item[0]);btn.type='button';
      btn.addEventListener('click',function(){
        var total=Number(sel('#posGrandTotal').textContent.replace(/[^0-9.-]/g,''))||0;
        fillPayment(item[1]===0?total:item[1]);
      });
      presets.appendChild(btn);
    });
    pays.appendChild(presets);
    feedback=make('div','hi-pos-payment-feedback');
    var left=make('span');left.append(make('span','','Paid'),make('span','','Change to return'),make('span','','Remaining'));
    var right=make('strong');right.append(make('span','','৳0'),make('span','','৳0'),make('span','','৳0'));
    feedback.append(left,right);pays.appendChild(feedback);
    if(summary)summary.after(pays);else customer.appendChild(pays);
    if(footer)customer.appendChild(footer);
    if(errors)customer.insertBefore(errors,footer||null);

    var originalAdd=sel('#posAddPaymentRowBtn');
    if(originalAdd)originalAdd.hidden=true;
    renderQuickProducts();
    sel('#posClearCartBtn').hidden=true;
    updateCustomer();refreshTotals();decorateCart();

    // Native POS cart/list data are the source of truth, not copied arrays.
    var observer=new MutationObserver(function(){decorateCart();refreshTotals();});
    observer.observe(cart,{childList:true});
    var total=sel('#posGrandTotal');
    if(total)new MutationObserver(refreshTotals).observe(total,{childList:true,characterData:true,subtree:true});
    var products=sel('#posProductGrid');
    if(products)new MutationObserver(renderQuickProducts).observe(products,{childList:true});
    if(amount)amount.addEventListener('input',refreshTotals);
    if(split)split.addEventListener('input',refreshTotals);
    sel('#posCustomerName').addEventListener('change',updateCustomer);
    sel('#posCustomerPhone').addEventListener('change',updateCustomer);
    document.addEventListener('click',function(event){
      if(state.customerMenuOpen && !picker.contains(event.target)&&!pickerMenu.contains(event.target)){
        state.customerMenuOpen=false;pickerMenu.hidden=true;
      }
    });
    window.addEventListener('keydown',function(event){
      if(event.key==='F2'&&!event.defaultPrevented&&page.hidden===false){
        event.preventDefault();search.click();
      }
    });
    // Truthfully indicate that financial features outside the current
    // source/Shop backend remain subject to the private Owner feature gates.
    var note=make('div','hi-pos-unsupported-note');
    note.id='hi-pos-capability-note';
    note.textContent='Customer Quick Add, mixed-unit checkout, installment and split payments require the connected Shop backend. Unsupported financial actions are never submitted as Cash.';
    customer.appendChild(note);
  }
  mount();
})();
