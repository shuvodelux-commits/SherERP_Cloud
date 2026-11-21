/**
 * HisabIQ Add Product stock unit + coverage editor for the compiled Owner shell.
 * UI/preview only: this is not a D1 multi-unit Product writer. No API calls.
 * Stock Box->Pcs and physical coverage Pcs->Sqft are separate relationships.
 */
const MAX_QUANTITY=1000000n;
const SCALE=10000n;

function whole(value,label,allowZero=false){
 const raw=String(value??'').trim();
 if(!/^(?:0|[1-9]\d{0,6})$/.test(raw))throw new RangeError(label+' must be a valid whole number');
 const n=BigInt(raw);
 if(n>MAX_QUANTITY||(!allowZero&&n===0n))throw new RangeError(label+' must be a positive whole number');
 return n;
}
function areaScaled(value){
 const raw=String(value??'').trim();
 if(!/^(?:(?:0|[1-9]\d{0,6})(?:\.\d{1,4})?|\.\d{1,4})$/.test(raw))
   throw new RangeError('Coverage must be a positive decimal (up to four places)');
 const [int,dec='']=raw.split('.');
 const amount=BigInt(int||0)*SCALE+BigInt(dec.padEnd(4,'0')||'0');
 if(amount<=0n||amount>MAX_QUANTITY*SCALE)
   throw new RangeError('Coverage must be a positive decimal not exceeding one million');
 return amount;
}
function formatScaled(value){
 const wholePart=(value/SCALE).toString();
 const dec=(value%SCALE).toString().padStart(4,'0').replace(/0+$/,'');
 return dec?wholePart+'.'+dec:wholePart;
}

/** No JS float is involved in integer stock / decimal area totals. */
export function calculateCoverage({packSize,coveragePerPiece,openingPacks='0',openingPieces='0',
  packUnit='Box',stockUnit='Pcs'}={}){
 const size=whole(packSize,'Pack size');
 const coverage=areaScaled(coveragePerPiece);
 const packs=whole(openingPacks,'Opening packs',true);
 const pieces=whole(openingPieces,'Opening pieces',true);
 const count=packs*size+pieces;
 if(count>MAX_QUANTITY)throw new RangeError('Opening quantity is too large');
 if(typeof stockUnit!=='string'||!stockUnit.trim()||typeof packUnit!=='string'||!packUnit.trim()||
    stockUnit.trim().toLowerCase()===packUnit.trim().toLowerCase())
   throw new RangeError('Pack unit must be different from physical stock unit');
 return {
   equation:`1 ${packUnit} = ${size} ${stockUnit}`,
   areaEquation:`1 ${stockUnit} = ${formatScaled(coverage)} Sqft`,
   packCoverage:formatScaled(size*coverage),
   openingBase:count.toString(),
   openingCoverage:formatScaled(count*coverage)
 };
}
export function activeMasterUnits(rows){
 if(!Array.isArray(rows))return [];
 const seen=new Set(),out=[];
 for(const row of rows){
   const name=typeof row?.name==='string'?row.name.trim():'';
   if(!name||name.length>80||/[\u0000-\u001f\u007f]/.test(name))continue;
   if((Object.hasOwn(row,'status')&&row.status!=='Active')||
      (Object.hasOwn(row,'Status')&&row.Status!=='Active'))continue;
   const key=name.toLocaleLowerCase('en');
   if(!seen.has(key)){seen.add(key);out.push(name);}
 }
 return out;
}

