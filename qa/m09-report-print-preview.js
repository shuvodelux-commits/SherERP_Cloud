/* M09 test-browser-only interaction preview.
 * NOT DEPLOYED: not imported by app code, patch scripts, or Worker.
 * Caller must wire real authenticated successful report lifecycle separately.
 */
(()=>{
  'use strict';
  const periods=['rptSales','rptPurchase','rptCashBank','rptProfit'];
  const successful=new Map();
  const pending=new Set();
  const from=document.getElementById('rptFrom');
  const to=document.getElementById('rptTo');
  const print=document.getElementById('rptPrintBtn');

  function invalidatePeriodCache(){
    for(const id of periods){
      // In real M01 wiring, also clear period totals/display or show stale
      // status; this preview never claims financial data is refreshed.
      rptState.loaded[id]=false;
    }
  }
  for(const input of [from,to]){
    input.addEventListener('input',invalidatePeriodCache);
    input.addEventListener('change',invalidatePeriodCache);
  }

  const state=()=>{
    const id=rptState.activeTab;
    const last=successful.get(id);
    return window.__m09Inspect({
      activeTab:id,
      reportLoaded:rptState.loaded[id]===true && last!==undefined,
      requestPending:pending.has(id),
      from:from.value,
      to:to.value,
      loadedFrom:last?.from??'',
      loadedTo:last?.to??''
    });
  };

  // Only the test fixture calls this, after a synthetic successful loader.
  // No browser/client user action can grant real server authority via this.
  window.__m09PreviewMarkLoaded=(id)=>{
    successful.set(id,{from:from.value,to:to.value});
    rptState.loaded[id]=true;
  };
  window.__m09PreviewSetPending=(id,value)=>{
    if(value)pending.add(id);else pending.delete(id);
  };
  window.__m09PreviewStatus=()=>state().status;

  // Capture-phase interception prevents the original bubbling Print listener
  // from printing an empty, pending, or stale synthetic report.
  print.addEventListener('click',event=>{
    let allowed=false;
    try{allowed=state().printPreviewEligible===true;}catch{allowed=false;}
    if(!allowed){
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  },true);
})();
