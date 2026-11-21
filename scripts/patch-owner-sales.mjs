// Preserve the frozen Sales screen for GAS and patch only the private Owner build.
export function patchOwnerSales(html){
  const start='  function smLoad() {';
  const end='  function smRender() {';
  const first=html.indexOf(start), last=html.indexOf(end,first);
  if(first<0||last<0||html.indexOf(start,first+start.length)!==-1)
    throw new Error('Original Sales loader boundary changed');
  const load=`  var ownerSalesLoadInFlight;

  function smLoad() {
    if (ownerSalesLoadInFlight) return ownerSalesLoadInFlight;
    var status = document.getElementById('owner-sales-status');
    status.hidden = false;
    status.textContent = 'Loading invoices…';
    smState._loaded = false;
    smState.sales = [];
    smState.showProfit = false;
    document.getElementById('smProfitHeader').style.display = 'none';
    smRender();
    ownerSalesLoadInFlight = withLoader(serverCall("getSalesManagementList", authToken))
      .then(function (sales) {
        smState.sales = sales;
        smState.showProfit = sales.some(function (sale) { return Object.hasOwn(sale, 'profit'); });
        smState._loaded = true;
        document.getElementById('smProfitHeader').style.display = smState.showProfit ? '' : 'none';
        smRender();
        status.hidden = true;
        status.textContent = '';
      })
      .catch(function (error) {
        status.textContent = error.message;
      })
      .finally(function () { ownerSalesLoadInFlight = null; });
    return ownerSalesLoadInFlight;
  }

`;
  html=html.slice(0,first)+load+html.slice(last);
  const replacements=[
    ['<div class="empty-state" id="smEmpty" hidden>',
      '<p class="empty-state" id="owner-sales-status" role="status" hidden></p>\n  <div class="empty-state" id="smEmpty" hidden>'],
    ['    document.getElementById("smEmpty").hidden = rows.length > 0;',
      `    var empty = document.getElementById("smEmpty");
    empty.hidden = !smState._loaded || rows.length > 0;
    empty.textContent = smState.sales.length ? 'No sales match these filters.' : 'No invoices have been saved in this Shop.';`],
    ['      if (key === "sales" && !smState._loaded) {\n        smState._loaded = true;',
      '      if (key === "sales" && !document.getElementById("page-sales").hidden && !smState._loaded) {'],
    ["        { action: 'edit', label: 'Edit', disabled: !row.editable, title: row.editable ? '' : 'This invoice is no longer available for editing' },\n        { action: 'receive-payment', label: 'Receive Payment', hidden: !row.customerId || Number(row.dueAmount) <= 0.004 },\n        { action: 'return', label: 'Sales Return' },\n        { divider: true },\n        { action: 'delete', label: 'Delete', danger: true }",
      "        { action: 'return', label: 'Sales Return', hidden: !ownerSalesReturnEnabled || row.returnStatus === 'Fully Returned' }"],
    ['id="smViewDeleteBtn"', 'id="smViewDeleteBtn" hidden style="display:none!important"'],
    ['          inv.dueAmount > 0 ? "inline-flex" : "none";',
      `          'none';
        document.getElementById('smViewReturnBtn').hidden = !ownerSalesReturnEnabled ||
          inv.returnStatus === 'Fully Returned';`],
  ];
  for(const [original,updated] of replacements){
    if(html.split(original).length!==2)throw new Error('Original Owner Sales screen boundary changed: '+original);
    html=html.replace(original,updated);
  }
  return html.replace('</head>', `<style>
@media (max-width: 540px) {
  #smTableScroll .mobile-card-table tbody td:nth-last-child(2) {
    grid-column: 1 / -1;
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  #smTableScroll .mobile-card-table tbody td:nth-last-child(2) .badge {
    white-space: nowrap;
  }
}
</style></head>`);
}
