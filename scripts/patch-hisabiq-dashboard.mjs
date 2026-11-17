/**
 * Compile-only HisabIQ dashboard surface injection.
 * Frozen GAS source files and their dashboard loader stay byte-identical.
 * No RPC, database, auth, or financial data path is created here.
 */
const DASHBOARD='<section class="page" id="page-dashboard" data-page="dashboard">';

export function patchHisabiqDashboard(html,template){
  if(typeof html!=='string' || typeof template!=='string')
    throw new TypeError('Expected compiled HTML and reviewed dashboard template');
  const count=html.split(DASHBOARD).length-1;
  if(count===0)return html; // Small standalone HtmlService include test fixture.
  if(count!==1)throw new Error('Ambiguous compiled source Dashboard boundary');
  if(html.includes('id="hisabiq-dashboard"'))
    throw new Error('Duplicate HisabIQ compiled dashboard');
  for(const id of ['dashSales','dashCollection','dashExpense','dashPurchase','dashDue',
    'dashPayable','dashBorrowerReceivable','dashOutstandingLoan','dashCash','dashLowStockCount']){
    if(html.split('id="'+id+'"').length!==2)
      throw new Error('Original dashboard source field changed: '+id);
  }
  if(!html.includes("serverCall('getDashboardStats', authToken)"))
    throw new Error('Original authenticated dashboard loader changed');
  const templateIds=['hisabiq-dashboard','hisabiq-dashboard-metrics',
    'hisabiq-dashboard-panels','hisabiq-dashboard-customize','hisabiq-dashboard-dialog'];
  for(const id of templateIds){
    if(template.split('id="'+id+'"').length!==2)
      throw new Error('New dashboard component missing or duplicate: '+id);
  }
  if(/<\?(?:!=|=)/.test(template))
    throw new Error('Unsafe templating in compiled dashboard');
  // Inline scripts execute as parsed: mount the UI before original source
  // markup, but execute the dashboard runtime only AFTER dashLoad and its
  // 10 source cells have been declared. This also makes observers attach.
  const runtimeMarker='<script id="hisabiq-dashboard-runtime">';
  const scriptAt=template.indexOf(runtimeMarker);
  if(scriptAt<0 || template.indexOf(runtimeMarker,scriptAt+1)!==-1)
    throw new Error('Missing or duplicate compiled dashboard runtime');
  const markup=template.slice(0,scriptAt);
  const runtime=template.slice(scriptAt);
  const dashboardAt=html.indexOf(DASHBOARD)+DASHBOARD.length;
  const closeAt=html.indexOf('</section>',dashboardAt);
  if(closeAt<0 || !html.slice(dashboardAt,closeAt).includes('function dashLoad()'))
    throw new Error('Original source Dashboard closure changed');
  return html.slice(0,dashboardAt)+'\n'+markup+'\n'+
    html.slice(dashboardAt,closeAt)+'\n'+runtime+'\n'+html.slice(closeAt);
}
