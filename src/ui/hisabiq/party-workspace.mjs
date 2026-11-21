/**
 * M01 Owner Party workspace: source-faithful HisabIQ visual adapter.
 * Uses authenticated Shop reads and existing restricted clean-Shop Supplier
 * creation. No generic multi-role Party or financial posting is fabricated.
 * Supplier fallback is identified as a source record and
 * NEVER treated as a reviewed unified Party identity.
 */
export const ROLES=Object.freeze(['Customer','Supplier','Vendor','Lender','Borrower','Payee','Owner']);
const SUPPLIER_ID=/^SUP-[0-9]{6,}$/;
const SOURCE_PARTY_ID=/^PTY-[0-9]{6,}$/;
const ROLE_SET=new Set(ROLES);
const MAX_ROWS=1000;
const SOURCE_ERROR='Party source data unavailable';
const BENGALI=Object.freeze({
  All:'সব',Customer:'ক্রেতা',Supplier:'সরবরাহকারী',Vendor:'ভেন্ডর',
  Lender:'ঋণদাতা',Borrower:'ঋণগ্রহীতা',Payee:'টাকা প্রাপক',Owner:'মালিক'
});

function plainObject(value) {
  return value!==null&&typeof value==='object'&&!Array.isArray(value);
}
function nonempty(value,max=180) {
  return typeof value==='string'&&value.trim().length>0&&value.length<=max;
}
function safePaisa(value) {
  if(!Number.isSafeInteger(value))throw new Error(SOURCE_ERROR);
  return value;
}
export function parseMoneyPaisa(value) {
  if(typeof value!=='string'&&typeof value!=='number')throw new Error(SOURCE_ERROR);
  const normalized=String(value);
  if(!/^-?(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?$/.test(normalized))
    throw new Error(SOURCE_ERROR);
  const negative=normalized[0]==='-';
  const digits=negative?normalized.slice(1):normalized;
  const [whole,fraction='']=digits.split('.');
  const paisa=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  return safePaisa(negative?-paisa:paisa);
}
export function formatMoneyPaisa(paisa) {
  safePaisa(paisa);
  return (paisa<0?'−':'')+'৳'+(Math.abs(paisa)/100).toLocaleString('en-IN',{
    minimumFractionDigits:2,maximumFractionDigits:2
  });
}
function uniqueRoles(roles) {
  if(!Array.isArray(roles)||roles.length<1||roles.length>ROLES.length||
     roles.some(role=>!ROLE_SET.has(role))||new Set(roles).size!==roles.length)
    throw new Error('Invalid or duplicate Party role');
  return ROLES.filter(role=>roles.includes(role));
}
function textField(value,max=250) {
  if(value==null)return '';
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))
    throw new Error(SOURCE_ERROR);
  return value;
}
function resultRows(raw,key) {
  if(!plainObject(raw)||!Array.isArray(raw[key])||raw[key].length>MAX_ROWS)
    throw new Error('Party data limit or source unavailable');
  return raw[key];
}
/**
 * Optional authenticated Supplier historical opening checkpoint. The current
 * due includes positive opening payable, but the negative Supplier advance is
 * a distinct asset and MUST NOT net against current due or Party role accounts.
 * Older Shop schemas do not expose these extra fields.
 */
function sourceSupplierOpening(row,keys,sourceMoney=false) {
  const [signedKey,payableKey,advanceKey]=keys;
  const trigger=[payableKey,advanceKey].some(key=>Object.hasOwn(row,key));
  if(!trigger) {
    // Pre-overlay Supplier source rows have an independent original opening
    // column; validate that money but never claim an operational checkpoint.
    if(sourceMoney){
      if(Object.hasOwn(row,signedKey))parseMoneyPaisa(row[signedKey]);
    }else if(Object.hasOwn(row,signedKey))throw new Error(SOURCE_ERROR);
    return null;
  }
  if(!keys.every(key=>Object.hasOwn(row,key)))throw new Error(SOURCE_ERROR);
  const read=sourceMoney?parseMoneyPaisa:safePaisa;
  const signedPaisa=read(row[signedKey]);
  const payablePaisa=read(row[payableKey]);
  const advancePaisa=read(row[advanceKey]);
  if(payablePaisa!==Math.max(0,signedPaisa)||
     advancePaisa!==Math.max(0,-signedPaisa))
    throw new Error(SOURCE_ERROR);
  return {signedPaisa,payablePaisa,advancePaisa};
}

export function sourceSupplierParties(raw) {
  const seen=new Set();
  return resultRows(raw,'suppliers').map(row=>{
    if(!plainObject(row)||!SUPPLIER_ID.test(row['Supplier ID'])||
       !nonempty(row['Supplier Name'],120)||seen.has(row['Supplier ID']))
      throw new Error('Invalid or duplicate Supplier source record');
    seen.add(row['Supplier ID']);
    const due=parseMoneyPaisa(row['Current Due']);
    const supplierOpening=sourceSupplierOpening(row,
      ['Opening Balance','Opening Payable','Supplier Advance'],true);
    const receivablePaisa=safePaisa((due<0?-due:0)+
      (supplierOpening?.advancePaisa||0));
    return {
      id:'source:'+row['Supplier ID'],partyId:null,sourceOnly:true,
      sourceIds:{Supplier:row['Supplier ID']},
      name:textField(row['Supplier Name'],120),
      nameBn:'',phone:textField(row.Phone,40),address:textField(row.Address,250),
      roles:['Supplier'],status:row.Status==='Inactive'?'Inactive':'Active',
      supplierOpening,
      gross:{Supplier:{receivablePaisa,payablePaisa:due>0?due:0}}
    };
  });
}
export function normalizePartyDirectory(raw) {
  if(!plainObject(raw)||raw.success!==true||!plainObject(raw.data))
    throw new Error(SOURCE_ERROR);
  const seen=new Set();
  return resultRows(raw.data,'parties').map(row=>{
    if(!plainObject(row)||!SOURCE_PARTY_ID.test(row.partyId)||
       !nonempty(row.displayName,180)||seen.has(row.partyId))
      throw new Error('Invalid or duplicate Party identity');
    seen.add(row.partyId);
    const roles=uniqueRoles(row.roles);
    const gross={};
    const balances=row.roleBalances??[];
    if(!Array.isArray(balances)||balances.length>ROLES.length)
      throw new Error(SOURCE_ERROR);
    for(const balance of balances){
      if(!plainObject(balance)||!roles.includes(balance.role)||gross[balance.role]||
         balance.receivablePaisa<0||balance.payablePaisa<0)
        throw new Error('Invalid role-specific Party account');
      gross[balance.role]={
        receivablePaisa:safePaisa(balance.receivablePaisa),
        payablePaisa:safePaisa(balance.payablePaisa)
      };
    }
    const sourceIds={};
    if(row.sourceIds!=null){
      if(!plainObject(row.sourceIds)||Object.keys(row.sourceIds).some(key=>key!=='Supplier'))
        throw new Error(SOURCE_ERROR);
      if(row.sourceIds.Supplier!=null){
        if(!roles.includes('Supplier')||!SUPPLIER_ID.test(row.sourceIds.Supplier))
          throw new Error(SOURCE_ERROR);
        sourceIds.Supplier=row.sourceIds.Supplier;
      }
    }
    return {
      id:'party:'+row.partyId,partyId:row.partyId,sourceOnly:false,sourceIds,
      name:textField(row.displayName,180),nameBn:textField(row.nameBn,180),
      phone:textField(row.phone,40),address:textField(row.address,250),
      roles,status:row.status==='Inactive'?'Inactive':'Active',gross
    };
  });
}
export function filterPartyDirectory(parties,query='',role='All') {
  if(!Array.isArray(parties)||!['All',...ROLES].includes(role))
    throw new Error(SOURCE_ERROR);
  const q=String(query).trim().toLocaleLowerCase();
  return parties.filter(p=>(role==='All'||p.roles.includes(role))&&
    (!q||[p.name,p.nameBn,p.phone,p.address,p.id].some(v=>String(v||'').toLocaleLowerCase().includes(q))));
}
export function projectSupplierStatement(raw,expectedSourceId){
  const row=raw?.data;
  if(raw?.success!==true||!plainObject(row)||
    row.supplierId!==expectedSourceId||!SUPPLIER_ID.test(expectedSourceId)||
    !['purchase-credit-only','purchase-and-cash-payment'].includes(row.scope)||
    !Number.isSafeInteger(row.currentDuePaisa)||
    typeof row.hasMore!=='boolean'||!Array.isArray(row.entries)||row.entries.length>50)
    throw new Error('Supplier statement unavailable');
  const supplierOpening=sourceSupplierOpening(row,
    ['openingBalancePaisa','openingPayablePaisa','supplierAdvancePaisa']);
  const entries=row.entries.map(entry=>{
    const opening=entry?.kind==='Historical Opening';
    if(!plainObject(entry)||
      !['Purchase','Supplier Payment','Historical Opening'].includes(entry.kind)||
      !(opening
        ? /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(entry.reference)
        : /^(PUR|SPY)-[0-9]{6,}$/.test(entry.reference))||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.purchaseDate)||
      !Number.isSafeInteger(entry.debitPaisa)||entry.debitPaisa<0||
      !Number.isSafeInteger(entry.creditPaisa)||entry.creditPaisa<0||
      !Number.isSafeInteger(entry.balancePaisa)||
      (opening&&(!supplierOpening||entry.creditPaisa!==0||
        entry.debitPaisa!==supplierOpening.payablePaisa)))
      throw new Error('Invalid Supplier statement row');
    return {kind:entry.kind,reference:entry.reference,date:entry.purchaseDate,
      debitPaisa:entry.debitPaisa,creditPaisa:entry.creditPaisa,
      balancePaisa:entry.balancePaisa};
  });
  if(entries.filter(entry=>entry.kind==='Historical Opening').length>1)
    throw new Error('Invalid Supplier statement row');
  if(entries.length && entries[0].balancePaisa!==row.currentDuePaisa)
    throw new Error('Supplier statement balance mismatch');
  for(let i=1;i<entries.length;i++) {
    if(entries[i].balancePaisa!==
       entries[i-1].balancePaisa-entries[i-1].debitPaisa+entries[i-1].creditPaisa)
      throw new Error('Supplier statement running balance mismatch');
  }
  return {scope:row.scope,currentDuePaisa:row.currentDuePaisa,
    entries,complete:!row.hasMore,sourceId:expectedSourceId,
    supplierOpening,cashPayAvailable:row.cashPayAvailable===true};
}

