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
  var previousAppInert = false;
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

  // Owner Party is an existing additive module that installs its own
  // permission-aware navigation button after the shared sidebar has rendered.
  // Mirror that *existing* button into the drawer; do not invent a Party route,
  // grant or API. Keep its original click handler as the authority.
  function syncExternalOwnerNav() {
    var sidebar = document.getElementById('navList');
    if (!sidebar) return;
    var source = sidebar.querySelector('[data-page="hisabiqParties"]');
    if (!source) return;
    var business = Array.from(sidebar.querySelectorAll('.h-shell-section')).find(function (section) {
      return section.querySelector('.h-shell-section-label')?.textContent === 'Business';
    });
    var businessRows = business?.querySelector('.h-shell-section-items');
    if (businessRows && source.parentElement !== businessRows) businessRows.appendChild(source);
    if (!source.querySelector('svg')) {
      var icon = document.createElement('span');
      icon.className = 'h-shell-external-icon';
      icon.innerHTML = ICONS.customers || '';
      source.prepend(icon);
    }
    var drawerNav = document.getElementById('h-shell-drawer-nav');
    if (!drawerNav || drawerNav.querySelector('[data-page="hisabiqParties"]')) return;
    var drawerBusiness = Array.from(drawerNav.querySelectorAll('.h-shell-section')).find(function (section) {
      return section.querySelector('.h-shell-section-label')?.textContent === 'Business';
    });
    var destination = drawerBusiness?.querySelector('.h-shell-section-items');
    if (!destination) {
      var section = document.createElement('section');
      section.className = 'h-shell-section';
      var heading = document.createElement('span');
      heading.className = 'h-shell-section-label';
      heading.textContent = 'Business';
      destination = document.createElement('div');
      destination.className = 'h-shell-section-items';
      section.append(heading, destination);
      drawerNav.appendChild(section);
    }
    var button = makeButton('nav-item', 'Parties & Ledger');
    button.dataset.page = 'hisabiqParties';
    button.innerHTML = (ICONS.customers || '') +
      '<span class="nav-item-text"><span>Parties & Ledger</span></span>';
    button.addEventListener('click', function () {
      source.click();
      closeDrawer();
      button.classList.add('active');
      button.setAttribute('aria-current', 'page');
    });
    destination.appendChild(button);
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
    syncHeaderControls();
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
    syncHeaderControls();
  };

  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    var app = document.getElementById('app');
    if (app) app.inert = previousAppInert;
    drawer.classList.remove('is-open');
    var menu = document.getElementById('menuToggle');
    if (menu) menu.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = previousBodyOverflow;
    document.removeEventListener('keydown', onDrawerKeydown, true);
    if (drawerCloseTimer) window.clearTimeout(drawerCloseTimer);
    var focus = previousFocus;
    previousFocus = null;
    var login = document.getElementById('loginOverlay');
    if (focus && focus.isConnected && app && getComputedStyle(app).visibility !== 'hidden'
        && (!login || login.hidden)) focus.focus({preventScroll:true});
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
    syncExternalOwnerNav();
    var user = document.getElementById('logoutBtn');
    var drawerLogout = document.getElementById('h-shell-drawer-logout');
    if (drawerLogout) drawerLogout.hidden = !user;
    var business = document.getElementById('shopNameLabel');
    var drawerBusiness = document.getElementById('h-shell-drawer-business');
    if (drawerBusiness) drawerBusiness.textContent = business ? business.textContent : 'Business';
    previousFocus = document.activeElement;
    previousBodyOverflow = document.body.style.overflow;
    previousAppInert = app.inert;
    document.body.style.overflow = 'hidden';
    app.inert = true;
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
    // Own every Tab event while the modal is open. Relying on native DOM tab
    // order between the first and last controls occasionally reaches the
    // backdrop/outside the dialog in Chromium during responsive reflow.
    event.preventDefault();
    event.stopPropagation();
    var nodes = Array.from(drawerPanel.querySelectorAll('button:not([disabled]):not([hidden]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(function (el) { return !!el.getClientRects().length; });
    if (!nodes.length) {
      document.getElementById('h-shell-drawer-close')?.focus({preventScroll:true});
      return;
    }
    var current = nodes.indexOf(document.activeElement);
    var next = event.shiftKey
      ? (current <= 0 ? nodes.length - 1 : current - 1)
      : (current < 0 || current >= nodes.length - 1 ? 0 : current + 1);
    nodes[next].focus({preventScroll:true});
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
  // Reference-style topbar actions; the only navigation source is the
  // already-filtered SherERP NAV_ITEMS. Never query business data or bypass
  // the original confirm-and-revoke sign-out workflow.
  function syncHeaderControls() {
    var sale = document.getElementById('h-shell-new-sale');
    var pos = groups.find(function (item) { return item.key === 'pos'; });
    if (sale) sale.hidden = !pos;
    var user = document.getElementById('h-shell-user-trigger');
    var display = document.getElementById('h-shell-user-name');
    var avatar = document.getElementById('h-shell-user-avatar');
    var detail = document.getElementById('h-shell-user-detail');
    var role = document.getElementById('h-shell-user-role');
    var settings = document.getElementById('h-shell-menu-settings');
    var name = currentUser && (currentUser.name || currentUser.mobile) || '';
    if (user) user.hidden = !currentUser;
    if (display) display.textContent = name;
    if (detail) detail.textContent = name;
    if (role) role.textContent = currentUser && currentUser.role || '';
    if (avatar) {
      avatar.textContent = name ? name.trim().split(/\s+/).slice(0,2)
        .map(function (part) { return part[0] || ''; }).join('').toUpperCase() : 'U';
    }
    if (settings) settings.hidden = !groups.some(function (item) { return item.key === 'settings'; });
    var search = document.getElementById('h-shell-search-input');
    if (search && search.value) search.dispatchEvent(new Event('input'));
  }

  function installTopbarControls() {
    var bar = document.querySelector('#app .topbar');
    var date = document.getElementById('topbarDate');
    if (!bar || !date || document.getElementById('h-shell-search-input')) return;
    var search = document.createElement('div');
    search.className = 'h-shell-search';
    search.innerHTML =
      '<svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">'
      + '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/>'
      + '<path d="m16 16 5 5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
      + '<input id="h-shell-search-input" type="search" autocomplete="off" role="combobox"'
      + ' aria-label="Search available ERP modules" aria-autocomplete="list" aria-expanded="false"'
      + ' aria-controls="h-shell-search-results" placeholder="Search modules…">'
      + '<kbd>Ctrl K</kbd>'
      + '<div id="h-shell-search-results" role="listbox" aria-label="Matching modules" hidden></div>';
    bar.insertBefore(search,date);
    var input = search.querySelector('input');
    var results = search.querySelector('#h-shell-search-results');
    function closeSearch() {
      results.replaceChildren();
      results.hidden = true;
      input.setAttribute('aria-expanded','false');
    }
    function renderSearch() {
      var term = input.value.trim().toLowerCase();
      closeSearch();
      if (!term) return;
      var candidates = [];
      groups.forEach(function (group) {
        candidates.push({label:group.label,key:navLandingKey_(group)});
        childrenFor(group).forEach(function (child) {
          candidates.push({label:group.label+' · '+child.label,key:child.key});
        });
      });
      var added = new Set();
      candidates.filter(function (option) {
        return option.label.toLowerCase().includes(term) && !added.has(option.key);
      }).slice(0,8).forEach(function (option) {
        added.add(option.key);
        var button = makeButton('h-shell-search-result',option.label);
        button.setAttribute('role','option');
        button.dataset.target = option.key;
        button.textContent = option.label;
        button.addEventListener('click',function () {
          goToPage(option.key);
          input.value = '';
          closeSearch();
        });
        results.appendChild(button);
      });
      if (!results.childElementCount) {
        var empty = document.createElement('p');
        empty.className = 'h-shell-search-empty';
        empty.textContent = 'No available modules found';
        results.appendChild(empty);
      }
      results.hidden = false;
      input.setAttribute('aria-expanded','true');
    }
    input.addEventListener('input',renderSearch);
    input.addEventListener('keydown',function (event) {
      if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
      if (event.key === 'ArrowDown') {
        var first = results.querySelector('button');
        if (first && !results.hidden) { event.preventDefault(); first.focus(); }
      }
      if (event.key === 'Enter' && !results.hidden) {
        var firstResult = results.querySelector('button');
        if (firstResult) { event.preventDefault(); firstResult.click(); }
      }
    });
    results.addEventListener('keydown',function (event) {
      if (event.key === 'Escape') {
        event.preventDefault(); closeSearch(); input.focus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        var options = Array.from(results.querySelectorAll('button'));
        var index = options.indexOf(document.activeElement);
        var delta = event.key === 'ArrowDown' ? 1 : -1;
        if (options.length) {
          event.preventDefault();
          options[(index+delta+options.length)%options.length].focus();
        }
      }
    });
    var sale = makeButton('h-shell-new-sale','New sale');
    sale.id = 'h-shell-new-sale';
    sale.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
      + '<span>New sale</span>';
    sale.hidden = true;
    sale.addEventListener('click',function () {
      var pos = groups.find(function (item) { return item.key === 'pos'; });
      if (pos) goToPage(navLandingKey_(pos));
    });
    bar.insertBefore(sale,date);
    var menu = document.createElement('div');
    menu.className = 'h-shell-user';
    menu.innerHTML = '<button type="button" id="h-shell-user-trigger" aria-label="User menu"'
      + ' aria-haspopup="menu" aria-expanded="false" aria-controls="h-shell-user-popover" hidden>'
      + '<span id="h-shell-user-avatar" class="h-shell-user-avatar">U</span>'
      + '<span id="h-shell-user-copy"><strong id="h-shell-user-name"></strong>'
      + '<small id="h-shell-user-role"></small></span>'
      + '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
      + '</button><div id="h-shell-user-popover" role="menu" hidden>'
      + '<strong id="h-shell-user-detail"></strong>'
      + '<button id="h-shell-menu-settings" type="button" role="menuitem" hidden>Business settings</button>'
      + '<button id="h-shell-menu-signout" type="button" role="menuitem">Sign out</button>'
      + '</div>';
    bar.appendChild(menu);
    var userTrigger = menu.querySelector('#h-shell-user-trigger');
    var popover = menu.querySelector('#h-shell-user-popover');
    function closeUser(restoreFocus) {
      if (popover.hidden) return;
      popover.hidden = true;
      userTrigger.setAttribute('aria-expanded','false');
      if (restoreFocus) userTrigger.focus({preventScroll:true});
    }
    function visibleMenuItems() {
      return Array.from(popover.querySelectorAll('[role="menuitem"]'))
        .filter(function (item) { return !item.hidden && !item.disabled && !!item.getClientRects().length; });
    }
    userTrigger.addEventListener('click',function () {
      var open = popover.hidden;
      popover.hidden = !open;
      userTrigger.setAttribute('aria-expanded',String(open));
      if (open) visibleMenuItems()[0]?.focus({preventScroll:true});
    });
    popover.addEventListener('keydown',function (event) {
      if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      var options = visibleMenuItems();
      if (!options.length) return;
      event.preventDefault();
      var index = options.indexOf(document.activeElement);
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = options.length - 1;
      else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[index].focus({preventScroll:true});
    });
    menu.querySelector('#h-shell-menu-settings').addEventListener('click',function () {
      closeUser(false);
      var group = groups.find(function (item) { return item.key === 'settings'; });
      if (group) goToPage(navLandingKey_(group));
    });
    menu.querySelector('#h-shell-menu-signout').addEventListener('click',function () {
      closeUser(false);
      document.getElementById('logoutBtn')?.click();
    });
    document.addEventListener('click',function (event) {
      if (!menu.contains(event.target)) closeUser(false);
      if (!search.contains(event.target)) closeSearch();
    });
    document.addEventListener('keydown',function (event) {
      if ((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='k' &&
          desktop() && !event.altKey) {
        event.preventDefault();input.focus();input.select();
      }
      if (event.key === 'Escape' && !popover.hidden) {
        event.preventDefault();closeUser(true);
      }
    });
    syncHeaderControls();
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
    new MutationObserver(syncExternalOwnerNav).observe(nav,{childList:true});
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
    branch.textContent = 'Current business';
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
    installTopbarControls();
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
    // Login transitions can happen while the modal is open (session expiry,
    // business switch or external sign-out). Fail closed without stale links.
    function dismissOnAuthLoss() {
      var login = document.getElementById('loginOverlay');
      if (drawer && !drawer.hidden &&
          (getComputedStyle(app).visibility === 'hidden' || (login && !login.hidden))) closeDrawer();
    }
    new MutationObserver(dismissOnAuthLoss).observe(app,{attributes:true,attributeFilter:['style','hidden']});
    var login = document.getElementById('loginOverlay');
    if (login) new MutationObserver(dismissOnAuthLoss).observe(login,{attributes:true,attributeFilter:['hidden','style']});
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
