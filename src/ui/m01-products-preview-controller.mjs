/**
 * M01 compiled-only Products preview UI.
 * Frozen original frontend remains unmodified. All calculations come from
 * M05's reviewed read-only source; no new product save, stock posting or RPC.
 */
import {
  previewM05ProductAddForm,previewM05TileAreaOpening,formatM05ProductStockCell
} from './m05-product-form-stock-preview.js';

const byId=id=>document.getElementById(id);
const modal=byId('prodModal');
const unit=byId('prodUnit');
const type=byId('prodType');
const save=byId('prodSaveBtn');
const sourceId='UNSAVED-UI-PREVIEW';
if(modal&&unit&&type&&save&&!byId('m01ProductUnitMode')){
  const style=document.createElement('style');
  style.textContent=[
    '#m01ProductUnitPanel[hidden], #m01UnitFields[hidden], #m01TilesFields[hidden],',
    '#m01CartonFields[hidden], #m01ManufacturerFields[hidden], #m01AreaFields[hidden] {display:none!important}',
    '#m01ProductUnitPanel {border:1px solid var(--color-border,#d8deea);border-radius:7px;padding:12px;min-width:0;}',
    '#m01ProductUnitPanel .m01-fields {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;}',
    '#m01ProductUnitPanel .m01-fields>label {min-width:0;display:block;font-size:12px;}',
    '#m01ProductUnitPanel label[hidden] {display:none!important}',
    '#m01ProductUnitPanel .m01-fields>label input, #m01ProductUnitPanel .m01-fields>label select {width:100%;min-width:0;margin-top:5px;}',
    '#m01ProductUnitPanel .m01-title {font-weight:600;margin:0 0 8px;}',
    '#m01ProductUnitPanel .m01-message {font-size:12px;color:var(--color-text-muted,#5d6473);margin:8px 0 0;}',
    '#m01ProductUnitPanel .m01-preview {margin-top:10px;padding:9px;border:1px solid var(--color-border,#d8deea);border-radius:6px;min-height:38px;font-weight:600;overflow-wrap:anywhere;}',
    '#m01ProductUnitPanel .m01-error {color:#ae2833;}',
    '#m01ProductUnitPanel .m01-bn {font-size:11px;display:block;color:var(--color-text-muted,#5d6473);font-weight:400;}',
    '#prodSaveBtn.m01-advanced-save-disabled {background:#e9edf2!important;color:#64748b!important;border-color:#cbd5e1!important;cursor:not-allowed!important;opacity:1!important;}',
    '@media (max-width:600px){#m01ProductUnitPanel .m01-fields{grid-template-columns:1fr;}}'
  ].join('\n');
  document.head.appendChild(style);

  const panel=document.createElement('div');
  panel.className='full';
  panel.id='m01ProductUnitPanel';
  panel.innerHTML=[
    '<label for="m01ProductUnitMode">Product units <span class="m01-bn">পণ্যের একক ও মজুদ</span></label>',
    '<select id="m01ProductUnitMode" aria-describedby="m01PreviewReadOnly">',
      '<option value="single">Single Unit (existing)</option>',
      '<option value="multi">Multi-unit · Box / Pcs</option>',
      '<option value="tiles">Tiles · Box / Pcs / Sqft</option>',
    '</select>',
    '<div id="m01UnitFields" hidden>',
      '<p class="m01-title">Unit conversion <span class="m01-bn">এক বক্সে কত পিস?</span></p>',
      '<div class="m01-fields">',
        '<label for="m01CaseUnit">Pack unit <span class="m01-bn">বক্সের নাম</span>',
          '<input id="m01CaseUnit" value="Box" autocomplete="off"></label>',
        '<label for="m01CaseSize">Pcs per pack <span class="m01-bn">প্রতি বক্সে পিস</span>',
          '<input id="m01CaseSize" type="number" min="1" step="1" value="20"></label>',
      '</div>',
      '<label style="display:flex;align-items:center;gap:8px;margin:10px 0">',
        '<input id="m01UseCarton" type="checkbox" style="width:auto"> Add outer Carton / bigger unit',
        '<span class="m01-bn">কার্টন যোগ করুন</span></label>',
      '<div class="m01-fields" id="m01CartonFields" hidden>',
        '<label for="m01CartonUnit">Outer unit <input id="m01CartonUnit" value="Carton"></label>',
        '<label for="m01CartonSize">Packs per outer unit <input id="m01CartonSize" type="number" min="1" step="1" value="10"></label>',
      '</div>',
      '<div class="m01-fields">',
        '<label for="m01OpeningOuter">Opening outer units <input id="m01OpeningOuter" type="number" min="0" step="1" value="0"></label>',
        '<label for="m01OpeningCase">Opening packs <input id="m01OpeningCase" type="number" min="0" step="1" value="2"></label>',
        '<label for="m01OpeningBase">Opening Pcs <input id="m01OpeningBase" type="number" min="0" step="1" value="5"></label>',
        '<label for="m01BuyAnchor">Purchase price per <select id="m01BuyAnchor"></select></label>',
        '<label for="m01SellAnchor">Selling price per <select id="m01SellAnchor"></select></label>',
      '</div>',
    '</div>',
    '<div id="m01TilesFields" hidden>',
      '<p class="m01-title">Tiles measurement <span class="m01-bn">টাইলসের মাপ ও স্কয়ার ফুট</span></p>',
      '<div class="m01-fields">',
        '<label for="m01TileLength">Length (inches) <input id="m01TileLength" type="number" min="0.001" step="any" value="24"></label>',
        '<label for="m01TileWidth">Width (inches) <input id="m01TileWidth" type="number" min="0.001" step="any" value="24"></label>',
        '<label for="m01TilesPerBox">Pieces per Box <input id="m01TilesPerBox" type="number" min="1" step="1" value="25"></label>',
        '<label for="m01CoveragePolicy">Sqft policy <select id="m01CoveragePolicy"><option value="nominal">From dimensions</option><option value="manufacturer">Manufacturer verified coverage</option></select></label>',
      '</div>',
      '<div class="m01-fields" id="m01ManufacturerFields" hidden>',
        '<label for="m01ManufacturerSqft">Manufacturer Sqft per Box <input id="m01ManufacturerSqft" type="text" inputmode="decimal"></label>',
        '<label for="m01ManufacturerEvidence">Coverage evidence <input id="m01ManufacturerEvidence" type="text" placeholder="Printed carton label"></label>',
      '</div>',
      '<div class="m01-fields">',
        '<label for="m01OpeningMode">Opening quantity method <select id="m01OpeningMode"><option value="units">Boxes and Pcs</option><option value="area">Requested Sqft</option></select></label>',
      '</div>',
      '<div class="m01-fields" id="m01AreaFields" hidden>',
        '<label for="m01RequestedSqft">Requested Sqft <input id="m01RequestedSqft" type="text" inputmode="decimal" value="355.00"></label>',
        '<label for="m01AreaFulfillment">Fulfillment <select id="m01AreaFulfillment"><option value="loose">Boxes + loose Pcs</option><option value="box-only">Full boxes only</option></select></label>',
      '</div>',
    '</div>',
    '<div class="m01-preview" id="m01StockPreview" role="status" aria-live="polite" hidden></div>',
    '<p class="m01-message" id="m01PreviewReadOnly" hidden>Preview only. Advanced Product Save requires approved server validation and is currently unavailable.</p>'
  ].join('');
  unit.parentElement.parentElement.insertAdjacentElement('afterend',panel);

  const mode=byId('m01ProductUnitMode');
  const useCarton=byId('m01UseCarton');
  const fields=byId('m01UnitFields');
  const tileFields=byId('m01TilesFields');
  const manufacturerFields=byId('m01ManufacturerFields');
  const areaFields=byId('m01AreaFields');
  const preview=byId('m01StockPreview');
  const readOnly=byId('m01PreviewReadOnly');
  const originalSaveLabel=save.textContent;
  const legacyStockGroup=byId('prodStock')?.parentElement;

  function managedUnits(){
    const items=globalThis.prodState?.units||[];
    return items.filter(x=>x?.name).map(x=>({'Unit Name':String(x.name),Status:'Active'}));
  }
  function refreshAnchorChoices(){
    const stock=unit.value||'Pcs',pack=byId('m01CaseUnit').value.trim()||'Box';
    const names=[stock,pack];
    if(useCarton.checked)names.push(byId('m01CartonUnit').value.trim()||'Carton');
    for(const id of ['m01BuyAnchor','m01SellAnchor']){
      const control=byId(id),selected=control.value;
      control.replaceChildren();
      for(const name of [...new Set(names)]){
        const o=document.createElement('option');o.value=name;o.textContent=name;
        control.appendChild(o);
      }
      control.value=names.includes(selected)?selected:pack;
    }
  }
  function quantityString(id){
    const value=byId(id).value.trim();
    if(!/^(?:0|[1-9][0-9]*)$/.test(value))
      throw new Error('Enter whole quantities, zero or greater.');
    return value;
  }
  function update(){
    const advanced=type.value!=='Bundle'&&mode.value!=='single';
    const tile=advanced&&mode.value==='tiles';
    panel.hidden=type.value==='Bundle';
    fields.hidden=!advanced;
    tileFields.hidden=!tile;
    manufacturerFields.hidden=!tile||byId('m01CoveragePolicy').value!=='manufacturer';
    areaFields.hidden=!tile||byId('m01OpeningMode').value!=='area';
    byId('m01CaseSize').parentElement.hidden=tile;
    byId('m01CartonFields').hidden=!useCarton.checked;
    byId('m01OpeningOuter').parentElement.hidden=!useCarton.checked;
    preview.hidden=!advanced;
    readOnly.hidden=!advanced;
    if(legacyStockGroup)legacyStockGroup.hidden=advanced||type.value==='Bundle';
    save.disabled=advanced;
    save.classList.toggle('m01-advanced-save-disabled',advanced);
    save.textContent=advanced?'Save unavailable':originalSaveLabel;
    save.title=advanced?'Preview only — server-authorized product saving is not yet available':'';
    if(!advanced){preview.textContent='';return}
    try{
      refreshAnchorChoices();
      const stock=unit.value;
      if(!stock)throw new Error('Choose the physical stock unit above (e.g. Pcs).');
      const pack=byId('m01CaseUnit').value.trim(),outer=byId('m01CartonUnit').value.trim();
      const packCount=quantityString(tile?'m01TilesPerBox':'m01CaseSize');
      const relations=useCarton.checked?[
        {leftQty:1,leftUnit:outer,rightQty:Number(quantityString('m01CartonSize')),rightUnit:pack},
        {leftQty:1,leftUnit:pack,rightQty:Number(packCount),rightUnit:stock}
      ]:[{leftQty:1,leftUnit:pack,rightQty:Number(packCount),rightUnit:stock}];
      const config={
        productId:sourceId,unitMasters:managedUnits(),
        unitRelations:relations
      };
      if(!config.unitMasters.length)
        throw new Error('Load active managed Product Units before previewing.');
      if(tile){
        config.tileMeasurement={
          productId:sourceId,revision:'1',baseUnit:'Pcs',
          boxConversionId:'UNSAVED-BOX',boxUnitName:pack,
          length:byId('m01TileLength').value,
          width:byId('m01TileWidth').value,
          dimensionUnit:'in',piecesPerBox:packCount,
          coveragePolicy:byId('m01CoveragePolicy').value
        };
        if(config.tileMeasurement.coveragePolicy==='manufacturer'){
          config.tileMeasurement.manufacturerSqftPerBox=byId('m01ManufacturerSqft').value.trim();
          config.tileMeasurement.manufacturerEvidence=byId('m01ManufacturerEvidence').value.trim();
        }
      }
      let result;
      if(tile&&byId('m01OpeningMode').value==='area'){
        result=previewM05TileAreaOpening({
          ...config,requestedSqft:byId('m01RequestedSqft').value.trim(),
          fulfillment:byId('m01AreaFulfillment').value
        });
      }else{
        const entries=[];
        if(useCarton.checked)entries.push({unitName:outer,qtyText:quantityString('m01OpeningOuter')});
        entries.push({unitName:pack,qtyText:quantityString('m01OpeningCase')});
        entries.push({unitName:stock,qtyText:quantityString('m01OpeningBase')});
        const amount=id=>{
          const raw=byId(id).value.trim();
          if(raw===''||!Number.isFinite(Number(raw))||Number(raw)<0)
            throw new Error('Enter a valid purchase and selling price.');
          return Number(raw);
        };
        result=previewM05ProductAddForm({
          ...config,openingUnits:entries,
          prices:{
            purchasePrice:amount('prodPurchasePrice'),
            sellingPrice:amount('prodSellingPrice'),
            purchasePriceUnit:byId('m01BuyAnchor').value,
            sellingPriceUnit:byId('m01SellAnchor').value,
            unitPriceOverrides:[]
          }
        });
      }
      if(result.postingAllowed!==false)throw new Error('Preview cannot authorize stock posting');
      preview.classList.remove('m01-error');
      preview.textContent=result.stockCellText+' · '+result.baseStock+' '+result.stockUnit+' physical stock';
    }catch(e){
      preview.classList.add('m01-error');
      preview.textContent=e.message||'Check product units and measurements';
    }
  }
  const watched=[
    'm01ProductUnitMode','m01CaseUnit','m01CaseSize','m01UseCarton','m01CartonUnit','m01CartonSize',
    'm01OpeningOuter','m01OpeningCase','m01OpeningBase','m01BuyAnchor','m01SellAnchor',
    'm01TileLength','m01TileWidth','m01TilesPerBox','m01CoveragePolicy',
    'm01ManufacturerSqft','m01ManufacturerEvidence','m01OpeningMode','m01RequestedSqft',
    'm01AreaFulfillment','prodUnit','prodPurchasePrice','prodSellingPrice','prodType'
  ];
  for(const id of watched)byId(id)?.addEventListener('input',update);
  for(const id of watched)byId(id)?.addEventListener('change',update);
  new MutationObserver(()=>{
    if(!modal.hidden){mode.value='single';update()}
  }).observe(modal,{attributes:true,attributeFilter:['hidden']});

  // The source-aware Stock formatter is optional until M03 delivers the
  // reviewed per-product config. Unknown rows retain the original stock cell.
  const body=byId('prodTableBody');
  if(body){
    const decorate=()=>{
      const products=globalThis.prodState?.products||[];
      for(const tr of body.querySelectorAll('tr')){
        const id=tr.querySelector('button[data-id]')?.dataset.id;
        const row=products.find(x=>x['Product ID']===id);
        const config=row?.['M05 Stock Preview'];
        if(!config||config.productId!==id)continue;
        const cell=tr.querySelector('td:nth-child(5) .prod-cell-main');
        if(!cell)continue;
        try{
          const view=formatM05ProductStockCell({
            ...config,baseStockText:String(row['Current Stock'])
          });
          if(view.postingAllowed!==false)continue;
          cell.textContent=view.stockCellText;
        }catch{
          // Keep the unmodified legacy stock-cell text if metadata is stale.
        }
      }
    };
    new MutationObserver(decorate).observe(body,{childList:true});
  }
  update();
}
