import {readFile} from 'node:fs/promises';

const SCREEN_ID='id="page-hisabiqParties"';
const ROOT='<section class="page" id="page-hisabiqParties" data-page="hisabiqParties" data-hisabiq-design-system hidden><div id="hisabiq-party-root"></div></section>';

/** Add an isolated Party surface to compiled Owner ERP HTML. Legacy pages stay intact. */
export function patchOwnerHisabiqParties(html,{css,js}={}){
  if(typeof html!=='string'||typeof css!=='string'||!css.trim()||
    typeof js!=='string'||!js.trim())throw new TypeError('Missing Owner Party assets');
  if(html.includes(SCREEN_ID)||html.includes('id="hisabiq-party-controller"'))
    throw new Error('Owner Party workspace already installed; duplicate mount denied');
  const head=html.lastIndexOf('</head>');
  const main=html.lastIndexOf('</main>');
  const body=html.lastIndexOf('</body>');
  if(head<0||main<head||body<main||html.indexOf('id="content"')<0||
     html.indexOf('id="subNav"')<0)
    throw new Error('Original Owner shell boundaries changed');
  if(css.toLowerCase().includes('</style')||js.toLowerCase().includes('</script'))
    throw new Error('Unsafe embedded Party asset');
  const fonts='<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Hind+Siliguri:wght@400;500;600;700&amp;display=swap">';
  const style=fonts+'<style id="hisabiq-party-styles">\n'+css+'\n</style>';
  const script='<script type="module" id="hisabiq-party-controller">\n'+js+'\n</script>';
  const withStyle=html.slice(0,head)+style+html.slice(head);
  const atMain=withStyle.lastIndexOf('</main>');
  const withPage=withStyle.slice(0,atMain)+ROOT+'\n'+withStyle.slice(atMain);
  const atBody=withPage.lastIndexOf('</body>');
  return withPage.slice(0,atBody)+script+'\n'+withPage.slice(atBody);
}

/** Compiles the pinned design-system CSS + Party UI into the private Owner app. */
export async function installOwnerHisabiqParties(html){
  const base=new URL('../src/ui/hisabiq/',import.meta.url);
  const [tokens,style,script]=await Promise.all([
    readFile(new URL('hisabiq-design-system.css',base),'utf8'),
    readFile(new URL('party-workspace.css',base),'utf8'),
    readFile(new URL('party-workspace.mjs',base),'utf8')
  ]);
  return patchOwnerHisabiqParties(html,{css:tokens+'\n'+style,js:script});
}
