/** Owner Product list UI parity adapter. Source: hisabiq_ui@e42a00a Products.tsx.
 * UI-only: original product source, auth, write guardrails and handlers stay unchanged.
 */
export const COLUMN_DEFINITIONS=Object.freeze([
  {id:'index',label:'#'},{id:'product',label:'Product'},
  {id:'category',label:'Category'},{id:'stock',label:'Stock'},
  {id:'stockValue',label:'Stock value'},{id:'unit',label:'Unit'},
  {id:'purchase',label:'Purchase'},{id:'selling',label:'Selling'},
  {id:'status',label:'Status'}
]);
export const LOCKED_COLUMNS=Object.freeze(['product','stock','selling']);
const STORAGE_KEY='hisabiq-products-visible-columns';

export function readColumnVisibility(raw){
  let persisted={};
  try{const data=JSON.parse(raw||'{}');if(data&&typeof data==='object'&&!Array.isArray(data))persisted=data;}catch{}
  const result={};
  for(const col of COLUMN_DEFINITIONS){
    result[col.id]=LOCKED_COLUMNS.includes(col.id)||persisted[col.id]!==false;
  }
  return result;
}

export function productStockGroup(product){
  if(product.Status&&product.Status!=='Active')return 'inactive';
  const isBundle=product['Product Type']==='Bundle';
  const raw=isBundle?product['Available Sets']:product['Current Stock'];
  if(raw==null||raw==='')return 'unknown';
  const qty=Number(raw);
  if(!Number.isFinite(qty))return 'unknown';
  if(qty<=0)return 'out';
  const min=product['Minimum Stock'];
  return !isBundle&&min!=null&&min!==''&&Number.isFinite(Number(min))&&qty<=Number(min)?'low':'in';
}
export function filterProductsByStock(products,stockFilter){
  return stockFilter==='all'?products:products.filter(p=>productStockGroup(p)===stockFilter);
}

