/* HisabIQ POS V2 Owner presentation controller. No network calls or posting. */
(() => {
  'use strict';
  const page=document.getElementById('page-pos');
  const layout=page?.querySelector('.pos-layout');
  const cart=page?.querySelector('.pos-cart-section');
  const customer=page?.querySelector('.pos-customer-section');
  const quick=page?.querySelector('.pos-product-card');
  if(!page||!layout||!cart||!customer||!quick||page.querySelector('#posHisabiqHeader'))return;

  // Explicit left column prevents the tall checkout from creating a blank
  // grid row between the cart and the quick-item list on desktop.
  const left=document.createElement('div');
  left.className='hisabiq-pos-left';
  layout.insertBefore(left,layout.firstChild);
  left.append(cart,quick);

  const heading=document.createElement('div');
  heading.id='posHisabiqHeader';
  heading.className='hisabiq-pos-heading';
  const headingCopy=document.createElement('h2');
  headingCopy.textContent='New sale';
  const bangla=document.createElement('span');
  bangla.className='hisabiq-pos-bn';
  bangla.textContent='নতুন বিক্রি';
  headingCopy.appendChild(bangla);
  heading.appendChild(headingCopy);
  const tools=document.createElement('div');
  tools.className='hisabiq-pos-heading-tools';
  const searchButton=document.createElement('button');
  searchButton.type='button';
  searchButton.className='btn hisabiq-pos-search-trigger';
  searchButton.textContent='F2 Search';
  searchButton.setAttribute('aria-label','Focus product search');
  searchButton.addEventListener('click',()=>{
    const target=page.querySelector('#posCartList [data-cart-product-mode="add"]')||
      document.getElementById('posSearch');
    target?.focus();
  });
  tools.appendChild(searchButton);
  const buttonSlot=document.createElement('div');
  buttonSlot.className='hisabiq-pos-action-slot';
  tools.appendChild(buttonSlot);
  heading.appendChild(tools);
  layout.insertBefore(heading,layout.firstChild);

  const quickHead=quick.querySelector('.pos-section-head');
  if(quickHead){
    const title=quickHead.querySelector('h3');
    if(title)title.textContent='Quick items · দ্রুত যোগ';
  }

  const receiptHead=document.createElement('div');
  receiptHead.id='posHisabiqInvoiceHead';
  receiptHead.className='hisabiq-pos-invoice-head';
  const receiptTitle=document.createElement('div');
  receiptTitle.className='hisabiq-pos-invoice-title';
  const receiptStrong=document.createElement('strong');
  receiptStrong.textContent='New invoice';
  const receiptInfo=document.createElement('small');
  receiptInfo.textContent='POS · নতুন বিক্রি';
  receiptTitle.append(receiptStrong,receiptInfo);
  receiptHead.appendChild(receiptTitle);
  const clear=page.querySelector('#posClearCartBtn');
  if(clear)receiptHead.appendChild(clear);
  customer.insertBefore(receiptHead,customer.firstChild);

  // The source V2 controller recreates the Draft/Add buttons each time POS
  // activates. Move those actual controls rather than cloning their handlers.
  const searchRow=quick.querySelector('.pos-search-drafts-row');
  const moveActions=()=>{
    if(!document.body.classList.contains('pos-v2-active'))return;
    const actions=searchRow?.querySelector('.pos-v2-search-actions');
    if(actions&&actions.parentElement!==buttonSlot)buttonSlot.appendChild(actions);
  };
  if(searchRow){
    new MutationObserver(moveActions).observe(searchRow,{childList:true});
  }

  // Component parity is presentation-only: use the original inputs and
  // checkout handlers; no new posting, account or stock authority.
  const make=(tag,cls,text)=>{
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(text!==undefined)node.textContent=text;
    return node;
  };

  const modes=make('div','hisabiq-pos-sale-modes');
  modes.id='posHisabiqSaleModes';
  modes.setAttribute('aria-label','Sale type');
  modes.appendChild(make('span','is-current','Regular sale'));
  const installment=make('button','','Installment sale');
  installment.type='button';
  installment.disabled=true;
  installment.dataset.saleMode='installment';
  installment.title='Installment sales are not connected to the current Shop D1 posting API';
  modes.appendChild(installment);
  receiptHead.insertAdjacentElement('afterend',modes);

  const picker=make('button','hisabiq-pos-customer-picker');
  picker.id='posHisabiqCustomerPicker';
  picker.type='button';
  picker.setAttribute('aria-controls','posHisabiqCustomerDetails');
  picker.setAttribute('aria-expanded','false');
  const pickerLabel=make('span','hisabiq-pos-customer-picker-label');
  pickerLabel.append(make('strong','','Walk-in customer'),
    make('small','','Name and phone required for checkout'));
  picker.append(pickerLabel,make('span','hisabiq-pos-chevron','⌄'));
  modes.insertAdjacentElement('afterend',picker);

  const details=make('details','hisabiq-pos-customer-details');
  details.id='posHisabiqCustomerDetails';
  const detailsTitle=make('summary','');
  detailsTitle.append(make('strong','','Invoice customer details · ক্রেতার তথ্য'),
    make('small','','Guardian · Address · Customer history'));
  const detailsBody=make('div','hisabiq-pos-customer-details-body');
  details.append(detailsTitle,detailsBody);
  picker.insertAdjacentElement('afterend',details);
  const oldFirst=customer.querySelector('.pos-section-head');
  const oldLast=customer.querySelector('.pos-customer-actions');
  if(oldFirst&&oldLast){
    let item=oldFirst;
    while(item){
      const next=item.nextSibling;
      detailsBody.appendChild(item);
      if(item===oldLast)break;
      item=next;
    }
  }
  const nameInput=document.getElementById('posCustomerName');
  const phoneInput=document.getElementById('posCustomerPhone');
  // The active Owner Cash checkout and the original real-D1 browser flow
  // require both fields to remain directly usable. Only supplemental
  // guardian/address/history fields belong inside the optional disclosure.
  // Move the ORIGINAL inputs, labels and datalists, never duplicate them.
  const primary=make('div','hisabiq-pos-customer-primary');
  primary.id='posHisabiqCustomerPrimary';
  details.insertAdjacentElement('beforebegin',primary);
  [nameInput,phoneInput].forEach(input=>{
    const wrap=input?.closest('.pos-customer-input-wrap');
    if(!wrap)return;
    const label=wrap.previousElementSibling;
    const dataList=wrap.nextElementSibling;
    const field=make('div','hisabiq-pos-customer-primary-field');
    if(label?.tagName==='LABEL')field.appendChild(label);
    field.appendChild(wrap);
    if(dataList?.tagName==='DATALIST')field.appendChild(dataList);
    primary.appendChild(field);
  });
  const syncPicker=()=>{
    const name=nameInput?.value.trim()||'';
    pickerLabel.querySelector('strong').textContent=name||'Walk-in customer';
    pickerLabel.querySelector('small').textContent=name
      ? ((phoneInput?.value.trim()||'Add phone number')+' · Invoice details')
      :'Name and phone required for checkout';
  };
  picker.addEventListener('click',()=>{
    details.open=true;
    nameInput?.focus();
  });
  details.addEventListener('toggle',()=>{
    picker.setAttribute('aria-expanded',String(details.open));
  });
  nameInput?.addEventListener('input',syncPicker);
  phoneInput?.addEventListener('input',syncPicker);
  nameInput?.addEventListener('change',syncPicker);
  phoneInput?.addEventListener('change',syncPicker);
  syncPicker();
  document.getElementById('posCompleteBtn')?.addEventListener('click',()=>{
    // Do not skip the original required-customer validation or API guard.
    if(!nameInput?.value.trim()||!phoneInput?.value.trim())details.open=true;
  },true);

  const summary=page.querySelector('.pos-checkout-summary');
  const sourceDiscount=page.querySelector('#posDiscount');
  const sourceReceived=page.querySelector('#posAmountReceived');
  const sourceMethod=page.querySelector('#posPaymentMethod');
  const sourceTotal=page.querySelector('#posGrandTotal');
  const sourceSubtotal=page.querySelector('#posSubtotal');
  const checkoutFields=summary?.querySelector('.pos-checkout-fields');
  const subtotalLine=sourceSubtotal?.closest('.totals-row');
  if(checkoutFields&&subtotalLine)checkoutFields.prepend(subtotalLine);
  // The authenticated Shop pilot currently supports only fully paid Cash.
  // Keep the source select and its listeners; do not offer unimplemented
  // Bank/Mobile writers merely because they exist in legacy HTML.
  if(sourceMethod){
    Array.from(sourceMethod.options).forEach(opt=>{
      if(opt.value!=='Cash')opt.disabled=true;
    });
  }
  const paymentTitle=make('div','hisabiq-pos-payment-heading');
  paymentTitle.id='posHisabiqPaymentHeading';
  paymentTitle.append(make('strong','','Payments · পেমেন্ট'),
    make('small','','Cash checkout · one source in current Shop pilot'));
  const receivedRow=page.querySelector('#posAmountReceivedRow');
  if(checkoutFields&&receivedRow){
    checkoutFields.insertBefore(paymentTitle,receivedRow);
  }
  const actions=page.querySelector('.pos-checkout-actions');
  const cashTools=make('div','hisabiq-pos-cash-tools');
  cashTools.id='posHisabiqPaymentTools';
  [['exact','Exact'],['2000','৳2,000'],['5000','৳5,000']].forEach(([value,label])=>{
    const button=make('button','hisabiq-pos-cash-shortcut',label);
    button.type='button';
    button.dataset.posCashShortcut=value;
    button.addEventListener('click',()=>{
      if(!sourceReceived||!sourceTotal)return;
      const due=readMoney(sourceTotal.textContent);
      sourceReceived.value=value==='exact'?String(due):value;
      sourceReceived.dispatchEvent(new Event('input',{bubbles:true}));
      sourceReceived.dispatchEvent(new Event('change',{bubbles:true}));
      sourceReceived.focus();
    });
    cashTools.appendChild(button);
  });
  if(checkoutFields)checkoutFields.appendChild(cashTools);

  const paymentStatus=make('div','hisabiq-pos-payment-status');
  paymentStatus.id='posHisabiqPaymentStatus';
  const statusPaid=make('div','');
  const statusChange=make('div','');
  const statusDue=make('div','is-due');
  const paidValue=make('b','','৳0');
  const changeValue=make('b','','৳0');
  const dueValue=make('b','','৳0');
  statusPaid.append(make('span','','Paid · জমা'),paidValue);
  statusChange.append(make('span','','Change to return'),changeValue);
  statusDue.append(make('span','','Due · বাকি'),dueValue);
  paymentStatus.append(statusPaid,statusChange,statusDue);
  if(summary)summary.appendChild(paymentStatus);

  const numberWords=make('div','hisabiq-pos-amount-in-words');
  numberWords.id='posHisabiqAmountWords';
  numberWords.append(make('strong','','In words'),
    make('p','','Zero taka only'),
    make('small','','মোট টাকার পরিমাণ কথায়'));
  const grandLine=sourceTotal?.closest('.totals-row');
  if(grandLine)grandLine.insertAdjacentElement('afterend',numberWords);
  const warning=make('p','hisabiq-pos-pilot-notice');
  warning.id='posHisabiqPilotNotice';
  warning.setAttribute('role','status');
  warning.hidden=true;
  if(summary)summary.appendChild(warning);

  const readMoney=text=>Number(String(text||'').replace(/[^0-9.-]/g,''))||0;
  const amountText=n=>'৳'+Number(n||0).toLocaleString('en-BD',{
    minimumFractionDigits:0,maximumFractionDigits:2});
  const numbers=['zero','one','two','three','four','five','six','seven','eight',
    'nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen',
    'seventeen','eighteen','nineteen'];
  const decades=['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  function belowThousand(n){
    let out='';
    if(n>=100){out+=numbers[Math.floor(n/100)]+' hundred';n%=100;}
    if(n>=20){out+=(out?' ':'')+decades[Math.floor(n/10)];n%=10;
      if(n)out+=' '+numbers[n];}
    else if(n){out+=(out?' ':'')+numbers[n];}
    return out||'zero';
  }
  function amountWords(amount){
    if(!Number.isFinite(amount)||amount<0||amount>99999999999)return 'Amount too large to spell';
    let whole=Math.floor(amount+1e-8);
    const fractional=Math.round((amount-whole)*100);
    const groups=[[10000000,'crore'],[100000,'lakh'],[1000,'thousand']];
    const parts=[];
    for(const [unit,label] of groups){
      if(whole>=unit){
        const count=Math.floor(whole/unit);
        parts.push(belowThousand(count)+' '+label);
        whole%=unit;
      }
    }
    if(whole>0)parts.push(belowThousand(whole));
    let words=(parts.join(' ')||'zero')+' taka';
    if(fractional>0)words+=' and '+belowThousand(fractional)+' poisha';
    return words.charAt(0).toUpperCase()+words.slice(1)+' only';
  }
  const updateSummary=()=>{
    if(!sourceTotal)return;
    const total=readMoney(sourceTotal.textContent);
    const received=Math.max(0,Number(sourceReceived?.value)||0);
    const paid=Math.min(total,received);
    const change=Math.max(0,received-total);
    const due=Math.max(0,total-received);
    const words=numberWords.querySelector('p');
    if(words)words.textContent=amountWords(total);
    paidValue.textContent=amountText(paid);
    changeValue.textContent=amountText(change);
    dueValue.textContent=amountText(due);
    paymentStatus.dataset.due=String(Number(due.toFixed(2)));
    const previewCta=document.getElementById('posHisabiqPreviewButton');
    if(previewCta)previewCta.textContent='Preview sale '+(sourceTotal?.textContent||'৳0')+' · F9';
    const actualLines=Array.from(page.querySelectorAll(
      '#posCartList .cart-row:not(.pos-cart-entry-row)')).length;
    const unsupported=actualLines>1 || Number(sourceDiscount?.value)>0 ||
      (total>0&&due>0) || sourceMethod?.value!=='Cash';
    warning.hidden=!unsupported;
    if(unsupported){
      warning.textContent='Shop D1 currently saves only one in-stock Standard product '+
        'with full Cash payment and no discount. Preview is available; '+
        'unsupported sales cannot be posted.';
    }
    const chips=cashTools.querySelectorAll('button');
    chips.forEach(button=>{button.disabled=!total;});
  };
  sourceReceived?.addEventListener('input',updateSummary);
  sourceReceived?.addEventListener('change',updateSummary);
  sourceDiscount?.addEventListener('input',updateSummary);
  sourceMethod?.addEventListener('change',updateSummary);
  if(sourceTotal)new MutationObserver(updateSummary).observe(sourceTotal,{
    subtree:true,characterData:true,childList:true});
  const cartList=page.querySelector('#posCartList');
  const emptyCart=make('p','hisabiq-pos-empty-cart','Cart is empty · কার্টে কোনো পণ্য নেই');
  emptyCart.id='posHisabiqEmptyCart';
  if(cartList)cartList.insertAdjacentElement('afterend',emptyCart);
  const updateCartPresentation=()=>{
    emptyCart.hidden=!!cartList?.querySelector('.cart-row:not(.pos-cart-entry-row),.pos-cart-entry-row.is-active');
    syncPicker(); // Draft restoration and sale reset can change original fields programmatically.
    updateSummary();
  };
  if(cartList)new MutationObserver(updateCartPresentation).observe(cartList,{
    childList:true,subtree:true});
  updateCartPresentation();

  // This is an early UX rejection of known unsupported checkout shapes.
  // It does not authorize supported shapes: the original authenticated Worker
  // still validates tenant, Cash Session, FIFO quote and D1 atomic posting.
  const complete=page.querySelector('#posCompleteBtn');
  const formError=page.querySelector('#posFormError');
  complete?.addEventListener('click',event=>{
    const rows=cartList?.querySelectorAll('.cart-row:not(.pos-cart-entry-row)')||[];
    const total=readMoney(sourceTotal?.textContent);
    const received=Number(sourceReceived?.value)||0;
    const discount=Number(sourceDiscount?.value)||0;
    let reason='';
    if(rows.length>1)reason='Current Shop D1 checkout supports only one product per sale. Remove extra cart lines or keep this sale as an unsaved preview.';
    else if(discount>0)reason='Discounted sales are not connected to Shop D1 yet. Set discount to zero before checkout.';
    else if(sourceMethod?.value!=='Cash')reason='Only Cash payment is connected to Shop D1. Select Cash before checkout.';
    else if(total>0&&received<total-0.004)reason='Customer Due and partial payment are not connected to Shop D1. Receive the full amount in Cash.';
    if(!reason)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if(formError){
      formError.textContent=reason;
      formError.style.display='block';
      formError.setAttribute('role','alert');
      formError.setAttribute('tabindex','-1');
      formError.focus({preventScroll:true});
      formError.scrollIntoView({block:'nearest',behavior:'instant'});
    }
  },true);

  const previewButton=make('button','btn hisabiq-pos-preview-button','Preview sale · F9');
  previewButton.id='posHisabiqPreviewButton';
  previewButton.type='button';
  if(actions)actions.appendChild(previewButton);
  const dialog=make('div','hisabiq-pos-preview-backdrop');
  dialog.id='posHisabiqPreview';
  dialog.hidden=true;
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-label','Unsaved sale preview');
  const panel=make('div','hisabiq-pos-preview-panel');
  const top=make('div','hisabiq-pos-preview-top');
  top.append(make('h3','','Preview sale · বিক্রির পূর্বরূপ'),
    make('span','','Not saved'));
  const close=make('button','btn','Close');
  close.type='button';
  close.setAttribute('aria-label','Close sale preview');
  top.append(close);
  const previewItems=make('div','hisabiq-pos-preview-items');
  const previewBreakdown=make('dl','hisabiq-pos-preview-breakdown');
  const previewTotal=make('div','hisabiq-pos-preview-total');
  panel.append(top,previewItems,previewBreakdown,previewTotal);
  dialog.appendChild(panel);
  page.appendChild(dialog);
  let previewReturnFocus=null;
  function closePreview(){
    dialog.hidden=true;
    if(previewReturnFocus&&previewReturnFocus.isConnected)previewReturnFocus.focus();
  }
  close.addEventListener('click',closePreview);
  dialog.addEventListener('click',event=>{
    if(event.target===dialog)closePreview();
  });
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closePreview();return;}
    if(event.key!=='Tab')return;
    // Only Close is currently focusable. Keep focus inside dialog.
    event.preventDefault();close.focus();
  });
  function renderPreview(){
    previewReturnFocus=document.activeElement;
    previewItems.replaceChildren();
    const rows=Array.from(page.querySelectorAll(
      '#posCartList .cart-row:not(.pos-cart-entry-row)'));
    if(!rows.length){
      previewItems.appendChild(make('p','','Add a product before previewing the sale.'));
    }
    rows.forEach((row,index)=>{
      const name=row.querySelector('.c-name-title')?.textContent.trim()||'Product';
      const qty=row.querySelector('input[data-f="qty"]')?.value||'0';
      const unit=row.querySelector('.c-unit')?.textContent.trim()||'';
      const price=row.querySelector('input[data-f="price"]')?.value||'0';
      const total=row.querySelector('.c-line-total')?.textContent||'৳0';
      const line=make('div','hisabiq-pos-preview-item');
      line.append(make('strong','',String(index+1)+'. '+name),
        make('span','',qty+' '+unit+' × '+amountText(Number(price)||0)),
        make('b','',total));
      previewItems.appendChild(line);
    });
    previewBreakdown.replaceChildren();
    const detail=(label,value)=>{
      const dt=make('dt','',label);
      const dd=make('dd','',value);
      previewBreakdown.append(dt,dd);
    };
    const name=nameInput?.value.trim();
    const phone=phoneInput?.value.trim();
    detail('Customer · ক্রেতা',name||'Unspecified');
    if(phone)detail('Phone · ফোন',phone);
    detail('Subtotal · মোট',sourceSubtotal?.textContent||'৳0');
    detail('Discount · ছাড়',amountText(Math.max(0,Number(sourceDiscount?.value)||0)));
    detail('Payment · পেমেন্ট',sourceMethod?.value||'Cash');
    const total=readMoney(sourceTotal?.textContent);
    const received=Math.max(0,Number(sourceReceived?.value)||0);
    detail('Paid now · জমা',amountText(Math.min(total,received)));
    detail('Due · বাকি',amountText(Math.max(0,total-received)));
    if(received>total)detail('Change · ফেরত',amountText(received-total));
    previewTotal.textContent='Total payable · মোট   '+
      (sourceTotal?.textContent||'৳0');
    dialog.hidden=false;close.focus();
  }
  previewButton.addEventListener('click',renderPreview);
  document.addEventListener('keydown',event=>{
    if(!document.body.classList.contains('pos-v2-active') ||
      dialog.hidden===false || event.ctrlKey || event.metaKey || event.altKey)return;
    if(event.key==='F2'){
      event.preventDefault();searchButton.click();
    }else if(event.key==='F8'){
      event.preventDefault();sourceReceived?.focus();
    }else if(event.key==='F9'){
      event.preventDefault();previewButton.click();
    }
  });

  moveActions();
  document.body.classList.add('hisabiq-pos-ready');
})();