function mountEditor(){
 const $=id=>document.getElementById(id);
 const modal=$('prodModal'),base=$('prodUnit'),type=$('prodType'),original=$('m01ProductUnitPanel');
 const mode=$('m01ProductUnitMode'),stock=$('prodStock'),save=$('prodSaveBtn');
 if(!modal||!base||!type||!original||!mode||!stock||!save)return false;
 if($('hapu-editor'))return true;
 const container=document.createElement('section');
 container.id='hapu-editor';container.className='hapu-editor full';
 container.setAttribute('aria-label','Product units and measurements');
 container.innerHTML=`
 <div class="hapu-heading">
   <div class="hapu-heading-text">
     <div class="hapu-heading-icon" aria-hidden="true">▤</div>
     <div><h4>Multiple units <span class="hapu-sub-bn">একাধিক একক</span></h4>
       <p>Use packs and pieces with linked quantities.</p></div>
   </div>
   <label class="hapu-switch-wrap" for="hapu-enable">
     <input id="hapu-enable" type="checkbox" role="switch" aria-controls="hapu-details" aria-label="Enable multiple units">
     <span class="hapu-switch-track" aria-hidden="true"><span></span></span>
   </label>
 </div>
 <div id="hapu-details" hidden>
   <p class="hapu-caption">Stock is counted in <strong id="hapu-base-label"></strong>. Set how larger packs contain that unit.</p>
   <fieldset class="hapu-group"><legend>Unit conversions <span class="hapu-sub-bn">এককের রূপান্তর</span></legend>
     <div class="hapu-equation" data-hapu-equation="pack">
       <span class="hapu-one" aria-hidden="true">1</span>
       <label class="hapu-field"><span>Pack unit</span><select id="hapu-pack" aria-label="Larger pack unit"></select></label>
       <span class="hapu-equals" aria-hidden="true">=</span>
       <label class="hapu-field hapu-quantity"><span>Quantity</span><input id="hapu-size" type="text" inputmode="numeric" value="15" aria-label="Number of pieces in a pack" autocomplete="off"></label>
       <strong class="hapu-unit" id="hapu-pack-base">Pcs</strong>
     </div>
     <div class="hapu-extra-row">
       <button type="button" id="hapu-outer-toggle" aria-expanded="false" aria-controls="hapu-outer-row">+ Add another unit <span class="hapu-sub-bn">আরেকটি একক</span></button>
     </div>
     <div class="hapu-equation" data-hapu-equation="outer" id="hapu-outer-row" hidden>
       <span class="hapu-one" aria-hidden="true">1</span>
       <label class="hapu-field"><span>Outer unit</span><select id="hapu-outer" aria-label="Outer unit"></select></label>
       <span class="hapu-equals" aria-hidden="true">=</span>
       <label class="hapu-field hapu-quantity"><span>Quantity</span><input id="hapu-outer-size" type="text" inputmode="numeric" value="12" aria-label="Packs per outer unit" autocomplete="off"></label>
       <strong class="hapu-unit" id="hapu-outer-pack">Box</strong>
       <button type="button" id="hapu-remove-outer" class="hapu-remove" aria-label="Remove outer unit" title="Remove outer unit">×</button>
     </div>
   </fieldset>
   <fieldset class="hapu-group hapu-area-group"><legend>Area measurement <span class="hapu-sub-bn">স্কয়ার ফুটের হিসাব</span></legend>
     <label class="hapu-check" for="hapu-area-enable"><input type="checkbox" id="hapu-area-enable" aria-controls="hapu-area-row"> Measure coverage in Sqft</label>
     <div class="hapu-equation" data-hapu-equation="area" id="hapu-area-row" hidden>
       <span class="hapu-one" aria-hidden="true">1</span><strong class="hapu-stock-name" id="hapu-area-stock">Pcs</strong>
       <span class="hapu-equals" aria-hidden="true">=</span>
       <label class="hapu-field hapu-quantity"><span>Area per piece</span><input id="hapu-area-size" type="text" inputmode="decimal" value="0.65" aria-label="Square feet per piece" autocomplete="off"></label>
       <strong class="hapu-unit">Sqft</strong>
     </div>
     <p class="hapu-hint">Sqft is a measurement, not extra physical stock. Enter actual manufacturer coverage where applicable.</p>
   </fieldset>
   <fieldset class="hapu-group hapu-stock-group"><legend>Opening stock preview <span class="hapu-sub-bn">শুরুর মজুদ</span></legend>
     <div class="hapu-field-grid">
       <label class="hapu-field" id="hapu-opening-outer-label" hidden><span id="hapu-opening-outer-text">Cartons</span><input id="hapu-opening-outer" type="text" inputmode="numeric" value="0" aria-label="Opening outer units"></label>
       <label class="hapu-field"><span id="hapu-opening-pack-text">Boxes</span><input id="hapu-opening-packs" type="text" inputmode="numeric" value="0" aria-label="Opening packs"></label>
       <label class="hapu-field"><span id="hapu-opening-base-text">Pieces</span><input id="hapu-opening-pieces" type="text" inputmode="numeric" value="0" aria-label="Opening pieces"></label>
     </div>
   </fieldset>
   <div class="hapu-price-row">
     <label class="hapu-field">Purchase price per <select id="hapu-buy-anchor" aria-label="Purchase price unit"></select></label>
     <label class="hapu-field">Selling price per <select id="hapu-sell-anchor" aria-label="Selling price unit"></select></label>
   </div>
   <div class="hapu-result" id="hapu-result" role="status" aria-live="polite"></div>
   <p class="hapu-nopost" role="note">Preview only — multi-unit product saving is not connected to the authorized D1 backend yet. Keep the single-unit mode to save a normal product.</p>
 </div>`;
 original.insertAdjacentElement('beforebegin',container);
 const enable=$('hapu-enable'),detail=$('hapu-details'),areaEnable=$('hapu-area-enable');
 const pack=$('hapu-pack'),outer=$('hapu-outer'),outerToggle=$('hapu-outer-toggle');
 const outerRow=$('hapu-outer-row'),outerStockLabel=$('hapu-opening-outer-label');
 let everActivated=false;
 function put(id,value){
   const element=$(id);if(!element||String(element.value)===String(value))return;
   element.value=value;element.dispatchEvent(new Event('input',{bubbles:true}));
   element.dispatchEvent(new Event('change',{bubbles:true}));
 }
 function copyOptions(select,values,preferred){
   const current=select.value||preferred;
   select.replaceChildren();
   const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Select unit…';select.append(placeholder);
   for(const name of values){const option=document.createElement('option');option.value=name;option.textContent=name;select.append(option);}
   select.value=values.includes(current)?current:(values.includes(preferred)?preferred:values[0]||'');
 }
 function render(){
   const editing=Boolean(globalThis.prodState?.editingId);
   const bundle=type.value==='Bundle';
   container.hidden=bundle;enable.disabled=editing||bundle;
   // Do not silently switch editing products to a new unit profile.
   const multi=enable.checked&&!bundle&&!editing;
   detail.hidden=!multi;
   if(mode.value!==(multi?'multi':'single'))put('m01ProductUnitMode',multi?'multi':'single');
   const masters=activeMasterUnits(globalThis.prodState?.units||[]);
   const stockUnit=base.value.trim();
   const used=stockUnit.toLocaleLowerCase('en');
   // Source has a distinct area-measurement relationship; never offer
   // its Sqft unit as a physical pack in the same product profile.
   const valid=masters.filter(name=>name.toLocaleLowerCase('en')!==used&&
     !/^(?:sqft|sq\.?\s*ft|square\s*feet)$/i.test(name));
   const preferred=used==='box'?'Carton':'Box';
   copyOptions(pack,valid,preferred);
   const outerChoices=valid.filter(name=>name.toLocaleLowerCase('en')!==pack.value.toLocaleLowerCase('en'));
   copyOptions(outer,outerChoices,'Carton');
   $('hapu-base-label').textContent=stockUnit||'—';
   $('hapu-pack-base').textContent=stockUnit||'—';
   $('hapu-area-stock').textContent=stockUnit||'—';
   $('hapu-outer-pack').textContent=pack.value||'—';
   $('hapu-opening-outer-text').textContent=outer.value||'Outer units';
   $('hapu-opening-pack-text').textContent=pack.value||'Packs';
   $('hapu-opening-base-text').textContent=stockUnit||'Base units';
   const extra=outerToggle.getAttribute('aria-expanded')==='true';
   outerRow.hidden=!extra;outerStockLabel.hidden=!extra;
   const area=areaEnable.checked;
   $('hapu-area-row').hidden=!area;
   try{
     if(!multi)return;
     if(!stockUnit||!masters.some(x=>x.toLocaleLowerCase('en')===used))throw new RangeError('Choose an active physical stock unit above.');
     if(!pack.value||!valid.includes(pack.value))throw new RangeError('Choose a different active pack unit.');
     const count=$('hapu-size').value.trim();
     const areaAmount=area?$('hapu-area-size').value.trim():'1';
     const outerCount=extra?$('hapu-outer-size').value.trim():'1';
     const outerOpening=extra?$('hapu-opening-outer').value.trim():'0';
     const coverage=calculateCoverage({packSize:count,coveragePerPiece:areaAmount,
       openingPacks:$('hapu-opening-packs').value.trim(),openingPieces:$('hapu-opening-pieces').value.trim(),
       packUnit:pack.value,stockUnit});
     // Ensure optional outer pack quantity is exact and whole before mirroring.
     const outerSize=extra?whole(outerCount,'Outer pack quantity'):0n;
     const outerOpened=extra?whole(outerOpening,'Opening outer units',true):0n;
     if(extra&&(!outer.value||!outerChoices.includes(outer.value)))throw new RangeError('Choose a different outer unit');
     const totalPieces=BigInt(coverage.openingBase)+outerSize*outerOpened*BigInt(count);
     if(totalPieces>MAX_QUANTITY)throw new RangeError('Opening quantity is too large');
     const areaPerPiece=area?areaScaled(areaAmount):0n;
     const openingArea=area?formatScaled(totalPieces*areaPerPiece):'';
     const equations=[coverage.equation];
     if(extra)equations.unshift(`1 ${outer.value} = ${outerSize} ${pack.value}`);
     if(area)equations.push(coverage.areaEquation);
     // Preserve the original M05 read-only source-checked quantity/price preview.
     put('m01CaseUnit',pack.value);put('m01CaseSize',count);
     const checkbox=$('m01UseCarton');
     if(checkbox.checked!==extra){checkbox.checked=extra;checkbox.dispatchEvent(new Event('change',{bubbles:true}));}
     if(extra){put('m01CartonUnit',outer.value);put('m01CartonSize',outerCount);}
     put('m01OpeningOuter',outerOpening);
     put('m01OpeningCase',$('hapu-opening-packs').value.trim());
     put('m01OpeningBase',$('hapu-opening-pieces').value.trim());
     for(const [target,source] of [['m01BuyAnchor','hapu-buy-anchor'],['m01SellAnchor','hapu-sell-anchor']]){
       const originalSelect=$(target),our=$(source);
       const chosen=our.value||originalSelect.value;
       our.replaceChildren(...[...originalSelect.options].map(opt=>{const next=document.createElement('option');next.value=opt.value;next.textContent=opt.textContent;return next;}));
       our.value=[...our.options].some(opt=>opt.value===chosen)?chosen:(our.options[0]?.value||'');
       if(our.value)put(target,our.value);
     }
     $('hapu-result').classList.remove('hapu-error');
     $('hapu-result').replaceChildren();
     const title=document.createElement('strong');title.textContent=equations.join('  ·  ');
     const result=document.createElement('div');result.className='hapu-result-line';
     result.textContent=`Opening: ${totalPieces} ${stockUnit} physical stock`+
       (area?` · ${openingArea} Sqft coverage (1 ${pack.value} = ${coverage.packCoverage} Sqft)`:'');
     $('hapu-result').append(title,result);
     const old=$('m01StockPreview');
     if(old&&!old.classList.contains('m01-error')&&old.textContent){
       const hint=document.createElement('small');hint.textContent='M05 physical stock preview: '+old.textContent;
       $('hapu-result').append(hint);
     }
   }catch(error){
     $('hapu-result').classList.add('hapu-error');
     $('hapu-result').textContent=error.message||'Review unit quantities';
   }
 }
 function changed(){
   render();
 }
 enable.addEventListener('change',()=>{
   if(enable.checked&&!everActivated){
     // An Add Product must not prefill opening stock from a synthetic example.
     put('m01OpeningCase','0');put('m01OpeningBase','0');put('m01OpeningOuter','0');
     everActivated=true;
   }
   render();
 });
 outerToggle.addEventListener('click',()=>{
   const active=outerToggle.getAttribute('aria-expanded')!=='true';
   outerToggle.setAttribute('aria-expanded',String(active));
   outerToggle.textContent=active?'− Remove larger unit':'＋ Add another unit';render();
 });
 $('hapu-remove-outer').addEventListener('click',()=>{outerToggle.setAttribute('aria-expanded','false');outerToggle.textContent='＋ Add another unit';render();outerToggle.focus();});
 for(const id of ['hapu-pack','hapu-size','hapu-outer','hapu-outer-size','hapu-opening-outer',
   'hapu-opening-packs','hapu-opening-pieces','hapu-area-enable','hapu-area-size','hapu-buy-anchor','hapu-sell-anchor']){
   $(id).addEventListener('input',changed);$(id).addEventListener('change',changed);
 }
 base.addEventListener('change',changed);base.addEventListener('input',changed);
 type.addEventListener('change',()=>{if(type.value==='Bundle')enable.checked=false;render();});
 const initialUnitObserver=new MutationObserver(()=>{if(!modal.hidden){enable.checked=false;everActivated=false;render();}});
 initialUnitObserver.observe(modal,{attributes:true,attributeFilter:['hidden']});
 render();return true;
}

if(typeof document!=='undefined'){
 const ready=()=>{
   if(mountEditor())return;
   const observer=new MutationObserver(()=>{if(mountEditor())observer.disconnect();});
   observer.observe(document.body,{childList:true,subtree:true});
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});
 else ready();
}