function mountProductsTable(){
  const page=document.getElementById('page-products');
  const table=document.getElementById('prodTable');
  const originalToolbar=page?.querySelector(':scope > .toolbar');
  const card=page?.querySelector(':scope > .card');
  if(!page||!table||!originalToolbar||!card||page.dataset.hptMounted)return;
  page.dataset.hptMounted='true';
  page.classList.add('hpt-page');
  table.classList.add('hpt-table');
  card.classList.add('hpt-table-card');
  const state={stockFilter:'all',columns:readColumnVisibility(safelyGetStorage())};

  const filters=document.createElement('div');
  filters.className='hpt-filters';filters.id='hpt-filters';
  const search=document.createElement('div');search.className='hpt-search';
  const sourceSearch=originalToolbar.querySelector('.prod-search-box');
  if(sourceSearch){search.appendChild(sourceSearch);sourceSearch.classList.add('hpt-search-input-wrap');}
  const categories=document.createElement('div');categories.id='hpt-category-chips';
  categories.className='hpt-categories';categories.setAttribute('aria-label','Product categories');
  const stock=document.createElement('div');stock.className='hpt-stock';stock.id='hpt-stock-filter';
  stock.setAttribute('role','radiogroup');stock.setAttribute('aria-label','Stock filter');
  const group=document.createElement('div');group.className='hpt-filter-actions';
  const picker=document.createElement('div');picker.className='hpt-column-picker';
  picker.innerHTML='<button type="button" id="hpt-column-button" class="hpt-column-button" aria-expanded="false" aria-haspopup="menu" aria-controls="hpt-columns-menu">Columns <span class="hpt-chevron" aria-hidden="true"></span></button><div id="hpt-columns-menu" role="menu" aria-label="Choose product table columns" hidden></div>';
  const brand=document.createElement('label');brand.className='hpt-brand';brand.textContent='Brand';
  const brandSelect=document.getElementById('prodBrandFilter');
  if(brandSelect)brand.appendChild(brandSelect);
  const nativeCategory=document.getElementById('prodCategoryFilter');
  if(nativeCategory){nativeCategory.classList.add('hpt-native-category');nativeCategory.tabIndex=-1;nativeCategory.setAttribute('aria-hidden','true');categories.appendChild(nativeCategory);}
  filters.append(search,categories,group);group.append(stock,brand,picker);
  card.insertBefore(filters,card.firstChild);
  originalToolbar.classList.add('hpt-original-actions');
  if(!originalToolbar.querySelector('#prodAddBtn:not([hidden]),#prodUnpricedLotsBtn:not([hidden])'))
    originalToolbar.classList.add('hpt-no-actions');

  const columnButton=picker.querySelector('#hpt-column-button');
  const menu=picker.querySelector('#hpt-columns-menu');
  let open=false;
  const setOpen=(value,restoreFocus=false)=>{
    open=value;menu.hidden=!value;columnButton.setAttribute('aria-expanded',String(value));
    picker.classList.toggle('hpt-open',value);
    if(restoreFocus)columnButton.focus();
  };
  columnButton.addEventListener('click',()=>setOpen(!open));
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();setOpen(false,true);return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    const items=[...menu.querySelectorAll('button:not(:disabled)')];
    const current=items.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:
      (current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
    event.preventDefault();items[next]?.focus();
  });
  document.addEventListener('pointerdown',event=>{if(open&&!picker.contains(event.target))setOpen(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&open){setOpen(false,true);}});

  for(const {id,label} of COLUMN_DEFINITIONS){
    const button=document.createElement('button');button.type='button';button.setAttribute('role','menuitemcheckbox');
    button.dataset.column=id;button.disabled=LOCKED_COLUMNS.includes(id);
    button.className='hpt-column-choice';
    const name=document.createElement('span');name.textContent=label;
    const check=document.createElement('span');check.className='hpt-column-check';check.setAttribute('aria-hidden','true');
    button.append(name,check);menu.appendChild(button);
    button.addEventListener('click',()=>{
      if(button.disabled)return;
      state.columns[id]=!state.columns[id];
      try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state.columns));}catch{}
      applyColumns();
    });
  }

  const stockKinds=[['all','All stock'],['low','Low'],['out','Out']];
  for(const [kind] of stockKinds){
    const button=document.createElement('button');button.type='button';button.dataset.stock=kind;
    button.className='hpt-stock-pill';button.setAttribute('role','radio');
    button.addEventListener('click',()=>{state.stockFilter=kind;refresh();});
    button.addEventListener('keydown',event=>{
      if(!['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      const values=stockKinds.map(x=>x[0]),i=values.indexOf(kind);
      const next=event.key==='Home'?0:event.key==='End'?2:
        (i+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+3)%3;
      event.preventDefault();stock.querySelector(`[data-stock="${values[next]}"]`)?.click();
      stock.querySelector(`[data-stock="${values[next]}"]`)?.focus();
    });
    stock.appendChild(button);
  }

  categories.addEventListener('click',event=>{
    const button=event.target.closest('button[data-category]');
    if(!button||!nativeCategory)return;
    nativeCategory.value=button.dataset.category;
    nativeCategory.dispatchEvent(new Event('change',{bubbles:true}));
  });

  function fillCategories(){
    if(!nativeCategory)return;
    const previous=document.activeElement?.dataset?.category;
    categories.querySelectorAll('button[data-category]').forEach(button=>button.remove());
    for(const option of nativeCategory.options){
      const button=document.createElement('button');button.type='button';button.className='hpt-category';
      button.dataset.category=option.value;button.textContent=option.value||'All';
      const selected=nativeCategory.value===option.value;
      button.setAttribute('aria-pressed',String(selected));
      if(selected)button.classList.add('hpt-category-active');
      categories.appendChild(button);
      if(option.value===previous)button.focus({preventScroll:true});
    }
  }

  function ensureHeaders(){
    const head=table.tHead?.rows[0];if(!head)return;
    if(head.dataset.hptReady)return;
    if(head.cells.length!==8)throw new Error('Original Product Table column contract changed');
    const [product,category,purchase,selling,stockQty,stockValue,status,actions]=[...head.cells];
    const index=document.createElement('th');index.scope='col';index.textContent='#';
    const unit=document.createElement('th');unit.scope='col';unit.textContent='Unit';
    const ordered=[index,product,category,stockQty,stockValue,unit,purchase,selling,status,actions];
    head.replaceChildren(...ordered);head.dataset.hptReady='true';
    COLUMN_DEFINITIONS.forEach((col,i)=>ordered[i].dataset.hptColumn=col.id);
    actions.classList.add('hpt-actions-heading');
    table.setAttribute('aria-label','Product list');
  }

  function sourceRows(){
    const data=window.prodState?.products||[];
    const cat=nativeCategory?.value||'';
    const brandValue=brandSelect?.value||'';
    const searchValue=document.getElementById('prodSearch')?.value||'';
    const selected=data.filter(p=>(!cat||p.Category===cat)&&(!brandValue||p.Brand===brandValue));
    if(typeof window.smartSearchProducts_!=='function'||typeof window.prodSortRows_!=='function')return selected;
    return window.prodSortRows_(window.smartSearchProducts_(selected,searchValue));
  }

  function addProductMeta(cell,product){
    const name=cell.querySelector('.prod-item-name');if(!name)return;
    const wrap=document.createElement('div');wrap.className='hpt-product-layout';
    const thumbnail=document.createElement('span');thumbnail.className='hpt-product-thumbnail';
    thumbnail.setAttribute('aria-hidden','true');thumbnail.textContent=String(product?.['Product Name']||'?').trim().slice(0,1).toUpperCase();
    const identity=document.createElement('div');identity.className='hpt-product-identity';
    identity.appendChild(name);
    const metadata=[product?.['Product Name BN'],product?.Barcode].filter(Boolean).map(String).join(' · ');
    if(metadata){const small=document.createElement('small');small.className='hpt-product-meta';small.textContent=metadata;identity.append(small);}
    wrap.append(thumbnail,identity);cell.replaceChildren(wrap);
  }

  function decorateRows(){
    const rows=sourceRows();const body=table.tBodies[0];if(!body)return 0;
    let visible=0;
    [...body.rows].forEach((row,index)=>{
      if(row.dataset.hptReady){
        // Existing rows are not recreated by stock-only filtering. Update their
        // visibility on each refresh; keep original sort/search result ordering.
        const group=rows[index]?productStockGroup(rows[index]):'unknown';
        row.hidden=state.stockFilter!=='all'&&group!==state.stockFilter;
        if(!row.hidden)visible++;
        return;
      }
      const cells=[...row.cells];if(cells.length!==8)return;
      const product=rows[index];
      const [name,category,purchase,selling,stockQty,stockValue,status,actions]=cells;
      const indexCell=document.createElement('td');indexCell.textContent=String(index+1)+'.';
      const unitCell=document.createElement('td');unitCell.textContent=String(product?.Unit||'—');
      const ordered=[indexCell,name,category,stockQty,stockValue,unitCell,purchase,selling,status,actions];
      row.replaceChildren(...ordered);row.dataset.hptReady='true';
      COLUMN_DEFINITIONS.forEach((col,i)=>ordered[i].dataset.hptColumn=col.id);
      indexCell.className='hpt-row-number';name.classList.add('hpt-product-cell');
      category.classList.add('hpt-category-cell');stockQty.classList.add('hpt-stock-cell');
      stockValue.classList.add('hpt-price-cell');unitCell.classList.add('hpt-unit-cell');
      purchase.classList.add('hpt-price-cell');selling.classList.add('hpt-price-cell','hpt-selling-cell');
      // Owner read-only projection replaces the original action <td> and loses
      // its class. Reapply the original sticky-action contract without enabling
      // any forbidden edit, delete, stock-adjust or lot action.
      actions.classList.add('erp-sticky-action-col','hpt-actions-cell');
      if(product){
        addProductMeta(name,product);
        const brandName=String(product.Brand||'').trim();
        if(brandName&&brandName!=='Generic / No brand'){
          const small=document.createElement('small');small.className='hpt-category-brand';small.textContent=brandName;
          category.appendChild(small);
        }
        const group=productStockGroup(product);
        stockQty.dataset.stockGroup=group;
        if(group==='low'||group==='out')stockQty.classList.add('hpt-stock-'+group);
        row.hidden=state.stockFilter!=='all'&&group!==state.stockFilter;
      }else{row.hidden=state.stockFilter!=='all';}
      if(!row.hidden)visible++;
      if(!actions.querySelector('button'))actions.title='Product edit/actions are not enabled for this Owner source';
    });
    return visible;
  }

  function applyColumns(){
    for(const {id} of COLUMN_DEFINITIONS){
      for(const cell of page.querySelectorAll(`#prodTable [data-hpt-column="${id}"]`))
        cell.hidden=!state.columns[id];
      for(const cell of document.querySelectorAll(`.prod-pinned-header [data-hpt-column="${id}"]`))
        cell.hidden=!state.columns[id];
      const button=menu.querySelector(`[data-column="${id}"]`);
      button?.setAttribute('aria-checked',String(state.columns[id]));
    }
    if(window.requestAnimationFrame&&typeof window.prodSyncTopScrollbar_==='function')
      requestAnimationFrame(()=>window.prodSyncTopScrollbar_());
  }

  const empty=document.getElementById('prodEmptyState');
  function updateEmpty(count){
    if(!empty)return;
    empty.hidden=count!==0;
    if(count>0)return;
    empty.replaceChildren();
    const title=document.createElement('p');title.textContent='No products match';
    const explanation=document.createElement('p');explanation.textContent='Try another search or clear filters.';
    const clear=document.createElement('button');clear.type='button';clear.textContent='Clear filters';
    clear.className='hpt-clear-button';clear.addEventListener('click',()=>{
      document.getElementById('prodSearch').value='';
      nativeCategory.value='';if(brandSelect)brandSelect.value='';state.stockFilter='all';
      window.prodRender();
    });
    empty.append(title,explanation,clear);
  }

  function refresh(){
    ensureHeaders();fillCategories();
    const products=window.prodState?.products||[];
    const low=filterProductsByStock(products,'low').length;
    const out=filterProductsByStock(products,'out').length;
    for(const [kind,label] of stockKinds){
      const button=stock.querySelector(`[data-stock="${kind}"]`);
      button.textContent=kind==='all'?label:`${label} (${kind==='low'?low:out})`;
      button.setAttribute('aria-checked',String(state.stockFilter===kind));
      button.tabIndex=state.stockFilter===kind?0:-1;
      button.title='Stock filters use the currently displayed source values; historical snapshots may be stale';
    }
    const count=decorateRows();applyColumns();updateEmpty(count);
  }
  const original=window.prodRender;
  if(typeof original!=='function')throw new Error('Original Product Table rendering is unavailable');
  window.prodRender=function(...args){const result=original.apply(this,args);refresh();return result;};
  const originalOptions=window.prodFillCategoryAndUnitSelects_;
  if(typeof originalOptions==='function')window.prodFillCategoryAndUnitSelects_=function(...args){
    const result=originalOptions.apply(this,args);fillCategories();return result;
  };
  refresh();

  function safelyGetStorage(){try{return localStorage.getItem(STORAGE_KEY);}catch{return null;}}
}

if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountProductsTable,{once:true});
  else mountProductsTable();
}
