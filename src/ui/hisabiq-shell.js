/* HisabIQ shell interactions, compiled-only. Original SherERP navigation and
   permissions remain the source of truth. No network, routes or auth added. */
(function () {
  'use strict';
  if (typeof buildNav_ !== 'function' || typeof goToPage !== 'function'
      || typeof setSidebarCollapsed_ !== 'function') return;

  var nativeBuildNav = buildNav_;
  var nativeGoToPage = goToPage;
  var nativeSetSidebarCollapsed = setSidebarCollapsed_;
  var referenceCollapsedKey = 'hisabiq:sidebar-collapsed';
  var groups = [];
  var openedGroup = '';
  var drawer = null;
  var drawerPanel = null;
  var previousFocus = null;
  var previousBodyOverflow = '';
  var drawerCloseTimer = null;

  var sectionNames = {
    0: ['Workspace', 'কাজের জায়গা'],
    1: ['Business', 'ব্যবসা'],
    2: ['Business', 'ব্যবসা'],
    3: ['Business', 'ব্যবসা'],
    4: ['Money & Accounts', 'টাকা ও হিসাব'],
    5: ['Manage', 'পরিচালনা'],
    6: ['Manage', 'পরিচালনা']
  };
  var chevron = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
    + '<path d="m9 18 6-6-6-6" fill="none" stroke="currentColor"'
    + ' stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function desktop() { return window.matchMedia('(min-width:1024px)').matches; }
  function reducedMotion() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function storageRead(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }
  function storageWrite(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* optional */ }
  }
  function activeGroupKey() {
    var active = typeof navGroupFor_ === 'function' ? navGroupFor_(currentPage) : null;
    return active ? active.key : currentPage;
  }
  function childrenFor(item) {
    return (item.children || []).filter(function (child) {
      return typeof subNavVisible_ === 'function' && subNavVisible_(child, item.key);
    });
  }
  function currentInitials() {
    var shop = document.getElementById('shopNameLabel');
    var words = shop ? (shop.textContent || '').trim().split(/\s+/).slice(0, 2) : [];
    return words.map(function (part) { return (part[0] || '').toUpperCase(); }).join('') || 'HS';
  }
  function makeButton(className, label) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    if (label) button.setAttribute('aria-label', label);
    return button;
  }
  function renderNavigation(host, items, mobile) {
    if (!host) return;
    host.replaceChildren();
    var ordered = typeof sidebarItemsInOrder_ === 'function'
      ? sidebarItemsInOrder_(items) : (items || []).slice();
    var lastSection = '';
    var sectionBody = null;
    ordered.forEach(function (item) {
      var groupNumber = Number(item.sidebarGroup);
      var section = sectionNames[groupNumber] || ['Workspace', 'কাজের জায়গা'];
      if (section[0] !== lastSection) {
        lastSection = section[0];
        var wrapper = document.createElement('section');
        wrapper.className = 'h-shell-section';
        var heading = document.createElement('span');
        heading.className = 'h-shell-section-label';
        heading.textContent = section[0];
        heading.title = section[1];
        var list = document.createElement('div');
        list.className = 'h-shell-section-items';
        wrapper.appendChild(heading);
        wrapper.appendChild(list);
        host.appendChild(wrapper);
        sectionBody = list;
      }
      var children = childrenFor(item);
      var parent = document.createElement('div');
      parent.className = 'h-shell-group';
      parent.dataset.navGroup = item.key;
      var main = makeButton('nav-item', item.label);
      main.dataset.page = item.key;
      main.title = item.label;
      main.innerHTML = ICONS[item.icon || item.key] || '';
      var text = document.createElement('span');
      text.className = 'nav-item-text';
      var label = document.createElement('span');
      label.textContent = item.label;
      text.appendChild(label);
      if (item.bn) {
        var hint = document.createElement('span');
        hint.className = 'bn-hint';
        hint.textContent = item.bn;
        text.appendChild(hint);
      }
      main.appendChild(text);
      if (children.length > 1) {
        var caret = document.createElement('span');
        caret.className = 'h-shell-chevron';
        caret.innerHTML = chevron;
        main.appendChild(caret);
      }
      var nested = null;
      if (children.length > 1) {
        nested = document.createElement('div');
        nested.className = 'h-shell-children';
        nested.hidden = true;
        nested.id = (mobile ? 'h-shell-m-' : 'h-shell-d-') + item.key.replace(/[^a-z0-9_-]/gi, '');
        main.setAttribute('aria-controls', nested.id);
        main.setAttribute('aria-expanded', 'false');
        children.forEach(function (child) {
          var sub = makeButton('h-shell-child', child.label);
          sub.dataset.navChild = child.key;
          sub.textContent = child.label;
          if (child.bn) {
            var bn = document.createElement('span');
            bn.className = 'bn-hint';
            bn.textContent = child.bn;
            sub.appendChild(bn);
          }
          sub.addEventListener('click', function () { goToPage(child.key); });
          nested.appendChild(sub);
        });
      }
      main.addEventListener('click', function () {
        if (desktop() && !mobile && document.getElementById('app').classList.contains('sidebar-collapsed')) {
          setSidebarCollapsed_(false, true);
          openedGroup = item.key;
          goToPage(typeof navLandingKey_ === 'function' ? navLandingKey_(item) : item.key);
          return;
        }
        if (children.length > 1 && activeGroupKey() === item.key && openedGroup === item.key) {
          openedGroup = '';
          syncNavState();
          return;
        }
        openedGroup = item.key;
        goToPage(typeof navLandingKey_ === 'function' ? navLandingKey_(item) : item.key);
      });
      parent.appendChild(main);
      if (nested) parent.appendChild(nested);
      sectionBody.appendChild(parent);
    });
    syncNavState();
  }

  function syncNavState() {
    var selected = activeGroupKey();
    document.querySelectorAll('#navList .h-shell-group, #h-shell-drawer-nav .h-shell-group').forEach(function (group) {
      var groupActive = group.dataset.navGroup === selected;
      var expanded = groupActive && openedGroup === selected;
      var main = group.querySelector('.nav-item');
      var nested = group.querySelector('.h-shell-children');
      group.dataset.open = expanded ? 'true' : 'false';
      if (main) {
        main.classList.toggle('active', groupActive);
        if (groupActive) main.setAttribute('aria-current', 'page');
        else main.removeAttribute('aria-current');
        if (nested) main.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      }
      if (nested) nested.hidden = !expanded;
      group.querySelectorAll('.h-shell-child').forEach(function (child) {
        var active = child.dataset.navChild === currentPage;
        child.classList.toggle('active', active);
        if (active) child.setAttribute('aria-current', 'page');
        else child.removeAttribute('aria-current');
      });
    });
  }

  function syncCollapseButton() {
    var app = document.getElementById('app');
    var trigger = document.getElementById('sidebarCollapseBtn');
    var collapsed = !!app && app.classList.contains('sidebar-collapsed');
    if (trigger) {
      trigger.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
      trigger.setAttribute('title', collapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)');
      trigger.setAttribute('aria-expanded', String(!collapsed));
    }
    var menu = document.getElementById('menuToggle');
    if (menu && !drawer?.classList.contains('is-open')) {
      menu.setAttribute('aria-expanded', String(desktop() ? !collapsed : false));
    }
  }

  setSidebarCollapsed_ = function (collapsed, persist) {
    nativeSetSidebarCollapsed(collapsed, persist);
    if (persist !== false) storageWrite(referenceCollapsedKey, String(!!collapsed));
    syncCollapseButton();
    syncNavState();
  };
  restoreSidebarState_ = function () {
    var saved = storageRead(referenceCollapsedKey);
    if (saved === null) saved = storageRead('hwerp.sidebar.collapsed.v1') === '1' ? 'true' : 'false';
    // HisabIQ defaults to expanded; prior SherERP preference remains respected.
    setSidebarCollapsed_(saved === 'true', false);
  };
  collapseSidebarOverlay_ = function () {
    // The reference sidebar is in normal layout flow, not a desktop overlay.
    if (!desktop()) closeDrawer();
  };
  goToPage = function (key) {
    var result = nativeGoToPage(key);
    openedGroup = activeGroupKey();
    syncNavState();
    closeDrawer();
    return result;
  };
  buildNav_ = function (items) {
    // These are the original approved, permission-filtered NAV_ITEMS.
    // subNavVisible_ is called again for every child, not replaced.
    var visible = typeof filterNavByRole_ === 'function'
      ? filterNavByRole_(items || []) : (items || []);
    groups = visible.slice();
    nativeBuildNav(visible);
    if (!openedGroup) openedGroup = activeGroupKey();
    renderNavigation(document.getElementById('navList'), groups, false);
    renderNavigation(document.getElementById('h-shell-drawer-nav'), groups, true);
  };

  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove('is-open');
    var menu = document.getElementById('menuToggle');
    if (menu) menu.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = previousBodyOverflow;
    document.removeEventListener('keydown', onDrawerKeydown, true);
    if (drawerCloseTimer) window.clearTimeout(drawerCloseTimer);
    var focus = previousFocus;
    previousFocus = null;
    if (focus && focus.isConnected) focus.focus({preventScroll:true});
    if (reducedMotion()) drawer.hidden = true;
    else drawerCloseTimer = window.setTimeout(function () { drawer.hidden = true; }, 220);
  }
  function openDrawer() {
    if (desktop()) return;
    var app = document.getElementById('app');
    if (!app || getComputedStyle(app).visibility === 'hidden') return;
    if (typeof closeMobileMore_ === 'function') closeMobileMore_();
    if (!drawer) return;
    if (drawerCloseTimer) window.clearTimeout(drawerCloseTimer);
    if (!groups.length && typeof filterNavByRole_ === 'function') {
      groups = filterNavByRole_(navItems_ || []);
    }
    renderNavigation(document.getElementById('h-shell-drawer-nav'), groups, true);
    var user = document.getElementById('logoutBtn');
    var drawerLogout = document.getElementById('h-shell-drawer-logout');
    if (drawerLogout) drawerLogout.hidden = !user;
    var business = document.getElementById('shopNameLabel');
    var drawerBusiness = document.getElementById('h-shell-drawer-business');
    if (drawerBusiness) drawerBusiness.textContent = business ? business.textContent : 'Business';
    previousFocus = document.activeElement;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer.hidden = false;
    window.requestAnimationFrame(function () { drawer.classList.add('is-open'); });
    document.getElementById('menuToggle')?.setAttribute('aria-expanded','true');
    document.addEventListener('keydown', onDrawerKeydown, true);
    document.getElementById('h-shell-drawer-close')?.focus({preventScroll:true});
  }
  function onDrawerKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab' || !drawerPanel) return;
    var nodes = Array.from(drawerPanel.querySelectorAll('button:not([disabled]):not([hidden]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return !!el.getClientRects().length; });
    if (!nodes.length) return;
    var first = nodes[0], last = nodes[nodes.length-1];
    if (event.shiftKey && (document.activeElement === first || !drawerPanel.contains(document.activeElement))) {
      event.preventDefault();last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !drawerPanel.contains(document.activeElement))) {
      event.preventDefault();first.focus();
    }
  }
  function makeDrawer() {
    drawer = document.createElement('div');
    drawer.id = 'hisabiqMobileDrawer';
    drawer.className = 'h-shell-drawer';
    drawer.hidden = true;
    // aria-modal stays on the panel, not on its invisible backdrop.
    drawer.innerHTML =
      '<button type="button" class="h-shell-drawer-backdrop" aria-label="Close navigation"></button>'
      + '<aside class="h-shell-drawer-panel" id="erp-mobile-drawer" role="dialog" aria-modal="true" aria-label="ERP navigation">'
      + '  <div class="h-shell-drawer-header"><span class="h-shell-drawer-title">SherERP</span>'
      + '    <button type="button" class="h-shell-drawer-close" id="h-shell-drawer-close" aria-label="Close navigation">'
      + '      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
      + '    </button></div>'
      + '  <nav class="h-shell-drawer-nav" id="h-shell-drawer-nav" aria-label="Mobile ERP navigation"></nav>'
      + '  <div class="h-shell-drawer-footer"><strong id="h-shell-drawer-business">Business</strong>'
      + '    <button type="button" id="h-shell-drawer-logout" hidden>Sign out</button>'
      + '  </div>'
      + '</aside>';
    document.body.appendChild(drawer);
    drawerPanel = drawer.querySelector('.h-shell-drawer-panel');
    drawer.querySelector('.h-shell-drawer-backdrop').addEventListener('click', closeDrawer);
    drawer.querySelector('#h-shell-drawer-close').addEventListener('click', closeDrawer);
    drawer.querySelector('#h-shell-drawer-logout').addEventListener('click', function () {
      closeDrawer();
      document.getElementById('logoutBtn')?.click();
    });
    var startX = null;
    drawerPanel.addEventListener('touchstart', function (event) {
      startX = event.touches.length === 1 ? event.touches[0].clientX : null;
    }, {passive:true});
    drawerPanel.addEventListener('touchend', function (event) {
      if (startX !== null && event.changedTouches.length === 1 &&
          event.changedTouches[0].clientX - startX < -80) closeDrawer();
      startX = null;
    }, {passive:true});
  }
  function installChrome() {
    var app = document.getElementById('app');
    var header = document.querySelector('#sidebar .sidebar-header');
    var brandMark = document.getElementById('logoMark');
    var businessName = document.getElementById('shopNameLabel');
    var nav = document.getElementById('navList');
    var trigger = document.getElementById('sidebarCollapseBtn');
    var menuToggle = document.getElementById('menuToggle');
    if (!app || !header || !nav || !brandMark || !businessName || !trigger || !menuToggle) return;
    app.setAttribute('data-hisabiq-shell', '');
    document.getElementById('sidebar').setAttribute('data-sidebar','sidebar');
    nav.setAttribute('aria-label','Main');
    var brand = document.createElement('div');
    brand.className = 'h-shell-brand';
    var word = document.createElement('span');
    word.className = 'h-shell-brand-name';
    word.innerHTML = 'Sher<strong>ERP</strong>';
    brand.appendChild(brandMark);
    brand.appendChild(word);
    header.prepend(brand);
    var business = document.createElement('div');
    business.className = 'h-shell-business';
    var initials = document.createElement('span');
    initials.className = 'h-shell-business-initials';
    var copy = document.createElement('span');
    copy.className = 'h-shell-business-copy';
    var branch = document.createElement('span');
    branch.className = 'h-shell-business-branch';
    branch.textContent = 'Main branch · Dhaka';
    copy.appendChild(businessName);
    copy.appendChild(branch);
    business.appendChild(initials);
    business.appendChild(copy);
    nav.parentNode.insertBefore(business,nav);
    var updateName = function () {
      initials.textContent = currentInitials();
      business.title = businessName.textContent || 'Business';
    };
    new MutationObserver(updateName).observe(businessName,{characterData:true,childList:true,subtree:true});
    updateName();

    // Preserve the original collapse handler; only replace its static icon.
    trigger.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'
      + '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>'
      + '<path d="M9 4v16" stroke="currentColor" stroke-width="1.7"/></svg>';
    trigger.setAttribute('aria-controls','sidebar');
    trigger.addEventListener('click',function (event) {
      // Original button only collapses. Capture for two-way toggle.
      event.preventDefault();event.stopImmediatePropagation();
      setSidebarCollapsed_(!app.classList.contains('sidebar-collapsed'),true);
    },true);
    menuToggle.setAttribute('aria-label','Open ERP navigation');
    menuToggle.setAttribute('aria-controls','erp-mobile-drawer');
    menuToggle.addEventListener('click',function (event) {
      if (desktop()) return;
      event.preventDefault();event.stopImmediatePropagation();
      openDrawer();
    },true);
    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && desktop()) {
        event.preventDefault();
        setSidebarCollapsed_(!app.classList.contains('sidebar-collapsed'),true);
      }
    });
    window.addEventListener('resize',function () { if (desktop()) closeDrawer(); });
    syncCollapseButton();
  }

  // Legacy script registers DOMContentLoaded before this one, so its session,
  // navigation, dates and business logic initialize unchanged.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',function () {
      makeDrawer();
      installChrome();
      syncNavState();
    });
  } else {
    makeDrawer();installChrome();syncNavState();
  }
})();
