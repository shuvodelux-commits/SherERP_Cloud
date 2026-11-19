// Applied only to a disposable browser fixture. The Owner release builder
// never imports this adapter and the live Worker does not have its routes.
export function connectCleanShopFixtureForm(html){
  const replace=(from,to)=>{
    if(html.split(from).length!==2)throw new Error('Clean shop form anchor changed: '+from);
    html=html.replace(from,()=>to);
  };

  replace('id="prodAddBtn" hidden style="display:none!important"','id="prodAddBtn"');
  replace('Saved purchase price ','Purchase price ');
  replace('Stock at backup ','Stock ');
  replace('Business data is not connected. ERP screens are visible, but reads and saves are unavailable.',
    'Start with a standard product. Opening stock starts at zero.');
  replace("    prodState.addSource = source || 'products';",`    prodState.addSource = source || 'products';
    ['prodType','prodBrand','prodCategory','prodManageCategoriesBtn','prodManageUnitsBtn','prodMinStock','prodBarcode'].forEach(function(id){
      document.getElementById(id).disabled = true;
    });`);
  replace("    document.getElementById('prodStock').disabled = false;\n    document.getElementById('prodFormError').style.display = 'none';",
    "    document.getElementById('prodStock').disabled = true;\n    document.getElementById('prodFormError').style.display = 'none';");
  replace('  function serverCall(fnName) {',`  var cleanShopPendingProduct = null;
  function cleanShopProductsRequest_(body) {
    return fetch('/__clean_shop__/products', {
      credentials:'same-origin',cache:'no-store',
      ...(body ? {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {})
    }).then(async function(response) {
      var result = await response.json();
      if(!response.ok) throw new Error(result.error || 'Could not confirm the product save.');
      return result.data;
    });
  }

  function cleanShopCreateProduct_(payload) {
    var save = document.getElementById('prodSaveBtn');
    if(save.disabled) return Promise.reject(new Error('Product save is in progress.'));
    if(prodState.addSource!=='products'||payload.productType!=='Standard'||payload.stock!=='0'){
      return Promise.reject(new Error('The test shop supports standard products with zero opening stock.'));
    }
    var draft={name:payload.name,unit:payload.unit,purchasePrice:payload.purchasePrice,sellingPrice:payload.sellingPrice};
    var fingerprint=JSON.stringify(draft);
    if(cleanShopPendingProduct?.fingerprint!==fingerprint){
      cleanShopPendingProduct={fingerprint:fingerprint,body:{operationId:crypto.randomUUID(),...draft}};
    }
    save.disabled=true;
    return cleanShopProductsRequest_(cleanShopPendingProduct.body).then(function(result){
      cleanShopPendingProduct=null;
      return result;
    }).finally(function(){save.disabled=false;});
  }

  function serverCall(fnName) {
    if(fnName==='addProduct') return cleanShopCreateProduct_(arguments[2]);
    if(fnName==='getProductsBootstrap') return cleanShopProductsRequest_().then(function(rows){
      return {products:rows.map(function(row){
        return {'Product ID':row.id,'Product Name':row.name,'Unit':row.unit,
          'Purchase Price':row.purchasePrice,'Selling Price':row.sellingPrice,'Current Stock':row.stock};
      }),categories:[],units:[{name:'pcs'}]};
    });`);
  return html;
}
