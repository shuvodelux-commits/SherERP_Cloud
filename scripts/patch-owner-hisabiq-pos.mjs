import {readFile} from 'node:fs/promises';

/**
 * Owner-only POS presentation override. All original product/cart/payment
 * handlers and legacy compiled IDs remain authoritative.
 */
export function patchOwnerHisabiqPos(html,{css,js}={}){
  if(typeof html!=='string'||typeof css!=='string'||!css.trim()||
    typeof js!=='string'||!js.trim())throw new TypeError('Missing Owner POS assets');
  if(html.includes('id="hisabiq-pos-parity-styles"')||
    html.includes('id="hisabiq-pos-parity-controller"'))
    throw new Error('Owner POS parity already installed');
  if(html.indexOf('id="page-pos"')<0||html.indexOf('id="posCartList"')<0||
     html.indexOf('id="posCompleteBtn"')<0||
     html.indexOf('class="pos-layout"')<0)
    throw new Error('Owner POS source boundary changed');
  if(/<\/style|<\/script/i.test(css)||/<\/script/i.test(js))
    throw new Error('Unsafe embedded POS asset');
  const head=html.lastIndexOf('</head>'),body=html.lastIndexOf('</body>');
  if(head<0||body<head)throw new Error('Owner POS HTML boundary changed');
  const withStyles=html.slice(0,head)+
    '<style id="hisabiq-pos-parity-styles">\n'+css+'\n</style>\n'+html.slice(head);
  const end=withStyles.lastIndexOf('</body>');
  return withStyles.slice(0,end)+
    '<script type="module" id="hisabiq-pos-parity-controller">\n'+
    js+'\n</script>\n'+withStyles.slice(end);
}

export async function installOwnerHisabiqPos(html){
  const base=new URL('../src/ui/hisabiq/',import.meta.url);
  const [css,js]=await Promise.all([
    readFile(new URL('pos-parity.css',base),'utf8'),
    readFile(new URL('pos-parity.mjs',base),'utf8')
  ]);
  return patchOwnerHisabiqPos(html,{css,js});
}
