/**
 * M01 compiled-only original Reports Print safety.
 * UI presentation guard, NOT a server authority check or financial data source.
 * Installed before the original Reports inline script by the isolated patcher.
 */
(function () {
  'use strict';
  if (window.__m01ReportPrintState) return;

  const print = document.getElementById('rptPrintBtn');
  const from = document.getElementById('rptFrom');
  const to = document.getElementById('rptTo');
  if (!print || !from || !to) return;

  const periodTabs = new Set(['rptSales', 'rptPurchase', 'rptCashBank', 'rptProfit']);
  const snapshotTabs = new Set(['rptStock', 'rptBalanceSheet']);
  const completed = Object.create(null);
  const latest = Object.create(null);
  let epoch = 0;
  let sequence = 0;

  // Only compares client display epochs. M04 and M03 must independently
  // authenticate and authorize every eventual report RPC/data read.
  function actor() {
    try {
      if (typeof authToken !== 'string' || !authToken || !currentUser) return null;
      const overlay = document.getElementById('loginOverlay');
      if (overlay && !overlay.hidden) return null;
      const user = String(currentUser.id || currentUser.userId || currentUser.mobile || '').trim();
      const tenant = String(currentUser.tenantId || currentUser.businessId ||
        currentUser.shopId || currentUser.organizationId || '').trim();
      const label = document.getElementById('shopNameLabel');
      const legacyShop = String(label && label.textContent || '').trim();
      const shop = tenant ? 'tenant:' + tenant : legacyShop ? 'legacy:' + legacyShop : '';
      return user && shop ? {token:authToken, user, shop} : null;
    } catch {
      return null;
    }
  }
  function sameActor(a, b) {
    return !!a && !!b && a.token === b.token && a.user === b.user && a.shop === b.shop;
  }
  function dateValid(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (!year || month < 1 || month > 12) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const max = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= max[month - 1];
  }
  function datesCurrent() {
    return dateValid(from.value) && dateValid(to.value) && from.value <= to.value;
  }
  function loadedState() {
    return typeof rptState !== 'undefined' && rptState && rptState.loaded;
  }
  function isLatest(ticket) {
    return !!ticket && latest[ticket.tab] === ticket;
  }
  function isCurrent(tab) {
    if ((!periodTabs.has(tab) && !snapshotTabs.has(tab)) || !loadedState()) return false;
    const ticket = completed[tab];
    if (!ticket || !isLatest(ticket) || rptState.loaded[tab] !== true ||
      !sameActor(ticket.actor, actor())) return false;
    if (periodTabs.has(tab)) {
      if (!datesCurrent() || ticket.epoch !== epoch ||
        ticket.from !== from.value || ticket.to !== to.value) return false;
    }
    return true;
  }
  function refresh() {
    const allowed = isCurrent(typeof rptState === 'undefined' ? '' : rptState.activeTab);
    print.disabled = !allowed;
    print.title = allowed ? 'Print the loaded report' :
      'Load the current report successfully before printing';
    return allowed;
  }
  function start(tab) {
    const ticket = {
      tab, id:++sequence, epoch, actor:actor(),
      from:from.value, to:to.value
    };
    latest[tab] = ticket;
    delete completed[tab];
    if (loadedState()) rptState.loaded[tab] = false;
    refresh();
    return ticket;
  }
  function complete(ticket) {
    if (!isLatest(ticket)) {
      // An older loader can have painted stale rows before its promise
      // resolved. Fail closed even if a newer request had completed.
      if (ticket && completed[ticket.tab]) delete completed[ticket.tab];
      if (ticket && loadedState()) rptState.loaded[ticket.tab] = false;
      refresh();
      return false;
    }
    if (!sameActor(ticket.actor, actor()) ||
      (periodTabs.has(ticket.tab) &&
        (ticket.epoch !== epoch || !datesCurrent() ||
         ticket.from !== from.value || ticket.to !== to.value))) {
      delete completed[ticket.tab];
      return false;
    }
    completed[ticket.tab] = ticket;
    return true;
  }
  function fail(ticket) {
    if (isLatest(ticket)) {
      delete completed[ticket.tab];
      if (loadedState()) rptState.loaded[ticket.tab] = false;
    }
    refresh();
  }
  function invalidate(all) {
    epoch++;
    const tabs = all
      ? [...periodTabs, ...snapshotTabs]
      : [...periodTabs];
    for (const tab of tabs) {
      delete latest[tab];
      delete completed[tab];
      if (loadedState()) rptState.loaded[tab] = false;
    }
    refresh();
  }

  // The original button has a bubbling print handler. A capture-phase
  // negative gate blocks empty/stale output even if another handler re-enables
  // the button. This never grants permission to fetch financial information.
  print.disabled = true;
  print.addEventListener('click', event => {
    if (refresh()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  for (const control of [from, to]) {
    control.addEventListener('input', () => invalidate(false));
    control.addEventListener('change', () => invalidate(false));
  }
  for (const id of ['rptRunBtn', 'rptTodayBtn', 'rptMonthBtn']) {
    const button = document.getElementById(id);
    if (button) button.addEventListener('click', () => invalidate(true), true);
  }
  document.querySelectorAll('#page-reports .tab-btn').forEach(button => {
    button.addEventListener('click', () => Promise.resolve().then(refresh));
  });
  document.addEventListener('DOMContentLoaded', refresh);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  const overlay = document.getElementById('loginOverlay');
  if (overlay && typeof MutationObserver === 'function') {
    new MutationObserver(refresh).observe(overlay, {
      attributes:true, attributeFilter:['hidden']
    });
  }

  window.__m01ReportPrintState = Object.freeze({
    start, complete, fail, isLatest, isCurrent, refresh
  });
})();