export function sourceSupplierCreatePayload(values,operationId){
  if(!plainObject(values)||typeof operationId!=='string'||
     !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operationId))
    throw new Error('Invalid Supplier operation ID.');
  if(Object.keys(values).some(k=>!['name','phone','address','notes','openingBalance'].includes(k)))
    throw new Error('Unknown Supplier field.');
  const fields={name:120,phone:40,address:250,notes:500};
  const record={operationId};
  for(const [key,max] of Object.entries(fields)){
    const value=values[key]??'';
    if(typeof value!=='string'||value.length>max||!value.isWellFormed()||
       /[\u0000-\u001f\u007f]/.test(value))
      throw new Error('Invalid Supplier '+key+'.');
    record[key]=value.trim();
  }
  if(!record.name)throw new Error('Supplier name is required.');
  if(values.openingBalance!==undefined&&
     !['0','0.0','0.00'].includes(String(values.openingBalance)))
    throw new Error('Nonzero Supplier opening balances are not connected.');
  record.openingBalance='0';
  return record;
}

// Ported from hisabiq_ui@e42a00a9 src/utils/amountInWords.ts.
// Presentation only; never a financial posting or source-of-truth amount.
const PARTY_BN_WORDS=[
 'শূন্য','এক','দুই','তিন','চার','পাঁচ','ছয়','সাত','আট','নয়',
 'দশ','এগারো','বারো','তেরো','চৌদ্দ','পনেরো','ষোলো','সতেরো','আঠারো','উনিশ',
 'বিশ','একুশ','বাইশ','তেইশ','চব্বিশ','পঁচিশ','ছাব্বিশ','সাতাশ','আঠাশ','ঊনত্রিশ',
 'ত্রিশ','একত্রিশ','বত্রিশ','তেত্রিশ','চৌত্রিশ','পঁয়ত্রিশ','ছত্রিশ','সাঁইত্রিশ','আটত্রিশ','ঊনচল্লিশ',
 'চল্লিশ','একচল্লিশ','বিয়াল্লিশ','তেতাল্লিশ','চুয়াল্লিশ','পঁয়তাল্লিশ','ছেচল্লিশ','সাতচল্লিশ','আটচল্লিশ','ঊনপঞ্চাশ',
 'পঞ্চাশ','একান্ন','বাহান্ন','তিপ্পান্ন','চুয়ান্ন','পঞ্চান্ন','ছাপ্পান্ন','সাতান্ন','আটান্ন','ঊনষাট',
 'ষাট','একষট্টি','বাষট্টি','তেষট্টি','চৌষট্টি','পঁয়ষট্টি','ছেষট্টি','সাতষট্টি','আটষট্টি','ঊনসত্তর',
 'সত্তর','একাত্তর','বাহাত্তর','তিয়াত্তর','চুয়াত্তর','পঁচাত্তর','ছিয়াত্তর','সাতাত্তর','ঊনআশি',
 'আশি','একাশি','বিরাশি','তিরাশি','চুরাশি','পঁচাশি','ছিয়াশি','সাতাশি','আটাশি','ঊননব্বই',
 'নব্বই','একানব্বই','বিরানব্বই','তিরানব্বই','চুরানব্বই','পঁচানব্বই','ছিয়ানব্বই','সাতানব্বই','আটানব্বই','নিরানব্বই'
];
function partyUnderThousand(value){
  if(value<100)return PARTY_BN_WORDS[value];
  const hundreds=Math.floor(value/100),rest=value%100;
  return PARTY_BN_WORDS[hundreds]+'শত'+(rest?' '+PARTY_BN_WORDS[rest]:'');
}
function partyPositiveWords(value){
  if(value===0)return PARTY_BN_WORDS[0];
  const parts=[];
  for(const [unit,label] of [[10000000,'কোটি'],[100000,'লক্ষ'],[1000,'হাজার']]){
    if(value>=unit){
      const count=Math.floor(value/unit);
      parts.push((count<1000?partyUnderThousand(count):partyPositiveWords(count))+' '+label);
      value%=unit;
    }
  }
  if(value)parts.push(partyUnderThousand(value));
  return parts.join(' ');
}
export function amountInWordsBn(value){
  if(!Number.isFinite(value))return '';
  const paisa=Math.round(Math.abs(value)*100);
  if(!Number.isSafeInteger(paisa))return '';
  const taka=Math.floor(paisa/100),remainder=paisa%100;
  return (value<0&&paisa>0?'ঋণাত্মক ':'')+
    partyPositiveWords(taka)+' টাকা'+
    (remainder?' '+partyPositiveWords(remainder)+' পয়সা':'')+' মাত্র';
}

