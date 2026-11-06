(() => {
  'use strict';

  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const $ = (id) => document.getElementById(id);
  const actionButtons = Array.from(document.querySelectorAll('.action-btn'));
  const el = {
    spinner: $('spinner'), banner: $('banner'), output: $('output'), placeholder: $('placeholder'),
    panel: $('auth-panel'), badge: $('auth-badge'), expiry: $('auth-expiry'), hint: $('auth-token-hint'),
    msg: $('auth-message'), fieldset: $('token-fieldset'), input: $('token-input'),
    form: $('token-form'), submit: $('token-submit'), count: $('order-count'), cancelRef: $('cancel-ref'),
  };

  const state = { busy: false, auth: null };

  // ---------- helpers ----------
  async function api(path, body) {
    const res = await fetch(path, {
      method: body === undefined && path.includes('/status') ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json;
    try { json = await res.json(); } catch { json = { ok: false, code: 'UNEXPECTED_RESPONSE', message: 'The server returned an unexpected response.' }; }
    if (res.status === 401 && json.code === 'LOGIN_REQUIRED') { window.location.href = '/login'; }
    return json;
  }

  function showBanner(kind, text) {
    el.banner.hidden = false;
    el.banner.className = `banner banner-${kind}`;
    el.banner.textContent = text; // textContent: never interpret server text as HTML
  }

  function showOutput(data) {
    el.placeholder.hidden = true;
    el.output.hidden = data === undefined;
    if (data !== undefined) el.output.textContent = JSON.stringify(data, null, 2);
  }

  function formatRemaining(sec) {
    if (sec <= 0) return 'expired';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }

  // ---------- auth panel ----------
  function applyAuth(auth) {
    state.auth = auth;
    el.panel.dataset.state = auth.state;
    el.panel.dataset.expiresAt = auth.expiresAt || '';
    el.badge.textContent = auth.authenticated ? 'Authenticated' : 'Not authenticated';
    el.badge.className = `badge ${auth.authenticated ? 'badge-ok' : 'badge-bad'}`;
    el.msg.textContent = auth.message;
    el.msg.className = `banner ${auth.authenticated ? 'banner-ok' : 'banner-error'}`;
    el.hint.textContent = auth.tokenHint || '';
    el.fieldset.disabled = auth.authenticated || state.updating === true;
    tickExpiry();
    syncButtons();
  }

  function tickExpiry() {
    const a = state.auth;
    if (!a || !a.expiresAt) { el.expiry.textContent = ''; return; }
    const sec = Math.floor((new Date(a.expiresAt).getTime() - Date.now()) / 1000);
    const when = new Date(a.expiresAt).toLocaleString();
    el.expiry.textContent = sec > 0 ? `Expires in ${formatRemaining(sec)} (${when})` : `Expired on ${when}`;
    // Client-side expiry detection: lock immediately, then let the server confirm
    if (sec <= 0 && a.authenticated && Date.now() - (state.lastExpiryCheck || 0) > 5000) {
      state.lastExpiryCheck = Date.now();
      refreshAuth();
    }
  }

  async function refreshAuth() {
    const json = await api('/api/auth/status');
    if (json && json.auth) applyAuth(json.auth);
  }

  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = el.input.value.trim();
    if (!token) { el.msg.className = 'banner banner-error'; el.msg.textContent = 'Please paste a JWT first.'; return; }
    state.updating = true;
    el.fieldset.disabled = true;
    el.submit.textContent = 'Verifying…';
    const json = await api('/api/auth/token', { token });
    state.updating = false;
    el.submit.textContent = 'Update Token';
    if (json.ok) {
      el.input.value = '';
      applyAuth(json.auth);
      el.msg.className = 'banner banner-ok';
      el.msg.textContent = 'Token updated and verified with the API. Order actions are enabled again.';
    } else {
      el.fieldset.disabled = false; // still needs a valid token
      el.msg.className = 'banner banner-error';
      el.msg.textContent = json.message || 'Token update failed.';
    }
  });

  // ---------- actions ----------
  function syncButtons() {
    const authed = Boolean(state.auth && state.auth.authenticated);
    actionButtons.forEach((b) => { b.disabled = state.busy || !authed; });
    el.count.disabled = state.busy || !authed;
    el.cancelRef.disabled = state.busy || !authed;
    el.spinner.hidden = !state.busy;
  }

  async function runAction(btn) {
    if (state.busy) return; // duplicate-submission guard
    const name = btn.dataset.action;
    if (btn.dataset.confirm && !window.confirm(btn.dataset.confirm)) return;

    const body = name === 'create' ? { count: Number(el.count.value) }
      : name === 'cancel' ? { reference_code: el.cancelRef.value.trim() } : {};
    state.busy = true;
    btn.classList.add('loading');
    syncButtons();
    showBanner('info', 'Working… please wait.');
    showOutput(undefined);

    let json;
    try {
      json = await api(`/api/orders/${name}`, body);
    } catch {
      json = { ok: false, code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection.' };
    }

    state.busy = false;
    btn.classList.remove('loading');

    if (json.auth) applyAuth(json.auth);
    if (json.ok) {
      const kind = { success: 'ok', partial: 'warn', failed: 'error', nothing: 'info' }[json.data.outcome] || 'ok';
      showBanner(kind, json.message);
      showOutput(json.data);
    } else {
      const isAuth = json.code === 'TOKEN_EXPIRED' || json.code === 'TOKEN_INVALID';
      showBanner(json.code === 'FORBIDDEN' ? 'warn' : 'error', json.message || 'Request failed.');
      showOutput(json.details);
      if (isAuth) await refreshAuth(); // enables the token panel (401 only; a 403 is NOT treated as expiry)
    }
    syncButtons();
  }

  actionButtons.forEach((b) => b.addEventListener('click', () => runAction(b)));

  // ---------- boot ----------
  applyAuth({
    state: el.panel.dataset.state,
    authenticated: el.panel.dataset.state === 'valid',
    expiresAt: el.panel.dataset.expiresAt || null,
    message: el.msg.textContent.trim(),
    tokenHint: el.hint.textContent.trim(),
  });
  setInterval(tickExpiry, 1000);
  setInterval(refreshAuth, 30000);
})();
