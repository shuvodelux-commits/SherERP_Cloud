import {readFile} from 'node:fs/promises';

/** Adds a UI-only adapter to the authenticated Owner product table. Never edits the legacy source. */
export function patchOwnerHisabiqProducts(html,{css,js}={}){
  if(typeof html!=='string'||typeof css!=='string'||!css.trim()||typeof js!=='string'||!js.trim())
    throw new TypeError('Missing HisabIQ Product Table assets');
  if(html.includes('id="hisabiq-products-table-controller"')||html.includes('id="hisabiq-products-table-styles"'))
    throw new Error('HisabIQ Product Table already installed');
  if(html.split('id="page-products"').length!==2||html.split('id="prodTable"').length!==2||
    !html.includes('</head>')||!html.includes('</body>'))
    throw new Error('Original Owner Product table boundary changed');
  if(/<\/style/i.test(css)||/<\/script/i.test(js))throw new Error('Unsafe inline Product Table asset');
  const scoped=html.replace('id="page-products"','id="page-products" data-hisabiq-design-system');
  const style='<style id="hisabiq-products-table-styles">\n'+css+'\n</style>';
  const script='<script type="module" id="hisabiq-products-table-controller">\n'+js+'\n</script>';
  return scoped.replace('</head>',style+'\n</head>').replace('</body>',script+'\n</body>');
}

export async function installOwnerHisabiqProducts(html){
 const base=new URL('../src/ui/hisabiq/',import.meta.url);
 const [tokens,css,js]=await Promise.all([
  readFile(new URL('hisabiq-design-system.css',base),'utf8'),
  readFile(new URL('product-table.css',base),'utf8'),
  readFile(new URL('product-table.mjs',base),'utf8')
 ]);
 return patchOwnerHisabiqProducts(html,{css:tokens+'\n'+css,js});
}
