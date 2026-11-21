/** Compiled-only HisabIQ Sales presentation. Legacy Sales logic is immutable. */
const SALES_PAGE='<section class="page" id="page-sales" data-page="sales" hidden>';
const REQUIRED_IDS=['smSearch','smDateFrom','smDateTo','smPaymentStatus',
  'smReturnStatus','smRefreshBtn','smTableScroll','smTableBody',
  'smProfitHeader','smEmpty','smViewModal','smPayModal'];

export function patchHisabiqSales(html,stylesheet,script){
  if(typeof html!=='string'||typeof stylesheet!=='string'||typeof script!=='string')
    throw new TypeError('Expected compiled HTML and reviewed Sales UI assets');
  const count=html.split(SALES_PAGE).length-1;
  if(count===0)return html; // Unrelated HtmlService test fixture.
  if(count!==1)throw new Error('Ambiguous compiled Sales page boundary');
  if(html.includes('id="hisabiq-sales-runtime"') ||
     html.includes('id="hisabiq-sales-style"') ||
     html.includes('data-hisabiq-sales'))
    throw new Error('HisabIQ Sales UI already installed');
  const at=html.indexOf(SALES_PAGE);
  const end=html.indexOf('</section>',at+SALES_PAGE.length);
  if(end<0)throw new Error('Missing compiled Sales page closure');
  const page=html.slice(at,end);
  for(const id of REQUIRED_IDS){
    if(page.split('id="'+id+'"').length!==2)
      throw new Error('Original Sales contract missing or duplicate: '+id);
  }
  if(!page.includes('function smRender()') ||
     !page.includes('function smLoad()') ||
     !page.includes('getSalesManagementList') ||
     !page.includes('getSaleDetail'))
    throw new Error('Original Sales loader and invoice detail contract changed');
  if(/<\s*\/\s*style\b/i.test(stylesheet)||/<\s*\/\s*script\b/i.test(script))
    throw new Error('Unsafe compiled Sales UI asset closing marker');
  if(html.split('</head>').length!==2||html.split('</body>').length!==2)
    throw new Error('Ambiguous compiled HTML shell');
  return html.replace(SALES_PAGE,SALES_PAGE.slice(0,-1)+' data-hisabiq-sales>')
    .replace('</head>','<style id="hisabiq-sales-style">\n'+stylesheet+'\n</style></head>')
    .replace('</body>','<script id="hisabiq-sales-runtime">\n'+script+'\n</script></body>');
}
