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
  moveActions();
  document.body.classList.add('hisabiq-pos-ready');
})();
