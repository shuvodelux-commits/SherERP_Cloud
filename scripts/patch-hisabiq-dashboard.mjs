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
  // The original dashboard loader calls the as-yet unsupported full
  // eleven-field getDashboardStats. The Owner source bridge already checks
  // the actual Control/Shop D1 identity, so the generic disconnected-Shop
  // toast is misleading in that *one* known missing-read case. Keep the
  // original GAS source immutable and every other RPC/error fail-closed.
  let sourceDashboard=html.slice(dashboardAt,closeAt);
  const good="return serverCall('getDashboardStats', authToken).then(function (d) {";
  const next=good+"\n      var notice=document.getElementById('hdb-data-readiness');"+
    " if(notice)notice.hidden=true;";
  const failed=".catch(function (err) { showToast(err.message, 'error'); });";
  const handled=`.catch(function (err) {
      var notice=document.getElementById('hdb-data-readiness');
      if(notice && err?.code === 'OWNER_RPC_UNAVAILABLE') {
        notice.hidden = false;
        return;
      }
      if(notice)notice.hidden = true;
      showToast(err.message, 'error');
    });`;
  if(sourceDashboard.split(good).length!==2||
     sourceDashboard.split(failed).length!==2||
     !markup.includes('id="hdb-data-readiness"'))
    throw new Error('Original dashboard read-failure boundary changed');
  sourceDashboard=sourceDashboard.replace(good,next).replace(failed,handled);
  return html.slice(0,dashboardAt)+'\n'+markup+'\n'+
    sourceDashboard+'\n'+runtime+'\n'+html.slice(closeAt);
}
