/**
 * Shared navigation component for WaFastApi user panel.
 * Usage: <script src="/js/nav.js"></script>
 *        <script>injectNav('dashboard');</script>
 * Keys: 'dashboard' | 'signcopy' | 'chatbot' | 'campaigns' | 'inbox' | 'templates' | 'subscribe' | 'wallet' | 'profile' | 'docs'
 */
(function () {
  const LINKS = [
    { href: '/sessions',      icon: 'fa-server',      label: 'Dashboard',  key: 'dashboard'  },
    { href: '/templates?module=signcopy', icon: 'fa-file-pdf', label: 'Sign Copy', key: 'signcopy' },
    { href: '/chatbot',       icon: 'fa-robot',       label: 'Chatbot',    key: 'chatbot'    },
    { href: '/campaigns',     icon: 'fa-bullhorn',    label: 'Campaigns',  key: 'campaigns'  },
    { href: '/inbox',         icon: 'fa-inbox',       label: 'Inbox',      key: 'inbox'      },
    { href: '/templates',     icon: 'fa-layer-group', label: 'Templates',  key: 'templates'  },
    { href: '/subscriptions', icon: 'fa-gem',         label: 'Plans',      key: 'subscribe'  },
    { href: '/recharge',      icon: 'fa-wallet',      label: 'Wallet',     key: 'wallet'     },
    { href: '/doc',           icon: 'fa-code',        label: 'API Docs',   key: 'docs', xl: true },
  ];

  const CSS = `
    [data-wa-nav] {
      position: fixed; top: 0; left: 0; right: 0; z-index: 9000;
      height: 60px;
      background: rgba(2, 8, 23, 0.88);
      backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
      border-bottom: 1px solid rgba(16,185,129,0.12);
      box-shadow: 0 4px 32px rgba(0,0,0,0.3);
      font-family: 'Inter', system-ui, sans-serif;
    }
    [data-wa-nav] .wa-nav-inner {
      max-width: 1400px; margin: 0 auto;
      display: flex; align-items: center; height: 60px;
      padding: 0 20px; gap: 8px;
    }
    /* Logo */
    [data-wa-nav] .wa-logo {
      display: flex; align-items: center; gap: 9px;
      text-decoration: none; flex-shrink: 0; margin-right: 8px;
    }
    [data-wa-nav] .wa-logo-icon {
      width: 34px; height: 34px; border-radius: 10px;
      background: linear-gradient(135deg, #10b981, #059669);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 0 14px rgba(16,185,129,0.35);
      flex-shrink: 0;
    }
    [data-wa-nav] .wa-logo-icon i { color: #fff; font-size: 16px; }
    [data-wa-nav] .wa-logo-text {
      font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -0.3px;
    }
    [data-wa-nav] .wa-logo-text span { color: #10b981; }
    /* Links */
    [data-wa-nav] .wa-links {
      display: flex; align-items: center; gap: 2px;
      flex: 1; justify-content: center; overflow-x: auto;
    }
    [data-wa-nav] .wa-links::-webkit-scrollbar { display: none; }
    [data-wa-nav] .wa-link {
      display: flex; align-items: center; gap: 5px;
      padding: 6px 11px; border-radius: 8px;
      font-size: 13px; font-weight: 500; color: #9ca3af;
      text-decoration: none; white-space: nowrap;
      transition: all 0.15s; position: relative;
    }
    [data-wa-nav] .wa-link:hover { color: #10b981; background: rgba(16,185,129,0.08); }
    [data-wa-nav] .wa-link.active {
      color: #10b981; background: rgba(16,185,129,0.1);
      font-weight: 600;
    }
    [data-wa-nav] .wa-link.active::after {
      content:''; position:absolute; bottom:-1px; left:10%; right:10%;
      height:2px; background:#10b981; border-radius:2px 2px 0 0;
    }
    [data-wa-nav] .wa-link i { font-size: 12px; }
    [data-wa-nav] .wa-link.xl-only { display: none; }
    /* Right actions */
    [data-wa-nav] .wa-right {
      display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: 8px;
    }
    /* Balance chip */
    [data-wa-nav] .wa-balance {
      display: flex; align-items: center; gap: 5px;
      background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.2);
      border-radius: 20px; padding: 5px 12px;
      font-size: 12px; font-weight: 700; color: #10b981;
      cursor: pointer; transition: all 0.15s; text-decoration: none;
    }
    [data-wa-nav] .wa-balance:hover { background: rgba(16,185,129,0.18); }
    [data-wa-nav] .wa-balance i { font-size: 11px; }
    /* User pill */
    [data-wa-nav] .wa-user {
      display: flex; align-items: center; gap: 8px;
      background: rgba(17,24,39,0.9); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 22px; padding: 4px 12px 4px 4px;
      cursor: pointer; transition: all 0.15s; text-decoration: none;
    }
    [data-wa-nav] .wa-user:hover { background: rgba(31,41,55,0.9); border-color: rgba(16,185,129,0.3); }
    [data-wa-nav] .wa-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      background: linear-gradient(135deg, #10b981, #059669);
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 800; color: #fff; flex-shrink: 0;
    }
    [data-wa-nav] .wa-user-info { display: flex; flex-direction: column; }
    [data-wa-nav] .wa-user-name { font-size: 12px; font-weight: 700; color: #f3f4f6; line-height: 1.1; }
    [data-wa-nav] .wa-user-role { font-size: 10px; color: #6b7280; line-height: 1.1; }
    /* Logout */
    [data-wa-nav] .wa-logout {
      width: 34px; height: 34px; border-radius: 10px;
      background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
      display: flex; align-items: center; justify-content: center;
      color: #f87171; cursor: pointer; transition: all 0.15s; text-decoration: none;
      font-size: 13px;
    }
    [data-wa-nav] .wa-logout:hover { background: rgba(239,68,68,0.2); color: #fff; }
    /* Mobile burger */
    [data-wa-nav] .wa-burger {
      display: none; width: 34px; height: 34px; border-radius: 10px;
      background: rgba(31,41,55,0.8); border: 1px solid rgba(255,255,255,0.08);
      align-items: center; justify-content: center; color: #9ca3af;
      cursor: pointer; font-size: 13px;
    }
    /* Mobile menu */
    [data-wa-nav] .wa-mobile-menu {
      display: none; position: absolute; top: 60px; left: 0; right: 0;
      background: rgba(2,8,23,0.97); border-bottom: 1px solid rgba(255,255,255,0.07);
      padding: 8px 16px 16px; backdrop-filter: blur(24px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    [data-wa-nav] .wa-mobile-menu.open { display: block; }
    [data-wa-nav] .wa-mobile-link {
      display: flex; align-items: center; gap: 10px;
      padding: 11px 12px; border-radius: 10px;
      font-size: 14px; font-weight: 500; color: #9ca3af;
      text-decoration: none; transition: all 0.12s; margin-bottom: 3px;
    }
    [data-wa-nav] .wa-mobile-link:hover { background: rgba(16,185,129,0.08); color: #10b981; }
    [data-wa-nav] .wa-mobile-link.active { background: rgba(16,185,129,0.1); color: #10b981; font-weight: 600; }
    [data-wa-nav] .wa-mobile-link i { width: 16px; text-align: center; font-size: 13px; }
    [data-wa-nav] .wa-mobile-divider { border-top: 1px solid rgba(255,255,255,0.05); margin: 8px 0; }

    /* Responsive */
    @media (max-width: 900px) {
      [data-wa-nav] .wa-links { display: none; }
      [data-wa-nav] .wa-burger { display: flex; }
      [data-wa-nav] .wa-balance { display: none; }
      [data-wa-nav] .wa-user-info { display: none; }
    }
    @media (min-width: 1280px) {
      [data-wa-nav] .wa-link.xl-only { display: flex; }
    }
  `;

  window.injectNav = function (currentKey) {
    // Remove existing
    const existing = document.querySelector('[data-wa-nav]');
    if (existing) existing.remove();

    // Inject CSS once
    if (!document.getElementById('wa-nav-css')) {
      const style = document.createElement('style');
      style.id = 'wa-nav-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    // Build desktop links
    const desktopLinks = LINKS.map(l => `
      <a href="${l.href}" class="wa-link ${l.key === currentKey ? 'active' : ''} ${l.xl ? 'xl-only' : ''}">
        <i class="fas ${l.icon}"></i>${l.label}
      </a>
    `).join('');

    // Build mobile links
    const mobileLinks = LINKS.map(l => `
      <a href="${l.href}" class="wa-mobile-link ${l.key === currentKey ? 'active' : ''}">
        <i class="fas ${l.icon}"></i>${l.label}
      </a>
    `).join('');

    const nav = document.createElement('nav');
    nav.setAttribute('data-wa-nav', '1');
    nav.innerHTML = `
      <div class="wa-nav-inner">
        <!-- Logo -->
        <a href="/" class="wa-logo">
          <div class="wa-logo-icon"><i class="fab fa-whatsapp"></i></div>
          <span class="wa-logo-text">Wa<span>Fast</span>Api</span>
        </a>

        <!-- Desktop Links -->
        <div class="wa-links">${desktopLinks}</div>

        <!-- Right -->
        <div class="wa-right">
          <!-- Balance -->
          <a href="/recharge" class="wa-balance" id="wa-bal-chip" title="Wallet balance">
            <i class="fas fa-wallet"></i>
            <span id="wa-balance-val">৳ –</span>
          </a>

          <!-- User pill -->
          <a href="/profile" class="wa-user">
            <div class="wa-avatar" id="wa-avatar">?</div>
            <div class="wa-user-info">
              <span class="wa-user-name" id="wa-uname">Loading...</span>
              <span class="wa-user-role" id="wa-urole">–</span>
            </div>
          </a>

          <!-- Logout -->
          <a href="/api/auth/logout" class="wa-logout" title="Logout">
            <i class="fas fa-sign-out-alt"></i>
          </a>

          <!-- Mobile burger -->
          <button class="wa-burger" onclick="document.querySelector('[data-wa-nav] .wa-mobile-menu').classList.toggle('open')" aria-label="Menu">
            <i class="fas fa-bars"></i>
          </button>
        </div>
      </div>

      <!-- Mobile dropdown -->
      <div class="wa-mobile-menu">
        <div style="padding:10px 4px 8px;display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:14px" id="wa-mob-avatar">?</div>
          <div>
            <div style="font-size:13px;font-weight:700;color:#fff" id="wa-mob-name">Loading...</div>
            <div style="font-size:11px;color:#10b981;font-weight:600" id="wa-mob-balance">৳ –</div>
          </div>
        </div>
        <div class="wa-mobile-divider"></div>
        ${mobileLinks}
        <div class="wa-mobile-divider"></div>
        <a href="/api/auth/logout" class="wa-mobile-link" style="color:#f87171">
          <i class="fas fa-sign-out-alt"></i>Logout
        </a>
      </div>
    `;

    document.body.insertBefore(nav, document.body.firstChild);
    document.body.style.paddingTop = '60px';

    // Load user profile
    _loadUserProfile();
  };

  async function _loadUserProfile() {
    try {
      const res  = await fetch('/api/auth/profile');
      if (!res.ok) return;
      const data = await res.json();
      const u    = data.user;
      if (!u) return;

      const initials = (u.name || u.email || '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
      const balance  = typeof u.balance === 'number' ? `৳ ${u.balance.toFixed(2)}` : '৳ 0.00';
      const roleLbl  = 'Member';

      // Desktop
      const av = document.getElementById('wa-avatar');
      if (av) av.textContent = initials;

      const nm = document.getElementById('wa-uname');
      if (nm) nm.textContent = u.name || u.email || 'User';



      const bl = document.getElementById('wa-balance-val');
      if (bl) bl.textContent = balance;



      // Mobile
      const mob_av = document.getElementById('wa-mob-avatar');
      if (mob_av) mob_av.textContent = initials;
      const mob_nm = document.getElementById('wa-mob-name');
      if (mob_nm) mob_nm.textContent = u.name || u.email || 'User';
      const mob_bl = document.getElementById('wa-mob-balance');
      if (mob_bl) mob_bl.textContent = balance;

    } catch(e) {
      // Silently fail — session may not be loaded yet
    }
  }
})();
