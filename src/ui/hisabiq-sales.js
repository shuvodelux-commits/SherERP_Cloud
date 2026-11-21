/* HisabIQ Sales visual adapter — presentation only. Existing smLoad/smRender,
   Owner Shop D1 read permissions and original invoice action handlers are authoritative. */
(function () {
  'use strict';
  var page=document.getElementById('page-sales');
  if(!page || !page.hasAttribute('data-hisabiq-sales')) return;
  if(page.dataset.hSalesMounted==='true') return;
  page.dataset.hSalesMounted='true';

  var tableScroll=document.getElementById('smTableScroll');
  var table=tableScroll && tableScroll.querySelector('table');
  var body=document.getElementById('smTableBody');
  var toolbar=page.querySelector(':scope > .toolbar');
  var card=page.querySelector(':scope > .card');
  if(!table || !body || !toolbar || !card) return;
  var keys=['invoice','date','customer','phone','total','paid','due','returned','profit','status','actions'];
  var optional=['date','phone','returned','profit','status'];
  var mandatory=['invoice','customer','total','paid','due','actions'];
  var label={invoice:'Invoice',date:'Date',customer:'Customer',phone:'Phone',
    total:'Total',paid:'Paid',due:'Due',returned:'Returned',profit:'Profit',
    status:'Status',actions:'Actions'};
  var localKey='hisabiq:sales-columns-v1';
  var visible=Object.fromEntries(keys.map(function(key){
    return [key, key!=='date' && key!=='phone'];
  }));
  try {
    var saved=JSON.parse(window.localStorage.getItem(localKey)||'null');
    if(saved && typeof saved==='object')optional.forEach(function(key){
      if(typeof saved[key]==='boolean')visible[key]=saved[key];
    });
  }catch(_){}
  mandatory.forEach(function(key){visible[key]=true;});
  var sortBy=null,sortDir=0,pageIndex=0,pageSize=10;
  var activeRows=[],updating=false,scheduled=false,observer;
  var loadedOnce=false;
  var money=function(value){
    var number=Number(value);
    if(!Number.isFinite(number))return '—';
    return '৳'+new Intl.NumberFormat('en-BD',{minimumFractionDigits:0,
      maximumFractionDigits:2}).format(Math.round(number*100)/100);
  };

  function icon(shape){
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+shape+'"/></svg>';
  }
  var plus=icon('M12 5v14M5 12h14');
  var book=icon('M4 19.5V5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 1 0-4h14');
  var download=icon('M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4');
  var filterIcon=icon('M4 7h16M7 12h10M10 17h4');
  var columnsIcon=icon('M4 4h16v16H4zM11 4v16M17 4v16');

  var heading=document.createElement('div');
  heading.className='h-sales-heading';
  heading.innerHTML='<div><h1>Sales <small lang="bn">বিক্রয়</small></h1>'+
    '<p>Manage invoices, collect due payments, handle returns and drafts.</p></div>'+
    '<div class="h-sales-heading-actions">'+
    '<button type="button" id="h-sales-ledger" class="h-sales-button">'+book+' Customer ledger</button>'+
    '<button type="button" id="h-sales-new" class="h-sales-button h-sales-button-primary">'+plus+' New sale</button></div>';
  page.insertBefore(heading,toolbar);
  heading.querySelector('#h-sales-ledger').addEventListener('click',function(){
    if(typeof goToPage==='function')goToPage('customers');
  });
  heading.querySelector('#h-sales-new').addEventListener('click',function(){
    if(typeof goToPage==='function')goToPage('posv2');
  });

  var summary=document.createElement('div');
  summary.className='h-sales-summary';
  summary.setAttribute('aria-label','Loaded sales invoice summary');
  var cards=[
    ['count','Loaded invoices','বিলের সংখ্যা',''],
    ['billed','Total billed','মোট বিক্রয়',''],
    ['paid','Paid / settled','জমা হয়েছে','paid'],
    ['due','Outstanding due','বাকি টাকা','due']
  ];
  cards.forEach(function(entry){
    var cell=document.createElement('div');
    cell.className='h-sales-summary-card';
    if(entry[3])cell.dataset.tone=entry[3];
    var name=document.createElement('span');
    name.className='h-sales-summary-label';name.textContent=entry[1];
    var value=document.createElement('strong');
    value.className='h-sales-summary-value';value.dataset.summary=entry[0];
    value.textContent='—';
    var helper=document.createElement('span');
    helper.className='h-sales-summary-sub';helper.lang='bn';helper.textContent=entry[2];
    cell.append(name,value,helper);summary.appendChild(cell);
  });
  page.insertBefore(summary,toolbar);

  toolbar.classList.add('h-sales-toolbar');
  var filterFields=document.createElement('div');
  filterFields.className='h-sales-filter-fields';
  filterFields.id='h-sales-filters';
  ['smDateFrom','smDateTo','smPaymentStatus','smReturnStatus'].forEach(function(id){
    var node=document.getElementById(id);
    if(node){
      node.removeAttribute('style');
      if(node.tagName==='INPUT')node.setAttribute('aria-label',id==='smDateFrom'?'Date from':'Date to');
      else node.setAttribute('aria-label',id==='smPaymentStatus'?'Payment status':'Return status');
      filterFields.appendChild(node);
    }
  });
  toolbar.appendChild(filterFields);
  var actions=document.createElement('div');
  actions.className='h-sales-actions';
  var filterBtn=document.createElement('button');
  filterBtn.id='h-sales-filters-toggle';filterBtn.type='button';
  filterBtn.className='h-sales-button';
  filterBtn.innerHTML=filterIcon+'<span>Filters</span>';
  filterBtn.setAttribute('aria-expanded','false');filterBtn.setAttribute('aria-controls','h-sales-filters');
  filterBtn.addEventListener('click',function(){
    var open=toolbar.classList.toggle('h-sales-filters-open');
    filterBtn.setAttribute('aria-expanded',String(open));
  });
  actions.appendChild(filterBtn);
  var menuHost=document.createElement('div');
  menuHost.className='h-sales-menu-container';
  menuHost.innerHTML='<button id="h-sales-columns-button" type="button" class="h-sales-button"'+
    ' aria-haspopup="menu" aria-expanded="false">'+columnsIcon+
    '<span>Columns</span></button><div id="h-sales-column-menu"'+
    ' class="h-sales-column-menu" role="menu" aria-label="Invoice columns" hidden></div>';
  var menuButton=menuHost.querySelector('button');
  var menu=menuHost.querySelector('[role="menu"]');
  function closeMenu(){
    menu.hidden=true;menuButton.setAttribute('aria-expanded','false');
  }
  function fillMenu(){
    menu.replaceChildren();
    keys.forEach(function(key){
      if(key==='actions')return;
      var row=document.createElement('label');
      row.setAttribute('role','menuitemcheckbox');
      row.setAttribute('aria-checked',String(visible[key]));
      row.textContent=label[key];
      var check=document.createElement('input');
      check.type='checkbox';check.checked=visible[key];
      check.disabled=mandatory.includes(key) || (key==='profit' && !window.smState?.showProfit);
      check.tabIndex=-1;
      check.addEventListener('change',function(){
        visible[key]=check.checked;row.setAttribute('aria-checked',String(check.checked));
        try{window.localStorage.setItem(localKey,JSON.stringify(visible));}catch(_){}
        refresh();
      });
      row.appendChild(check);menu.appendChild(row);
    });
  }
  menuButton.addEventListener('click',function(){
    if(!menu.hidden){closeMenu();return;}
    fillMenu();menu.hidden=false;menuButton.setAttribute('aria-expanded','true');
  });
  menu.addEventListener('keydown',function(event){
    if(event.key==='Escape'){event.preventDefault();closeMenu();menuButton.focus();}
    if(event.key===' ' || event.key==='Enter'){
      var row=event.target.closest('[role="menuitemcheckbox"]');
      if(row){var input=row.querySelector('input');if(input&&!input.disabled)input.click();}
    }
  });
  document.addEventListener('click',function(event){
    if(!menuHost.contains(event.target))closeMenu();
  });
  actions.appendChild(menuHost);

  var exportButton=document.createElement('button');
  exportButton.id='h-sales-export';exportButton.type='button';exportButton.className='h-sales-button';
  exportButton.innerHTML=download+'<span>Export</span>';
  actions.appendChild(exportButton);
  var clearButton=document.createElement('button');
  clearButton.id='h-sales-clear';clearButton.type='button';clearButton.className='h-sales-button';
  clearButton.textContent='Reset';
  clearButton.addEventListener('click',function(){
    ['smSearch','smDateFrom','smDateTo','smPaymentStatus','smReturnStatus'].forEach(function(id){
      var node=document.getElementById(id);if(node)node.value='';
    });
    pageIndex=0;
    if(typeof smRender==='function')smRender();
    refresh();
  });
  actions.appendChild(clearButton);
  var refreshButton=document.getElementById('smRefreshBtn');
  if(refreshButton)actions.appendChild(refreshButton); // same node, same native listener
  toolbar.appendChild(actions);

  var footer=document.createElement('div');
  footer.className='h-sales-footer';
  footer.innerHTML='<span id="h-sales-result-count" aria-live="polite">Sales records not loaded</span>'+
    '<div class="h-sales-pagination"><label for="h-sales-size">Rows:</label>'+
    '<select id="h-sales-size" aria-label="Sales rows per page">'+
    '<option value="10">10</option><option value="25">25</option>'+
    '<option value="50">50</option><option value="all">All</option></select>'+
    '<button id="h-sales-prev" type="button" aria-label="Previous page">‹</button>'+
    '<span id="h-sales-page-count" aria-live="polite">1 / 1</span>'+
    '<button id="h-sales-next" type="button" aria-label="Next page">›</button></div>';
  card.after(footer);
  footer.querySelector('#h-sales-size').addEventListener('change',function(event){
    pageSize=event.target.value==='all'?Infinity:Number(event.target.value);
    pageIndex=0;refresh();
  });
  footer.querySelector('#h-sales-prev').addEventListener('click',function(){
    if(pageIndex>0){pageIndex--;refresh();}
  });
  footer.querySelector('#h-sales-next').addEventListener('click',function(){
    var pages=Math.max(1,Math.ceil(activeRows.length/pageSize));
    if(pageIndex+1<pages){pageIndex++;refresh();}
  });
  function getSale(tr){
    var button=tr.querySelector('[data-invoice-view-id]');
    var id=button && button.dataset.invoiceViewId;
    return id && window.smState && Array.isArray(window.smState.sales)
      ?window.smState.sales.find(function(s){return s.invoiceId===id;}):null;
  }
  function sortValue(s,key){
    if(!s)return '';
    switch(key){
      case 'invoice':return s.invoiceId;
      case 'date':return s.date;
      case 'customer':return s.customerName;
      case 'phone':return s.customerPhone;
      case 'total':return Number(s.grandTotal)||0;
      case 'paid':return Number(s.paidAmount)||0;
      case 'due':return Number(s.dueAmount)||0;
      case 'returned':return Number(s.returnedAmount)||0;
      case 'profit':return Number(s.profit)||0;
      case 'status':return s.paymentStatus;
      default:return '';
    }
  }
  function sortRows(rows){
    if(!sortBy || sortDir===0)return rows;
    return rows.map(function(row,index){return {row,index,sale:getSale(row)};})
      .sort(function(a,b){
        var va=sortValue(a.sale,sortBy),vb=sortValue(b.sale,sortBy);
        var order=typeof va==='number'&&typeof vb==='number'
          ?va-vb:String(va??'').localeCompare(String(vb??''),undefined,{numeric:true,sensitivity:'base'});
        return sortDir*order || a.index-b.index;
      }).map(function(entry){return entry.row;});
  }
  function decorateHeader(){
    var ths=Array.from(table.querySelectorAll('thead tr:first-child > th'));
    ths.forEach(function(th,index){
      var key=keys[index];if(!key)return;
      th.dataset.hSalesCol=key;
      if(key!=='actions'&&!th.querySelector('[data-h-sales-sort]')){
        var button=document.createElement('button');
        button.type='button';button.className='h-sales-sort';button.dataset.hSalesSort=key;
        button.textContent=label[key];
        var indicator=document.createElement('span');
        indicator.className='h-sales-sort-glyph';indicator.setAttribute('aria-hidden','true');
        indicator.textContent='↕';button.appendChild(indicator);
        th.replaceChildren(button);
      }
      th.hidden=!visible[key]||(key==='profit'&&!window.smState?.showProfit);
      th.setAttribute('aria-sort',sortBy===key&&sortDir
        ?(sortDir===1?'ascending':'descending'):'none');
      var sorter=th.querySelector('[data-h-sales-sort]');
      if(sorter){
        sorter.dataset.active=String(sortBy===key&&!!sortDir);
        sorter.querySelector('.h-sales-sort-glyph').textContent=
          sortBy===key&&sortDir?(sortDir===1?'↑':'↓'):'↕';
      }
    });
  }
  function decorateRow(tr){
    var columns=window.smState?.showProfit?keys:keys.filter(function(key){return key!=='profit';});
    Array.from(tr.cells).forEach(function(td,index){
      var key=columns[index];if(!key)return;
      td.dataset.hSalesCol=key;td.dataset.hSalesLabel=label[key];
      td.hidden=!visible[key];
    });
    var invoice=tr.querySelector('td[data-h-sales-col="invoice"]');
    var customer=tr.querySelector('td[data-h-sales-col="customer"]');
    var date=tr.querySelector('td[data-h-sales-col="date"]');
    var phone=tr.querySelector('td[data-h-sales-col="phone"]');
    [[invoice,date,'date'],[customer,phone,'phone']].forEach(function(pair){
      if(!pair[0]||!pair[1])return;
      var helper=pair[0].querySelector('.h-sales-cell-helper');
      if(!helper){
        helper=document.createElement('span');helper.className='h-sales-cell-helper';
        pair[0].appendChild(helper);
      }
      helper.textContent=pair[1].textContent.trim()||
        (pair[2]==='phone'?'No phone':'');
      helper.hidden=visible[pair[2]];
    });
    if(!tr.dataset.hSalesRowWired){
      tr.dataset.hSalesRowWired='true';tr.tabIndex=0;
      tr.setAttribute('aria-label','Open sales invoice details');
      tr.addEventListener('click',function(event){
        if(event.target.closest('button,a,input,select,[role="button"]'))return;
        var btn=tr.querySelector('[data-invoice-view-id]');
        if(btn&&!btn.disabled)btn.click();
      });
      tr.addEventListener('keydown',function(event){
        if(event.target!==tr || !['Enter',' '].includes(event.key))return;
        event.preventDefault();
        var btn=tr.querySelector('[data-invoice-view-id]');
        if(btn&&!btn.disabled)btn.click();
      });
    }
  }
  function updateSummary(){
    var state=window.smState;
    var sales=state&&Array.isArray(state.sales)?state.sales:[];
    var available=state && (state._loaded===true || (state._loaded!==false && sales.length>0));
    if(available)loadedOnce=true;
    var values={
      count:sales.length,
      billed:sales.reduce(function(sum,s){return sum+(Number(s.grandTotal)||0);},0),
      paid:sales.reduce(function(sum,s){return sum+(Number(s.paidAmount)||0);},0),
      due:sales.reduce(function(sum,s){return sum+(Number(s.dueAmount)||0);},0)
    };
    for(var key of Object.keys(values)){
      var node=summary.querySelector('[data-summary="'+key+'"]');
      node.textContent=!available?'—':(key==='count'?String(values[key]):money(values[key]));
    }
  }
  function renderPage(){
    var count=activeRows.length;
    var pages=Math.max(1,Math.ceil(count/pageSize));
    pageIndex=Math.min(pageIndex,pages-1);
    var from=pageIndex*pageSize,to=Math.min(count,from+pageSize);
    activeRows.forEach(function(row,index){row.hidden=index<from||index>=to;});
    var status=footer.querySelector('#h-sales-result-count');
    var total=window.smState?.sales?.length||0;
    var isLoaded=window.smState?._loaded!==false&&(loadedOnce||total>0);
    status.textContent=!isLoaded?'Sales records not loaded':
      'Showing '+(count?from+1:0)+'–'+to+' of '+count+' matched invoices'+
      (count!==total?' ('+total+' loaded)':'');
    footer.querySelector('#h-sales-page-count').textContent=(pageIndex+1)+' / '+pages;
    footer.querySelector('#h-sales-prev').disabled=pageIndex<=0;
    footer.querySelector('#h-sales-next').disabled=pageIndex>=pages-1;
    clearButton.hidden=!['smSearch','smDateFrom','smDateTo','smPaymentStatus','smReturnStatus']
      .some(function(id){return !!document.getElementById(id)?.value;});
  }
  function refresh(){
    if(updating)return;
    updating=true;
    try{
      observer?.disconnect();
      decorateHeader();
      var rows=Array.from(body.querySelectorAll(':scope > tr'));
      rows.forEach(decorateRow);
      var sorted=sortRows(rows);
      if(sortBy&&sortDir && sorted.some(function(row,index){return row!==rows[index];}))
        body.replaceChildren(...sorted);
      activeRows=sorted;
      updateSummary();renderPage();
    }finally{
      updating=false;
      observer?.observe(body,{childList:true});
    }
  }
  function schedule(){
    if(scheduled)return;
    scheduled=true;
    queueMicrotask(function(){scheduled=false;refresh();});
  }

  document.addEventListener('click',function(event){
    var sortBtn=event.target.closest('[data-h-sales-sort]');
    if(!sortBtn)return;
    var key=sortBtn.dataset.hSalesSort;
    if(!keys.includes(key)||key==='actions')return;
    if(sortBy!==key){sortBy=key;sortDir=['total','paid','due','returned','profit','date'].includes(key)?-1:1;}
    else if(sortDir===1)sortDir=-1;
    else {sortBy=null;sortDir=0;}
    pageIndex=0;
    if(!sortBy && typeof smRender==='function')smRender();
    schedule();
  });
  ['smSearch','smDateFrom','smDateTo','smPaymentStatus','smReturnStatus'].forEach(function(id){
    var input=document.getElementById(id);
    if(!input)return;
    input.addEventListener('input',function(){pageIndex=0;schedule();});
    input.addEventListener('change',function(){pageIndex=0;schedule();});
  });
  function safeCsv(value){
    var text=String(value??'').replace(/\s+/g,' ').trim();
    if(/^[=+\-@]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }
  exportButton.addEventListener('click',function(){
    var cols=['invoice','date','customer','phone','total','paid','due','returned','profit','status'];
    var lines=[cols.map(function(key){return safeCsv(label[key]);}).join(',')];
    activeRows.forEach(function(row){
      lines.push(cols.map(function(key){
        var td=row.querySelector('[data-h-sales-col="'+key+'"]');
        if(!td)return '';
        var copy=td.cloneNode(true);
        copy.querySelectorAll('.h-sales-cell-helper').forEach(function(node){node.remove();});
        return safeCsv(copy.textContent);
      }).join(','));
    });
    var blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    try {
      var link=document.createElement('a');link.href=url;
      link.download='hisabiq-sales.csv';link.style.display='none';
      document.body.appendChild(link);link.click();link.remove();
    }finally{setTimeout(function(){URL.revokeObjectURL(url);},0);}
  });

  observer=new MutationObserver(schedule);
  observer.observe(body,{childList:true});
  // Existing input handlers hold the original smRender reference; the observer
  // covers them. Direct smRender callers (including original smLoad) use this
  // wrapper, which changes only read-only DOM presentation after rendering.
  if(typeof smRender==='function'){
    var originalRender=smRender;
    smRender=function(){
      var result=originalRender.apply(this,arguments);
      schedule();return result;
    };
  }
  if(document.readyState==='loading')
    document.addEventListener('DOMContentLoaded',schedule,{once:true});
  else schedule();
})();