const create=(tag,className,textValue)=>{
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(textValue!==undefined)node.textContent=textValue;
  return node;
};
const asButton=(label,className='hds-button')=>{
  const b=create('button',className,label);b.type='button';return b;
};
const labelFor=role=>role+' · '+BENGALI[role];
const moneyOrUnknown=account=>account?{
  receivable:formatMoneyPaisa(account.receivablePaisa),
  payable:formatMoneyPaisa(account.payablePaisa)
}:null;
function currencyCsv(value) {
  return String(value).replace(/^[=+@-]/,"'$&").replace(/"/g,'""');
}
function saveStatementCsv(party,ledger){
  if(!ledger?.complete)throw new Error('Complete source statement unavailable');
  const columns=['Date','Source','Reference','Increase (BDT)','Decrease (BDT)','Balance (BDT)'];
  const data=ledger.entries.map(r=>[
    r.date,r.kind,r.reference,(r.debitPaisa/100).toFixed(2),
    (r.creditPaisa/100).toFixed(2),(r.balancePaisa/100).toFixed(2)
  ]);
  const csv='\ufeff'+[columns,...data].map(row=>row.map(v=>'"'+currencyCsv(v)+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;
  a.download='Supplier-'+ledger.sourceId+'-ledger.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
function makeRoleChip(role,active,callback){
  const button=asButton(role==='All'?'All · সব':labelFor(role),'hparty-role-chip');
  button.setAttribute('aria-pressed',String(active));
  button.addEventListener('click',callback);
  return button;
}
function setContent(node,message){
  node.replaceChildren(create('p','hparty-message',message));
}

/** Instantiate the owner-authenticated Party screen only when mounted under /app. */
export function mountOwnerParties(){
  const page=document.getElementById('page-hisabiqParties');
  const root=document.getElementById('hisabiq-party-root');
  if(!page||!root||root.dataset.initialized==='true')return;
  root.dataset.initialized='true';
  root.innerHTML=`
    <div class="hparty-head">
      <div><h1>Parties &amp; Ledger <span lang="bn">পার্টি ও খাতা</span></h1>
        <p id="hparty-summary" role="status">Role-specific accounts · সম্পর্কভিত্তিক হিসাব</p></div>
      <div class="hparty-head-actions">
        <button type="button" class="hds-button" id="hparty-refresh">Refresh · নতুন করে দেখুন</button>
        <button type="button" class="hds-button" id="hparty-add-party" disabled title="The reviewed Party writer is not connected">+ Add Party</button>
        <button type="button" class="hds-button" id="hparty-change">Change Party</button>
      </div>
    </div>
    <p class="hparty-connection" id="hparty-source-mode" role="status"></p>
    <div class="hparty-layout">
      <aside class="hparty-directory hds-surface" aria-label="Party directory">
        <div class="hparty-directory-top">
          <label for="hparty-search" class="hparty-sr-only">Search name or phone</label>
          <input class="hds-input" id="hparty-search" type="search" autocomplete="off" placeholder="Search name or phone… · নাম বা ফোন"/>
          <div class="hparty-role-filters" id="hparty-filters" aria-label="Filter by relationship" role="group"></div>
        </div>
        <p class="hparty-directory-caption" id="hparty-count" aria-live="polite"></p>
        <ul class="hparty-list" id="hparty-list" role="listbox" aria-label="Parties"></ul>
      </aside>
      <div class="hparty-detail hds-surface" id="hparty-detail" aria-live="polite">
        <div class="hparty-empty">Choose a Party · পার্টি বাছাই করুন</div>
      </div>
    </div>
    <div class="hparty-picker" id="hparty-picker" hidden data-open="false">
      <button type="button" class="hparty-picker-backdrop" aria-label="Close Party picker"></button>
      <section class="hparty-picker-panel" role="dialog" aria-modal="true" aria-labelledby="hparty-picker-title">
        <div class="hparty-picker-header"><strong id="hparty-picker-title">Choose Party · পার্টি বাছুন</strong>
          <button class="hds-button" type="button" id="hparty-picker-close" aria-label="Close">×</button></div>
        <label for="hparty-picker-search" class="hparty-sr-only">Search Party</label>
        <input class="hds-input" id="hparty-picker-search" type="search" placeholder="Name or phone · নাম বা ফোন"/>
        <div class="hparty-role-filters" id="hparty-picker-filters" role="group" aria-label="Picker relationship"></div>
        <ul class="hparty-list" id="hparty-picker-list" role="listbox" aria-label="Choose Party"></ul>
      </section>
    </div>
    <div class="hparty-supplier-modal" id="hparty-supplier-modal" hidden data-open="false">
      <button type="button" class="hparty-supplier-backdrop" aria-label="Close Add Party"></button>
      <section class="hparty-supplier-panel" role="dialog" aria-modal="true" aria-labelledby="hparty-supplier-title">
        <header class="hparty-supplier-head">
          <div><h2 id="hparty-supplier-title">Add party <span lang="bn">পার্টি তথ্য</span></h2>
            <p>One person can be a customer, supplier or hold multiple roles. Only the verified Supplier writer is connected.</p></div>
          <button type="button" class="hds-button" id="hparty-supplier-close" aria-label="Close Add Party">×</button>
        </header>
        <form id="hparty-supplier-form">
          <div class="hparty-editor-fields">
            <div><label for="hparty-supplier-name">Party name *</label>
              <input class="hds-input" id="hparty-supplier-name" name="name" required maxlength="120" autocomplete="organization"/></div>
            <div><label for="hparty-supplier-name-bn">Bangla name</label>
              <input class="hds-input" id="hparty-supplier-name-bn" name="nameBn" maxlength="120" lang="bn" autocomplete="off"/></div>
            <div><label for="hparty-supplier-phone">Phone</label>
              <input class="hds-input" id="hparty-supplier-phone" name="phone" maxlength="40" type="tel" autocomplete="tel"/></div>
            <div><label for="hparty-supplier-address">Area / address</label>
              <input class="hds-input" id="hparty-supplier-address" name="address" maxlength="250" autocomplete="street-address"/></div>
          </div>
          <fieldset class="hparty-editor-relationships">
            <legend>Relationships <span lang="bn">সম্পর্ক নির্ধারণ</span></legend>
            <div class="hparty-editor-role-grid" id="hparty-editor-role-grid">
              ${ROLES.map(role=>`<label class="hparty-editor-role"><input type="checkbox" name="hparty-role" value="${role}" ${role==='Customer'?'checked':''}/> <span>${role}</span></label>`).join('')}
            </div>
            <input type="hidden" id="hparty-add-relationship" value="Customer"/>
            <p id="hparty-relationship-status" role="status" hidden></p>
          </fieldset>
          <details class="hparty-editor-openings" id="hparty-editor-openings" open>
            <summary>Opening balances (optional) <span lang="bn">প্রারম্ভিক জের</span></summary>
            <p>Each relationship has its own opening balance. This is not cash received or paid. Enter 0 to clear an existing balance.</p>
            <div class="hparty-opening-card">
              <strong id="hparty-opening-role">Customer</strong>
              <div class="hparty-editor-fields">
                <div><label for="hparty-opening-amount">Opening amount (৳)</label>
                  <input class="hds-input" id="hparty-opening-amount" inputmode="decimal" type="text" placeholder="No opening balance" value="0"/></div>
                <div><label for="hparty-opening-side">Direction</label>
                  <select class="hds-select" id="hparty-opening-side" data-touch-select-skip="true">
                    <option value="debit">They owe us · আমাদের পাওনা</option>
                    <option value="credit">We owe them · আমাদের দেনা</option>
                  </select></div>
                <div><label for="hparty-opening-date">Opening date</label>
                  <input class="hds-input" id="hparty-opening-date" type="date"/></div>
              </div>
              <p class="hparty-opening-rule" id="hparty-add-opening-rule">Nonzero opening balances require the reviewed historical D1 ledger writer; they cannot be saved here.</p>
            </div>
            <div id="hparty-other-opening-cards"></div>
          </details>
          <details class="hparty-editor-other">
            <summary>Other details · অন্যান্য</summary>
            <label for="hparty-supplier-notes">Notes <span lang="bn">নোট</span></label>
            <textarea class="hds-input" id="hparty-supplier-notes" name="notes" maxlength="500" rows="2"></textarea>
          </details>
          <p id="hparty-supplier-status" role="alert" aria-live="assertive"></p>
          <footer>
            <button class="hds-button" id="hparty-supplier-cancel" type="button" data-variant="outline">Cancel</button>
            <button class="hds-button" id="hparty-supplier-save" type="submit">Save party</button>
          </footer>
        </form>
      </section>
    </div>
    <div class="hparty-source-preview" id="hparty-source-preview" hidden>
      <button type="button" class="hparty-modal-veil" data-close-preview aria-label="Close source preview"></button>
      <section class="hparty-reference-panel" role="dialog" aria-modal="true" aria-labelledby="hparty-source-preview-title">
        <header><div><h2 id="hparty-source-preview-title">Sales invoice preview</h2><p>Read-only details from the available source record.</p></div>
        <button class="hds-button" type="button" data-close-preview aria-label="Close source preview">×</button></header>
        <div id="hparty-source-preview-body"></div>
        <footer><button class="hds-button" type="button" data-close-preview>Close</button></footer>
      </section>
    </div>
    <div class="hparty-payment-modal" id="hparty-payment-modal" hidden>
      <button type="button" class="hparty-modal-veil" data-close-payment aria-label="Close payment preview"></button>
      <section class="hparty-reference-panel" role="dialog" aria-modal="true" aria-labelledby="hparty-payment-title">
        <header><div><h2 id="hparty-payment-title">Receive payment <span lang="bn">পেমেন্ট</span></h2>
          <p>Record a verified split payment in this browser preview. No bank transfer or real accounting posting occurs.</p></div>
          <button class="hds-button" type="button" data-close-payment aria-label="Close payment preview">×</button></header>
        <div class="hparty-payment-person" id="hparty-payment-person"></div>
        <div class="hparty-editor-fields hparty-payment-fields">
          <div><label for="hparty-payment-date">Payment date</label><input class="hds-input" id="hparty-payment-date" type="date"/></div>
          <div><label for="hparty-payment-amount">Amount received/paid</label><div class="hparty-inline-field">
            <input class="hds-input" id="hparty-payment-amount" inputmode="decimal" type="text" placeholder="0.00"/>
            <button class="hds-button" id="hparty-payment-full" type="button">Full</button></div></div>
          <div><label for="hparty-payment-discount">Discount / adjustment</label>
            <input class="hds-input" id="hparty-payment-discount" type="text" inputmode="decimal" value="0"/></div>
          <div><label for="hparty-allocation">Invoice / bill allocation</label>
            <select class="hds-select" id="hparty-allocation" data-touch-select-skip="true">
              <option value="">Auto-allocate (oldest outstanding)</option>
            </select></div>
        </div>
        <section class="hparty-payment-sources" aria-label="Payment sources">
          <header><div><strong>Payment sources</strong><small lang="bn">ক্যাশ + ব্যাংক + মোবাইল ব্যাংকিং একসঙ্গে ব্যবহার করা যাবে</small></div>
            <button type="button" class="hds-button" id="hparty-payment-add">＋ Add</button></header>
          <div id="hparty-payment-rows"></div>
          <div class="hparty-split-summary"><span>Split total</span><strong id="hparty-split-total">৳0</strong></div>
        </section>
        <div class="hparty-amount-words"><small>In words · কথায়</small><strong id="hparty-amount-words">শূন্য টাকা মাত্র</strong></div>
        <p class="hparty-payment-unavailable" role="status">No bank transfer or real accounting posting occurs. The current Shop has not enabled verified split payment or invoice allocation.</p>
        <footer><button class="hds-button" type="button" data-close-payment>Cancel</button>
          <button class="hds-button" type="button" disabled title="Verified multi-source payment writer is not connected">Review payment</button></footer>
      </section>
    </div>
  `;
  const pick=sel=>root.querySelector(sel);
  const state={items:[],selectionId:null,roleFilter:'All',query:'',relationship:null,
    tab:'Ledger',ledger:null,loading:false,error:'',ledgerError:'',mode:'',request:null,
    ledgerQuery:'',ledgerType:'All transactions',ledgerDate:'All dates',
    ledgerPageSize:25,ledgerPage:1,
    ledgerRequest:null,opener:null,closeTimer:null};
  const search=pick('#hparty-search'),pickerSearch=pick('#hparty-picker-search');
  const header=pick('#hparty-summary'),banner=pick('#hparty-source-mode');
  const detail=pick('#hparty-detail'),picker=pick('#hparty-picker');
  const supplierModal=pick('#hparty-supplier-modal');
  const supplierForm=pick('#hparty-supplier-form');
  const supplierStatus=pick('#hparty-supplier-status');
  const relationship=pick('#hparty-add-relationship');
  const relationshipStatus=pick('#hparty-relationship-status');
  const roleInputs=()=>Array.from(root.querySelectorAll('#hparty-editor-role-grid input[name="hparty-role"]'));
  function syncAddRelationship(){
    const roles=roleInputs().filter(input=>input.checked).map(input=>input.value);
    relationship.value=roles.length===1?roles[0]:'';
    const opening=pick('#hparty-opening-amount').value.trim();
    const amountValid=!opening||/^(?:0|0\.0{1,2})$/.test(opening);
    const banglaUnsupported=Boolean(pick('#hparty-supplier-name-bn').value.trim());
    const available=state.mode==='supplier-source'&&roles.length===1&&
      roles[0]==='Supplier'&&amountValid&&!banglaUnsupported;
    pick('#hparty-opening-role').textContent=roles.length===1?roles[0]:
      roles.length?roles.join(' + '):'Choose a relationship';
    const otherRoles=pick('#hparty-other-opening-cards');
    otherRoles.replaceChildren();
    if(roles.length>1){
      for(const role of roles.filter(r=>r!==roles[0])){
        const card=create('div','hparty-opening-card hparty-extra-opening');
        card.append(create('strong','',role));
        card.append(create('p','', 'Independent opening balance for '+role+' is not connected to Shop D1.'));
        otherRoles.append(card);
      }
    }
    const reasons=[];
    if(roles.length!==1||roles[0]!=='Supplier')
      reasons.push('Only a single Supplier can currently be saved to verified Shop D1.');
    if(!amountValid)
      reasons.push('Nonzero historical opening balances cannot be posted through this editor.');
    if(banglaUnsupported)
      reasons.push('Bangla name storage is not connected to the Supplier writer; clear the Bangla name before saving.');
    relationshipStatus.hidden=!reasons.length;
    relationshipStatus.textContent=reasons.join(' ');
    pick('#hparty-add-opening-rule').hidden=false;
    pick('#hparty-supplier-save').disabled=!available||supplierSaving;
    for(const box of roleInputs())box.disabled=supplierSaving;
  }
  for(const input of roleInputs())input.addEventListener('change',()=>{
    if(input.checked)pick('#hparty-opening-side').value=input.value==='Supplier'?'credit':'debit';
    syncAddRelationship();
  });
  for(const selector of ['#hparty-opening-amount','#hparty-supplier-name-bn'])
    pick(selector).addEventListener('input',syncAddRelationship);
  const openingDate=pick('#hparty-opening-date');
  openingDate.value=new Date().toLocaleDateString('en-CA');
  relationship.addEventListener('change',syncAddRelationship);
  let supplierIntent=null,supplierSaving=false,supplierOpener=null,supplierCloseTimer=null;
  const getSelected=()=>state.items.find(p=>p.id===state.selectionId)||null;
  let modalOpener=null;
  const paymentModal=pick('#hparty-payment-modal');
  const previewModal=pick('#hparty-source-preview');
  const closeReferenceModal=(modal)=>{
    if(modal.hidden)return;
    modal.hidden=true;
    if(modalOpener?.isConnected)modalOpener.focus({preventScroll:true});
    modalOpener=null;
  };
  function openSourcePreview(row){
    if(!row||!state.ledger)return;
    modalOpener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const body=pick('#hparty-source-preview-body');
    body.replaceChildren();
    pick('#hparty-source-preview-title').textContent=
      (row.kind==='Purchase'?'Purchase':'Source')+' document preview';
    const reference=create('div','hparty-preview-reference',row.reference);
    const status=create('span','hparty-preview-label','Read-only · '+row.kind);
    body.append(status,reference);
    const metrics=create('div','hparty-preview-metrics');
    for(const [label,value] of [
      ['Date',row.date],
      ['Debit',formatMoneyPaisa(row.debitPaisa)],
      ['Credit',formatMoneyPaisa(row.creditPaisa)],
      ['Running',formatMoneyPaisa(row.balancePaisa)]
    ]){
      const cell=create('div');
      cell.append(create('small','',label),create('strong','',value));
      metrics.append(cell);
    }
    body.append(metrics,create('p','hparty-preview-warning',
      'The original ledger is read-only. Item details, editing, printing and reversal require a separately verified source endpoint.'));
    previewModal.hidden=false;
    previewModal.querySelector('[data-close-preview]:not(.hparty-modal-veil)').focus();
  }
  function currentDuePaisa(){
    const party=getSelected();
    const accounts=party?.gross?.[state.relationship];
    return Math.max(0,state.relationship==='Customer'
      ?(accounts?.receivablePaisa||0):(accounts?.payablePaisa||0));
  }
  function addPaymentSource(){
    const list=pick('#hparty-payment-rows');
    const row=create('div','hparty-payment-row');
    const method=create('select','hds-select');
    method.dataset.touchSelectSkip='true';
    method.setAttribute('aria-label','Payment source');
    for(const kind of ['Cash','Bank','Mobile banking']){
      const opt=create('option','',kind);opt.value=kind;method.append(opt);
    }
    const account=create('select','hds-select');
    account.dataset.touchSelectSkip='true';
    account.setAttribute('aria-label','Payment account');
    const option=create('option','','Main Cash Counter · preview only');
    option.value='preview';account.append(option);
    const amount=create('input','hds-input');amount.type='text';
    amount.inputMode='decimal';amount.placeholder='0';amount.value='0';
    amount.setAttribute('aria-label','Source amount');
    amount.addEventListener('input',updatePaymentPreview);
    const remove=asButton('×','hds-button');remove.type='button';
    remove.setAttribute('aria-label','Remove payment source');
    remove.addEventListener('click',()=>{row.remove();updatePaymentPreview();});
    row.append(method,account,amount,remove);
    list.append(row);
    updatePaymentPreview();
  }
  function updatePaymentPreview(){
    const items=Array.from(pick('#hparty-payment-rows').querySelectorAll('input'));
    let total=0;
    for(const input of items){
      const number=Number(input.value.trim());
      if(!Number.isFinite(number)||number<0||!/^\d*(?:\.\d{0,2})?$/.test(input.value.trim())){
        pick('#hparty-split-total').textContent='Invalid amount';
        pick('#hparty-amount-words').textContent='টাকার পরিমাণ ঠিক করুন';
        return;
      }
      total+=number;
    }
    pick('#hparty-split-total').textContent='৳'+total.toLocaleString('en-BD',{maximumFractionDigits:2});
    pick('#hparty-amount-words').textContent=amountInWordsBn(total);
  }
  function openPaymentPreview(){
    const party=getSelected();
    if(!party)return;
    modalOpener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const accounts=party.gross[state.relationship];
    const amount=currentDuePaisa();
    pick('#hparty-payment-title').textContent=(state.relationship==='Supplier'?'Pay supplier':'Receive payment')+' · পেমেন্ট';
    const person=pick('#hparty-payment-person');
    person.replaceChildren();
    const info=create('div');
    info.append(create('small','',state.relationship+' · '+(party.phone||'No phone')),
      create('strong','',party.name));
    const due=create('div');
    due.append(create('small','',state.relationship==='Supplier'?'Outstanding supplier payable':'Outstanding customer due'),
      create('strong','',accounts?formatMoneyPaisa(amount):'Not connected'));
    person.append(info,due);
    const allocation=pick('#hparty-allocation');
    allocation.replaceChildren(new Option('Auto-allocate (oldest outstanding)',''));
    // Never invent a source invoice ID. Supplier Purchase references only,
    // and no Customer invoice allocation until an authenticated reader exists.
    for(const row of state.relationship==='Supplier'?(state.ledger?.entries||[]):[]){
      if(row.kind==='Purchase'&&row.debitPaisa>0)
        allocation.add(new Option(row.reference+' · '+formatMoneyPaisa(row.debitPaisa),row.reference));
    }
    const date=new Date();
    pick('#hparty-payment-date').value=date.toISOString().slice(0,10);
    pick('#hparty-payment-amount').value='';
    pick('#hparty-payment-discount').value='0';
    pick('#hparty-payment-rows').replaceChildren();
    addPaymentSource();
    paymentModal.hidden=false;
    pick('#hparty-payment-amount').focus();
  }
  pick('#hparty-payment-add').addEventListener('click',addPaymentSource);
  pick('#hparty-payment-full').addEventListener('click',()=>{
    pick('#hparty-payment-amount').value=(currentDuePaisa()/100).toFixed(2);
    const first=pick('#hparty-payment-rows input');
    if(first)first.value=pick('#hparty-payment-amount').value;
    updatePaymentPreview();
  });
  for(const modal of [paymentModal,previewModal]){
    const type=modal===paymentModal?'payment':'preview';
    modal.querySelectorAll('[data-close-'+type+']').forEach(button=>
      button.addEventListener('click',()=>closeReferenceModal(modal)));
    modal.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();closeReferenceModal(modal);}
      if(event.key!=='Tab')return;
      const focus=Array.from(modal.querySelectorAll(
        'button:not([disabled]),input:not([disabled]),select:not([disabled])'
      )).filter(el=>el.getClientRects().length);
      if(event.shiftKey&&document.activeElement===focus[0]){
        event.preventDefault();focus.at(-1)?.focus();
      }else if(!event.shiftKey&&document.activeElement===focus.at(-1)){
        event.preventDefault();focus[0]?.focus();
      }
    });
  }
  const isVisible=()=>!page.hidden;
  const updateUrl=()=>{
    const p=getSelected();
    const url=new URL(location.href);
    if(p?.partyId)url.searchParams.set('id',p.partyId);
    else url.searchParams.delete('id');
    if(p?.partyId&&state.relationship)url.searchParams.set('role',state.relationship);
    else url.searchParams.delete('role');
    history.replaceState(history.state,'',url.pathname+url.search+url.hash);
  };
  const applyMode=()=>{
    const dark=document.documentElement.classList.contains('dark')||
      document.body.classList.contains('dark')||matchMedia('(prefers-color-scheme: dark)').matches;
    page.dataset.theme=dark?'dark':'light';
  };
  const setActiveTab=tab=>{
    state.tab=tab;
    detail.querySelectorAll('.hparty-tab').forEach(b=>{
      b.setAttribute('aria-selected',String(b.dataset.tab===tab));
      b.tabIndex=b.dataset.tab===tab?0:-1;
    });
    const area=detail.querySelector('#hparty-tab-content');
    if(area)renderTab(area);
    const bar=detail.querySelector('.hparty-tabs');
    const current=bar?.querySelector('[aria-selected="true"]');
    const underline=bar?.querySelector('.hparty-tab-underline');
    if(current&&underline) {
      underline.style.width=current.offsetWidth+'px';
      underline.style.transform='translateX('+current.offsetLeft+'px)';
    }
  };
  function renderTab(area) {
    area.replaceChildren();
    const p=getSelected();
    if(!p)return;
    if(state.tab==='Notes'||state.tab==='Attachments'){
      setContent(area,state.tab+' are not connected to this Shop yet. No preview data is shown.');
      return;
    }
    if(!state.relationship||state.relationship!=='Supplier'||!p.sourceIds.Supplier){
      setContent(area,'This relationship ledger is not connected to the authenticated Shop service yet.');
      return;
    }
    if(state.ledgerError) {setContent(area,state.ledgerError);return;}
    if(state.loading && !state.ledger) {setContent(area,'Loading verified Supplier ledger…');return;}
    if(!state.ledger) {setContent(area,'Select a Supplier to load its actual D1 ledger.');return;}
    const ledger=state.ledger;
    const typeAllowed={
      'All transactions':null,'Purchases':'Purchase',
      'Payments':'Supplier Payment','Historical opening':'Historical Opening'
    };
    const now=Date.now();
    const rangeDays=state.ledgerDate==='Last 30 days'?30:
      state.ledgerDate==='Last 90 days'?90:null;
    const query=state.ledgerQuery.trim().toLowerCase();
    const rows=ledger.entries.filter(row=>
      (state.tab==='Ledger'||
        (state.tab==='Bills'&&row.kind==='Purchase')||
        (state.tab==='Payments'&&row.kind==='Supplier Payment'))&&
      (!typeAllowed[state.ledgerType]||row.kind===typeAllowed[state.ledgerType])&&
      (!query||[row.reference,row.kind,row.date].some(v=>String(v).toLowerCase().includes(query)))&&
      (!rangeDays||(Date.parse(row.date+'T00:00:00Z')>=now-rangeDays*86400000))
    );
    const toolbar=create('div','hparty-ledger-toolbar');
    const search=create('input','hds-input');
    search.id='hparty-ledger-query';search.type='search';search.autocomplete='off';
    search.placeholder='Search reference or note';search.setAttribute('aria-label','Search ledger references');
    search.value=state.ledgerQuery;
    search.addEventListener('input',()=>{
      const pos=search.selectionStart||0;
      state.ledgerQuery=search.value;state.ledgerPage=1;
      renderTab(area);
      const next=detail.querySelector('#hparty-ledger-query');
      next?.focus();next?.setSelectionRange(pos,pos);
    });
    const date=create('select','hds-select');date.id='hparty-ledger-date';
    date.dataset.touchSelectSkip='true';date.setAttribute('aria-label','Ledger date range');
    for(const value of ['All dates','Last 30 days','Last 90 days']){
      const o=create('option','',value);o.value=value;date.append(o);
    }
    date.value=state.ledgerDate;
    date.addEventListener('change',()=>{state.ledgerDate=date.value;state.ledgerPage=1;renderTab(area);});
    const type=create('select','hds-select');type.id='hparty-ledger-type';
    type.dataset.touchSelectSkip='true';type.setAttribute('aria-label','Ledger transaction type');
    for(const value of Object.keys(typeAllowed)){
      const o=create('option','',value);o.value=value;type.append(o);
    }
    type.value=state.ledgerType;
    type.addEventListener('change',()=>{state.ledgerType=type.value;state.ledgerPage=1;renderTab(area);});
    const reset=asButton('↻','hds-button');reset.setAttribute('aria-label','Reset ledger filters');
    reset.addEventListener('click',()=>{
      state.ledgerQuery='';state.ledgerDate='All dates';state.ledgerType='All transactions';
      state.ledgerPage=1;renderTab(area);
    });
    const size=create('select','hds-select');size.id='hparty-ledger-page-size';
    size.dataset.touchSelectSkip='true';size.setAttribute('aria-label','Ledger page size');
    for(const n of [25,50]){const o=create('option','',String(n));o.value=String(n);size.append(o);}
    size.value=String(state.ledgerPageSize);
    size.addEventListener('change',()=>{state.ledgerPageSize=Number(size.value);state.ledgerPage=1;renderTab(area);});
    const print=asButton('▣ Print statement','hds-button');
    print.dataset.variant='outline';
    print.disabled=!ledger.complete;
    print.title=ledger.complete?'Print verified complete Supplier statement':'Full source history required before print';
    print.addEventListener('click',()=>window.print());
    toolbar.append(search,date,type,reset,size,print);
    area.append(toolbar);
    if(!ledger.complete)area.append(create('p','hparty-warning',
      'Latest 50 entries only. Full history, opening and complete statement are not available for export/print.'));
    const sum=rows.reduce((total,row)=>({
      debit:total.debit+row.debitPaisa,credit:total.credit+row.creditPaisa
    }),{debit:0,credit:0});
    const summary=create('div','hparty-ledger-summary');
    const party=getSelected();
    const opening=party?.supplierOpening?.payablePaisa||0;
    const balance=party?.gross?.Supplier?.payablePaisa||0;
    summary.append(create('span','','Opening balance '+formatMoneyPaisa(opening)),
      create('span','','Period debit '+formatMoneyPaisa(sum.debit)),
      create('span','','Period credit '+formatMoneyPaisa(sum.credit)));
    area.append(summary);
    const totalPages=Math.max(1,Math.ceil(rows.length/state.ledgerPageSize));
    state.ledgerPage=Math.min(Math.max(1,state.ledgerPage),totalPages);
    const shown=rows.slice((state.ledgerPage-1)*state.ledgerPageSize,
      state.ledgerPage*state.ledgerPageSize);
    const wrapper=create('div','hparty-table-wrap');
    const table=create('table','hds-table hparty-table');
    table.innerHTML='<thead><tr><th>Date</th><th>Particulars</th><th data-numeric>Debit · ডেবিট</th><th data-numeric>Credit · ক্রেডিট</th><th data-numeric>Running</th><th>Actions</th></tr></thead>';
    const tbody=create('tbody');
    for(const row of shown){
      const tr=create('tr');
      const particulars=create('td','');
      particulars.dataset.label='Particulars';
      const kind=create('span','hparty-ledger-kind',row.kind);
      kind.dataset.kind=row.kind;
      particulars.append(kind,create('strong','',row.reference));
      const dateCell=create('td','',row.date);dateCell.dataset.label='Date';
      const debit=create('td','',row.debitPaisa?formatMoneyPaisa(row.debitPaisa):'—');
      debit.dataset.label='Debit';debit.dataset.numeric='';
      const credit=create('td','',row.creditPaisa?formatMoneyPaisa(row.creditPaisa):'—');
      credit.dataset.label='Credit';credit.dataset.numeric='';
      const running=create('td','',formatMoneyPaisa(row.balancePaisa));
      running.dataset.label='Running';running.dataset.numeric='';
      const actions=create('td','');actions.dataset.label='Actions';
      const menu=create('div','hparty-row-actions');
      const trigger=asButton('⋮','hds-button hparty-row-trigger');
      trigger.setAttribute('aria-label','Actions for '+row.reference);
      trigger.setAttribute('aria-expanded','false');
      const items=create('div','hparty-row-action-menu');items.hidden=true;
      const view=asButton('◉ View','hds-button');
      view.addEventListener('click',()=>{items.hidden=true;trigger.setAttribute('aria-expanded','false');openSourcePreview(row);});
      items.append(view);
      for(const text of ['Edit','Print','Delete / reverse']){
        const button=asButton(text,'hds-button');button.disabled=true;
        button.title='This source action is not connected in the current Shop release';
        items.append(button);
      }
      trigger.addEventListener('click',()=>{
        items.hidden=!items.hidden;
        trigger.setAttribute('aria-expanded',String(!items.hidden));
        if(!items.hidden)view.focus();
      });
      menu.addEventListener('keydown',event=>{
        if(event.key==='Escape'){items.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus();}
      });
      menu.append(trigger,items);actions.append(menu);
      tr.append(dateCell,particulars,debit,credit,running,actions);
      tbody.append(tr);
    }
    table.append(tbody);wrapper.append(table);area.append(wrapper);
    if(!rows.length)area.append(create('p','hparty-message','No verified source rows found · কোনো লেনদেন নেই'));
    const closing=create('div','hparty-ledger-closing');
    closing.append(create('strong','','Closing balance'),create('strong','',formatMoneyPaisa(balance)+' Payable'));
    area.append(closing);
    const pager=create('div','hparty-ledger-pager');
    pager.append(create('span','', 'Page '+state.ledgerPage+' of '+totalPages+' · '+rows.length+' dated transactions'));
    const prev=asButton('Previous','hds-button');prev.disabled=state.ledgerPage===1;
    prev.addEventListener('click',()=>{state.ledgerPage--;renderTab(area);});
    const next=asButton('Next','hds-button');next.disabled=state.ledgerPage===totalPages;
    next.addEventListener('click',()=>{state.ledgerPage++;renderTab(area);});
    const buttons=create('div');buttons.append(prev,next);pager.append(buttons);
    area.append(pager);
  }
  function renderDetail() {
    const p=getSelected();
    state.ledger=null;state.ledgerError='';
    detail.replaceChildren();
    if(!p) {setContent(detail,state.error||'Choose a Party · পার্টি বাছাই করুন');return;}
    const head=create('header','hparty-profile');
    const avatar=create('div','hparty-avatar',p.name.slice(0,1).toUpperCase());
    avatar.setAttribute('aria-hidden','true');
    const info=create('div','hparty-profile-info');
    info.append(create('h2','',p.name));
    if(p.nameBn)info.append(create('p','hparty-bn',p.nameBn));
    const sub=create('p','hparty-meta',([p.phone,p.address].filter(Boolean).join(' · '))||'No phone or address');
    info.append(sub);
    const badges=create('div','hparty-profile-roles');
    p.roles.forEach(role=>{const b=create('span','hparty-badge',labelFor(role));b.dataset.role=role;badges.append(b);});
    info.append(badges);
    const finances=create('div','hparty-account-balance');
    const roleAccount=p.gross[state.relationship]||null;
    if(roleAccount){
      const positions=[
        ['Receivable',roleAccount.receivablePaisa],
        ['Payable',roleAccount.payablePaisa]
      ].filter(([,value])=>value>0);
      if(!positions.length)positions.push([state.relationship==='Supplier'?'Payable':'Receivable',0]);
      for(const [kind,value] of positions) {
        const card=create('div','hparty-balance-card');
        card.dataset.kind=kind;
        card.append(create('small','',state.relationship+' '+kind.toLowerCase()),
          create('strong','',formatMoneyPaisa(value)),
          create('small','hparty-balance-subtitle',kind==='Receivable'?'They owe you · ক্রেতার কাছে পাওনা':'You owe them · আপনার দেনা'));
        if(kind==='Receivable'&&state.relationship==='Supplier'&&
           p.supplierOpening?.advancePaisa>0)
          card.append(create('small','hparty-balance-note',
            'Supplier advance '+formatMoneyPaisa(p.supplierOpening.advancePaisa)+
            ' · সাপ্লায়ার অগ্রিম'));
        finances.append(card);
      }
    }else if(state.relationship==='Payee'){
      finances.append(create('span','hparty-message','Payee is an identity, not an automatic debt.'));
    }else{
      finances.append(create('span','hparty-message','Account amount not yet connected. No estimated balance.'));
    }
    head.append(avatar,info,finances);
    detail.append(head);
    const top=create('div','hparty-detail-actions hparty-action-bar');
    const actionGroup=create('div','hparty-primary-actions');
    const receive=asButton(state.relationship==='Supplier'?'Pay supplier':'Receive payment','hds-button hparty-action-main');
    receive.id='hparty-action-receive';
    receive.disabled=!['Customer','Supplier'].includes(state.relationship);
    receive.title='Preview payment sources only; real posting is not connected';
    receive.addEventListener('click',openPaymentPreview);
    const refund=asButton('Refund credit','hds-button');
    refund.disabled=true;refund.title='Customer credit refund posting is not connected';
    const newInvoice=asButton('▣ New invoice','hds-button');
    newInvoice.disabled=true;newInvoice.title='Source-connected Party invoice creation is not enabled';
    const note=asButton('▢ Add note','hds-button');
    note.id='hparty-action-note';note.disabled=true;
    note.title='Notes are not yet persisted in Shop D1';
    const moreWrap=create('div','hparty-more-wrap');
    const more=asButton('⋯ More','hds-button');
    more.id='hparty-more';more.setAttribute('aria-expanded','false');
    const moreMenu=create('div','hparty-more-menu');moreMenu.hidden=true;
    if(p.sourceIds.Supplier){
      const jump=asButton('Open original Supplier ledger','hds-button');
      jump.addEventListener('click',()=>{
        moreMenu.hidden=true;
        if(typeof window.goToPage==='function')window.goToPage('suppliers');
      });
      moreMenu.append(jump);
    }
    if(p.roles.includes('Customer')){
      const legacy=asButton('Open original Customer module','hds-button');
      legacy.addEventListener('click',()=>{
        moreMenu.hidden=true;
        if(typeof window.goToPage==='function')window.goToPage('customers');
      });
      moreMenu.append(legacy);
    }
    const print=asButton('Print complete statement','hds-button');
    print.disabled=!state.ledger?.complete;
    print.title='Only a complete verified source statement may be printed';
    print.addEventListener('click',()=>window.print());
    moreMenu.append(print);
    more.addEventListener('click',()=>{
      moreMenu.hidden=!moreMenu.hidden;
      more.setAttribute('aria-expanded',String(!moreMenu.hidden));
    });
    moreWrap.addEventListener('keydown',event=>{
      if(event.key==='Escape'){moreMenu.hidden=true;more.setAttribute('aria-expanded','false');more.focus();}
    });
    moreWrap.append(more,moreMenu);
    actionGroup.append(receive,refund,newInvoice,note,moreWrap);
    top.append(actionGroup);
    if(p.roles.length>1){
      const label=create('label','hparty-role-choice','Relationship · সম্পর্ক');
      const select=create('select','hds-select');
      select.dataset.touchSelectSkip='true';
      select.setAttribute('aria-label','Selected Party relationship');
      for(const role of p.roles){const o=create('option','',labelFor(role));o.value=role;select.append(o);}
      select.value=state.relationship;
      select.addEventListener('change',()=>{
        state.relationship=select.value;state.tab='Ledger';updateUrl();renderDetail();void loadLedger();
      });
      label.append(select);top.append(label);
    }
    detail.append(top);
    const tabs=create('div','hparty-tabs');
    tabs.setAttribute('role','tablist');
    for(const name of ['Ledger','Bills','Payments','Notes','Attachments']){
      const b=asButton(name,'hparty-tab');b.setAttribute('role','tab');
      if(state.ledger&&['Ledger','Bills','Payments'].includes(name)){
        const count=state.ledger.entries.filter(row=>name==='Ledger'||
          (name==='Bills'&&row.kind==='Purchase')||
          (name==='Payments'&&row.kind==='Supplier Payment')).length;
        b.append(create('small','hparty-tab-count',String(count)));
      }
      b.dataset.tab=name;b.setAttribute('aria-selected',String(state.tab===name));
      b.addEventListener('click',()=>setActiveTab(name));
      b.addEventListener('keydown',event=>{
        const all=Array.from(tabs.querySelectorAll('[role="tab"]'));
        const index=all.indexOf(b);
        if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){
          event.preventDefault();
          const next=event.key==='Home'?0:event.key==='End'?all.length-1:
            (index+(event.key==='ArrowRight'?1:-1)+all.length)%all.length;
          all[next].focus();setActiveTab(all[next].dataset.tab);
        }
      });
      tabs.append(b);
    }
    tabs.append(create('span','hparty-tab-underline'));
    detail.append(tabs,create('div','hparty-tab-content'));
    detail.lastChild.id='hparty-tab-content';
    setActiveTab(state.tab);
  }
  function renderDirectory() {
    const matches=filterPartyDirectory(state.items,state.query,state.roleFilter);
    pick('#hparty-count').textContent=matches.length+' parties · পার্টি  · Balance by selected relationship';
    for(const el of [pick('#hparty-list'),pick('#hparty-picker-list')]){
      const focusId=el.querySelector('[aria-selected="true"]')?.dataset.id||null;
      el.replaceChildren();
      for(const p of matches) {
        const li=create('li');
        const button=asButton('','hparty-directory-row');
        button.dataset.id=p.id;
        button.setAttribute('role','option');
        button.setAttribute('aria-selected',String(state.selectionId===p.id));
        button.tabIndex=state.selectionId===p.id?0:-1;
        const initials=create('span','hparty-list-avatar',p.name.slice(0,1).toUpperCase());
        initials.setAttribute('aria-hidden','true');
        const content=create('span','hparty-directory-copy');
        content.append(create('strong','',p.name));
        const sub=create('small','',p.roles.map(r=>BENGALI[r]).join(' · ')+(p.phone?' · '+p.phone:''));
        content.append(sub);
        const balances=create('span','hparty-directory-money');
        if(p.roles.length>1){
          balances.append(create('strong','', 'Multiple ledgers'));
          balances.append(create('small','', 'Select relationship'));
        } else {
          const account=p.gross[p.roles[0]];
          if(account) {
            const owed=account.payablePaisa>0;
            balances.append(create('strong','',formatMoneyPaisa(
              owed?account.payablePaisa:account.receivablePaisa)));
            balances.append(create('small','',owed?'Payable · দেনা':
              account.receivablePaisa>0?'Receivable · পাওনা':'Settled'));
            if(owed&&account.receivablePaisa>0)
              balances.append(create('small','',
                'Receivable '+formatMoneyPaisa(account.receivablePaisa)+' · পাওনা'));
          }else balances.append(create('small','', 'Balance unavailable'));
        }
        button.append(initials,content,balances);
        button.addEventListener('click',()=>chooseParty(p.id));
        li.append(button);el.append(li);
      }
      if(!matches.length)el.append(create('li','hparty-no-results',state.error||'No matching parties · কোনো পার্টি নেই'));
      if(focusId){
        const same=Array.from(el.querySelectorAll('[role="option"]')).find(b=>b.dataset.id===focusId);
        if(same)same.tabIndex=0;
      }
    }
    for(const el of [pick('#hparty-filters'),pick('#hparty-picker-filters')]){
      el.replaceChildren();
      for(const role of ['All',...ROLES])el.append(makeRoleChip(role,state.roleFilter===role,()=>{
        state.roleFilter=role;renderDirectory();
      }));
    }
    search.value=state.query;pickerSearch.value=state.query;
    header.textContent='Parties '+state.items.length+' · '+(state.mode==='supplier-source'?
      'Supplier source only; Customer/Owner/Loan totals unavailable':
      'Independent role balances; no cross-role offset');
    const add=pick('#hparty-add-party');
    add.disabled=state.mode!=='supplier-source';
    add.title=state.mode==='supplier-source'
      ?'Create a clean-Shop Supplier with zero opening balance'
      :'The unified Party writer is not connected';
    banner.textContent=state.error||(
      state.mode==='supplier-source'
        ? 'Supplier-only D1 source view. Multi-role Party linking and Customer ledgers are not connected. Existing Supplier controls remain available.'
        : 'Unified Party identities from authenticated Shop D1. Source-ledger actions remain gated.');
  }
  function chooseParty(id) {
    const p=state.items.find(row=>row.id===id);
    if(!p)return;
    state.selectionId=id;
    state.relationship=p.roles.includes(state.roleFilter)?state.roleFilter:p.roles[0];
    state.tab='Ledger';
    renderDirectory();renderDetail();updateUrl();closePicker();void loadLedger();
  }
  function openPicker(){
    if(state.closeTimer)clearTimeout(state.closeTimer);
    state.opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    picker.hidden=false;
    requestAnimationFrame(()=>picker.dataset.open='true');
    pickerSearch.focus();
  }
  function closePicker(){
    if(picker.hidden)return;
    picker.dataset.open='false';
    clearTimeout(state.closeTimer);
    const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
    state.closeTimer=setTimeout(()=>{if(picker.dataset.open==='false')picker.hidden=true;},reduce?0:280);
    if(state.opener?.isConnected)state.opener.focus({preventScroll:true});
    state.opener=null;
  }
  async function requestJson(path,signal) {
    const res=await fetch(path,{method:'GET',credentials:'same-origin',
      cache:'no-store',headers:{Accept:'application/json'},signal});
    if(res.status===404)return {notFound:true};
    if(res.status===401||res.status===403)throw new Error('Shop session denied. Sign in again.');
    if(!res.ok)throw new Error('Verified Party source unavailable. No cached balances are shown.');
    return {body:await res.json()};
  }
  async function loadDirectory(selectSourceId=null){
    state.request?.abort();
    const controller=new AbortController();
    state.request=controller;state.error='';
    banner.textContent='Loading verified Shop data · তথ্য আসছে…';
    try {
      const generic=await requestJson('/api/owner/parties',controller.signal);
      let data;
      if(generic.notFound) {
        const fallback=await requestJson('/api/owner/suppliers',controller.signal);
        if(fallback.notFound)throw new Error('Party data service is not connected for this Shop.');
        data=sourceSupplierParties(fallback.body);
        state.mode='supplier-source';
      }else {
        data=normalizePartyDirectory(generic.body);
        state.mode='unified';
      }
      if(state.request!==controller)return;
      state.items=data;
      const wantedId=new URL(location.href).searchParams.get('id');
      const previous=data.find(p=>p.id===state.selectionId);
      const fromUrl=data.find(p=>p.partyId===wantedId);
      const newlyCreated=selectSourceId
        ?data.find(p=>p.sourceIds.Supplier===selectSourceId):null;
      if(selectSourceId){state.query='';state.roleFilter='Supplier';}
      const selected=newlyCreated||fromUrl||previous||data[0]||null;
      state.selectionId=selected?.id||null;
      state.relationship=selected?.roles.includes(new URL(location.href).searchParams.get('role'))
        ?new URL(location.href).searchParams.get('role')
        :selected?.roles[0]||null;
      renderDirectory();renderDetail();
      if(selected)void loadLedger();
    }catch(error){
      if(controller.signal.aborted||state.request!==controller)return;
      state.items=[];state.selectionId=null;state.mode='';
      state.error=error instanceof Error?error.message:'Shop Party service unavailable';
      renderDirectory();renderDetail();
    }
  }
  async function loadLedger(){
    state.ledgerRequest?.abort();state.ledger=null;state.ledgerError='';
    const p=getSelected();
    if(!p||state.relationship!=='Supplier'||!p.sourceIds.Supplier) {
      const area=detail.querySelector('#hparty-tab-content');
      if(area)renderTab(area);
      return;
    }
    const controller=new AbortController();state.ledgerRequest=controller;
    state.loading=true;
    const area=detail.querySelector('#hparty-tab-content');
    if(area)renderTab(area);
    try{
      const response=await requestJson('/api/owner/suppliers/'+encodeURIComponent(p.sourceIds.Supplier)+'/ledger',controller.signal);
      if(response.notFound)throw new Error('Supplier D1 ledger not connected for this Shop.');
      const ledger=projectSupplierStatement(response.body,p.sourceIds.Supplier);
      if(state.ledgerRequest!==controller)return;
      state.ledger=ledger;
    }catch(error){
      if(controller.signal.aborted||state.ledgerRequest!==controller)return;
      state.ledgerError=error instanceof Error?error.message:'Supplier ledger unavailable';
    }finally{
      if(state.ledgerRequest===controller){
        state.loading=false;
        const target=detail.querySelector('#hparty-tab-content');if(target)renderTab(target);
      }
    }
  }
  function openSupplierModal(){
    if(state.mode!=='supplier-source'||supplierSaving)return;
    clearTimeout(supplierCloseTimer);
    supplierOpener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    supplierModal.hidden=false;
    supplierStatus.textContent=supplierIntent
      ?'Previous save is unconfirmed. Retry unchanged to verify the same operation.':'';
    requestAnimationFrame(()=>supplierModal.dataset.open='true');
    if(supplierIntent){
      for(const box of roleInputs())box.checked=box.value==='Supplier';
    }
    syncAddRelationship();
    pick('#hparty-supplier-name').focus();
  }
  function closeSupplierModal(force=false){
    if((supplierSaving&&!force)||supplierModal.hidden)return;
    supplierModal.dataset.open='false';
    clearTimeout(supplierCloseTimer);
    supplierCloseTimer=setTimeout(()=>{
      if(supplierModal.dataset.open==='false')supplierModal.hidden=true;
    },matchMedia('(prefers-reduced-motion: reduce)').matches?0:90);
    if(supplierOpener?.isConnected)supplierOpener.focus({preventScroll:true});
    supplierOpener=null;
  }
  supplierForm.addEventListener('submit',async event=>{
    event.preventDefault();
    syncAddRelationship();
    if(supplierSaving||state.mode!=='supplier-source'||relationship.value!=='Supplier'||
      pick('#hparty-supplier-save').disabled||!supplierForm.reportValidity())return;
    const fields={
      name:pick('#hparty-supplier-name').value,
      phone:pick('#hparty-supplier-phone').value,
      address:pick('#hparty-supplier-address').value,
      notes:pick('#hparty-supplier-notes').value
    };
    try{
      const fingerprint=JSON.stringify(fields);
      if(supplierIntent&&supplierIntent.fingerprint!==fingerprint)
        throw new Error('Previous save is unconfirmed. Retry unchanged or reload the Shop before changing this Supplier.');
      if(!supplierIntent){
        const record=sourceSupplierCreatePayload(fields,crypto.randomUUID());
        supplierIntent={fingerprint,body:JSON.stringify(record)};
      }
      supplierSaving=true;syncAddRelationship();
      supplierStatus.textContent='Saving Supplier to authenticated Shop D1…';
      const response=await fetch('/api/owner/suppliers',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},body:supplierIntent.body
      });
      const result=await response.json().catch(()=>null);
      if(response.status===401||response.status===403){
        supplierIntent=null;
        throw new Error('Supplier save access denied or session expired. Check Owner permissions.');
      }
      if(!response.ok){
        if(response.status<500){
          supplierIntent=null;
          throw new Error(result?.message||'Supplier input was rejected. Check the original record.');
        }
        throw new Error('Could not confirm Supplier save. Retry unchanged to verify the same operation.');
      }
      const id=result?.data?.id;
      if(result?.success!==true||typeof id!=='string'||!SUPPLIER_ID.test(id))
        throw new Error('Could not confirm Supplier save. Retry unchanged to verify the same operation.');
      supplierIntent=null;
      supplierForm.reset();
      syncAddRelationship();
      closeSupplierModal(true);
      await loadDirectory(id);
    }catch(error){
      supplierStatus.textContent=error instanceof Error?error.message:'Could not confirm Supplier save. Retry unchanged.';
    }finally{
      supplierSaving=false;syncAddRelationship();
    }
  });
  pick('#hparty-add-party').addEventListener('click',openSupplierModal);
  pick('#hparty-supplier-close').addEventListener('click',()=>closeSupplierModal());
  pick('#hparty-supplier-cancel').addEventListener('click',()=>closeSupplierModal());
  pick('.hparty-supplier-backdrop').addEventListener('click',()=>closeSupplierModal());
  supplierModal.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeSupplierModal();}
    if(event.key!=='Tab')return;
    const focusable=Array.from(supplierModal.querySelectorAll(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'
    )).filter(el=>el.getClientRects().length);
    if(!focusable.length)return;
    if(event.shiftKey&&document.activeElement===focusable[0]){
      event.preventDefault();focusable.at(-1).focus();
    }else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){
      event.preventDefault();focusable[0].focus();
    }
  });
  const onSearch=event=>{
    state.query=event.target.value;
    search.value=state.query;pickerSearch.value=state.query;
    renderDirectory();
  };
  search.addEventListener('input',onSearch);pickerSearch.addEventListener('input',onSearch);
  for(const input of [search,pickerSearch])input.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'){
      const host=input===search?pick('#hparty-list'):pick('#hparty-picker-list');
      const first=host.querySelector('[role="option"]');if(first){event.preventDefault();first.focus();}
    }
  });
  for(const el of [pick('#hparty-list'),pick('#hparty-picker-list')])el.addEventListener('keydown',event=>{
    const items=Array.from(el.querySelectorAll('[role="option"]'));
    const index=items.indexOf(document.activeElement);
    if(index<0)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      const next=(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next].focus();items[next].scrollIntoView({block:'nearest'});
    }
  });
  pick('#hparty-refresh').addEventListener('click',()=>void loadDirectory());
  pick('#hparty-change').addEventListener('click',openPicker);
  pick('#hparty-picker-close').addEventListener('click',closePicker);
  pick('.hparty-picker-backdrop').addEventListener('click',closePicker);
  picker.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closePicker();}
    if(event.key==='Tab'){
      const focusable=Array.from(picker.querySelectorAll('button:not([disabled]),input:not([disabled])'))
        .filter(el=>el.getClientRects().length);
      if(!focusable.length)return;
      if(event.shiftKey&&document.activeElement===focusable[0]){
        event.preventDefault();focusable[focusable.length-1].focus();
      }else if(!event.shiftKey&&document.activeElement===focusable[focusable.length-1]){
        event.preventDefault();focusable[0].focus();
      }
    }
  });
  const openPage=()=>{
    applyMode();
    document.querySelectorAll('.page').forEach(el=>el.hidden=el!==page);
    page.hidden=false;
    const title=document.getElementById('pageTitle');
    if(title)title.textContent='Parties & Ledger · পার্টি ও খাতা';
    const subnav=document.getElementById('subNav');
    if(subnav)subnav.hidden=true;
    document.querySelectorAll('#navList .nav-item').forEach(item=>
      item.classList.toggle('active',item.dataset.page==='hisabiqParties'));
    if(typeof window.closeMobileMore_==='function')window.closeMobileMore_();
    if(typeof window.collapseSidebarOverlay_==='function')window.collapseSidebarOverlay_();
    if(typeof window.currentPage==='string')window.currentPage='hisabiqParties';
    void loadDirectory();
  };
  const addNav=(host,mobile)=>{
    if(!host||!host.children.length||host.querySelector('[data-page="hisabiqParties"],[data-mobile-target="hisabiqParties"]'))return;
    const btn=asButton('','nav-item');
    if(mobile){
      btn.className='mobile-more-item';
      btn.dataset.mobileTarget='hisabiqParties';
      btn.append(create('span','mobile-more-item-icon','♧'));
      const text=create('span','mobile-more-item-copy');
      text.append(create('strong','','Parties & Ledger'),create('span','bn-hint','পার্টি ও খাতা'));
      btn.append(text);
    } else {
      btn.dataset.page='hisabiqParties';
      btn.append(create('span','nav-item-text','Parties & Ledger · পার্টি ও খাতা'));
    }
    btn.addEventListener('click',openPage);
    host.append(btn);
  };
  const sidebar=document.getElementById('navList');
  const more=document.getElementById('mobileMoreList');
  const syncNav=()=>{addNav(sidebar,false);addNav(more,true);};
  const sidebarObserver=new MutationObserver(syncNav);
  const mobileObserver=new MutationObserver(syncNav);
  if(sidebar)sidebarObserver.observe(sidebar,{childList:true});
  if(more)mobileObserver.observe(more,{childList:true});
  syncNav();
  const refresh=document.getElementById('refreshBtn');
  if(refresh)refresh.addEventListener('click',event=>{
    if(!isVisible())return;
    event.preventDefault();event.stopImmediatePropagation();void loadDirectory();
  },true);
  const darkQuery=matchMedia('(prefers-color-scheme: dark)');
  darkQuery.addEventListener?.('change',applyMode);
}
if(typeof document!=='undefined'){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountOwnerParties,{once:true});
  else mountOwnerParties();
}
