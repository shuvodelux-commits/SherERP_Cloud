import {readFile} from 'node:fs/promises';

const PAGES=['settings','invoiceDesign','users','roles'];
const STYLE_ID='id="hisabiq-settings-styles"';
const SCRIPT_ID='id="hisabiq-settings-controller"';
const BRIDGE_ID='id="hisabiq-invoice-profile-client"';

/** Compile-only injection into the private authenticated Owner UI. No D1 or RPC mutation. */
export function patchOwnerHisabiqSettings(html,{css,js,bridge}={}){
  if(typeof html!=='string'||typeof css!=='string'||!css.trim()||
      typeof js!=='string'||!js.trim()||
      typeof bridge!=='string'||!bridge.trim())throw new TypeError('Missing Settings reference assets');
  if(html.includes(STYLE_ID)||html.includes(SCRIPT_ID)||html.includes(BRIDGE_ID))
    throw new Error('HisabIQ settings already installed');
  if(css.toLowerCase().includes('</style')||js.toLowerCase().includes('</script')||
      bridge.toLowerCase().includes('</script'))
    throw new Error('Unsafe embedded Settings asset');
  if(PAGES.some(page=>html.split('id="page-'+page+'"').length!==2) ||
      html.split('</head>').length!==2||html.split('</body>').length!==2)
    throw new Error('Original Settings page boundary changed');
  return html.replace('</head>','<style '+STYLE_ID+'>\n'+css+'\n</style></head>')
    .replace('</body>','<script type="module" '+SCRIPT_ID+'>\n'+js+'\n</script>'+
      '<script type="module" '+BRIDGE_ID+'>\n'+bridge+'\n</script></body>');
}

export async function installOwnerHisabiqSettings(html){
  const base=new URL('../src/ui/hisabiq/',import.meta.url);
  const [css,js,bridge]=await Promise.all([
    readFile(new URL('settings-workspace.css',base),'utf8'),
    readFile(new URL('settings-workspace.mjs',base),'utf8'),
    readFile(new URL('invoice-profile-bridge.mjs',base),'utf8')
  ]);
  return patchOwnerHisabiqSettings(html,{css,js,bridge});
}
