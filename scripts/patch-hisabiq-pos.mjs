/**
 * HisabIQ POS V2 compiled-only presentation: keep the original POS DOM IDs,
 * original event listeners and financial serverCall contracts authoritative.
 * No direct D1 writes, no replacement/duplicate checkout handler.
 */
const PAGE='<section class="page" id="page-pos" data-page="pos" hidden>';
const REQUIRED=['posCartList','posCustomerName','posCustomerPhone','posDiscount',
  'posAmountReceived','posPaymentMethod','posMultiPaymentFields','posMultiPaymentRows',
  'posAddPaymentRowBtn','posSearch','posProductGrid','posCompleteBtn','posClearCartBtn'];
export function patchHisabiqPos(html,css,script){
  if(typeof html!=='string'||typeof css!=='string'||typeof script!=='string')
    throw new TypeError('Compiled POS HTML, CSS and script must be strings');
  if(html.includes('id="hisabiq-pos-style"')||html.includes('id="hisabiq-pos-runtime"')||
     html.includes('data-hisabiq-pos'))
    throw new Error('HisabIQ POS already installed');
  const count=html.split(PAGE).length-1;
  if(count===0)return html;
  if(count!==1)throw new Error('Ambiguous compiled POS section');
  const start=html.indexOf(PAGE),end=html.indexOf('</section>',start+PAGE.length);
  if(end<0)throw new Error('Compiled POS closing boundary missing');
  // The first nested section is not the end of the whole POS; check the original
  // source IDs in the full page region up through the next top-level page.
  const next=html.indexOf('<section class="page"',start+PAGE.length);
  const source=html.slice(start,next<0?html.length:next);
  for(const id of REQUIRED)
    if(source.split('id="'+id+'"').length!==2)
      throw new Error('Original POS contract missing or duplicate: '+id);
  if(!source.includes('function posRenderCart_()')||!source.includes('completeSale'))
    throw new Error('Original POS financial/rendering contract changed');
  if(/<\s*\/\s*style\b/i.test(css)||/<\s*\/\s*script\b/i.test(script))
    throw new Error('Unsafe compiled POS asset closing marker');
  if(html.split('</head>').length!==2||html.split('</body>').length!==2)
    throw new Error('Ambiguous compiled HTML shell');
  return html.replace(PAGE,PAGE.slice(0,-1)+' data-hisabiq-pos>')
    .replace('</head>','<style id="hisabiq-pos-style">\n'+css+'\n</style></head>')
    .replace('</body>','<script id="hisabiq-pos-runtime">\n'+script+'\n</script></body>');
}
