// Page UI for the manual edition: cover sign-in, account chip, settings insert and the link menu.
// The game itself lives in dragon-duo.js and is reached through window.DLD.
//
// DEMO STUBS (not wired to a backend yet):
//  - Sign-in only stores a local profile. Real social/email login (and the NEAR account created behind it)
//    plugs into signIn() below.
//  - "Online with a code" shows the room flow, but both Host and Join fall back to the on-screen link.
//    Real rooms need a relay/WebRTC service; hook it into hostRoom() / joinRoom().
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  // item icons: the same approved set the console screen uses
  const ICON = k => `<img class="ico" src="assets/items/${k}.png" alt="">`;
  const COIN = ICON('scales');
  const ACCOUNT_KEY = 'dragon-link-account';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(ACCOUNT_KEY)) } catch { return null } },
    set(v) { try { v ? localStorage.setItem(ACCOUNT_KEY, JSON.stringify(v)) : localStorage.removeItem(ACCOUNT_KEY) } catch {} },
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── account chip ── */
  function renderAccount(acct) {
    for (const chip of $$('[data-account-chip]')) {
      const guest = !acct || acct.method === 'guest';
      chip.toggleAttribute('data-guest', guest);
      const av = $('.avatar', chip);
      if (!guest && acct.picture) av.innerHTML = `<img src="${escape(acct.picture)}" alt="" referrerpolicy="no-referrer">`;
      else av.textContent = guest ? '?' : acct.name[0].toUpperCase();
      const balance = `${window.DLD?.market?.count('scales') ?? 0} coins`;
      $('.name', chip).innerHTML = guest ? `Guest<small>${balance}</small>` : `${escape(acct.name)}<small>${balance}</small>`;
      chip.setAttribute('aria-label', guest ? 'Guest. Open settings' : `Signed in as ${acct.name}. Open settings`);
    }
    const line = $('[data-acct-text]');
    line.innerHTML = !acct || acct.method === 'guest'
      ? 'Playing as a guest<small>Progress stays on this device only.</small>'
      : `${escape(acct.name)}<small>Game account ${escape(acct.handle)}, made for you. No wallet needed.</small>`;
    $('[data-signout]').textContent = !acct || acct.method === 'guest' ? 'Sign in' : 'Sign out';
    const chain = window.DLD?.market?.chain;
    if (chain?.accountId) line.innerHTML = `${escape(acct?.name || 'Guest')}<small>Game account <a href="${chain.explorerAccount(chain.accountId)}" target="_blank" rel="noopener">${escape(chain.accountId)}</a> on NEAR ${escape(chain.cfg.network)}, made for you. No wallet needed.</small>`;
  }
  const escape = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

  /* ── cover / sign-in ── */
  const login = $('#login');
  const title = $('[data-split]');
  title.innerHTML = [...title.textContent].map((c, i) => `<span class="ch" style="--i:${i}" aria-hidden="true">${c}</span>`).join('');

  function signIn(method, email) {
    // Placeholder profile. Swap for a real social/email login that also creates the player's NEAR account.
    const local = email ? email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'player' : 'player';
    const name = method === 'guest' ? 'Guest' : method === 'email' ? local : 'Player';
    const handle = `${local}-${Math.random().toString(36).slice(2, 6)}.dragonlink.near`;
    return { method, name, handle };
  }
  function openCover(acct) {
    if (acct) store.set(acct);
    renderAccount(store.get());
    // chain mode: make (or reuse) this device's game account on NEAR, behind the scenes
    const who = store.get();
    if (who?.method !== 'privy') window.DLD?.chainReady?.then(chain => { if (chain && !chain.accountId) window.DLD.market.login(who?.name || 'guest').then(() => renderAccount(store.get())); });
    login.classList.add('opening');
    setTimeout(() => { login.hidden = true }, reduced ? 220 : 980);
  }
  const saved = store.get();
  renderAccount(saved);
  if (saved && saved.method !== 'guest') {
    $('[data-signin]').hidden = true;
    $('[data-welcome]').hidden = false;
    $('[data-welcome-name]').textContent = `Welcome back, ${saved.name}`;
  }
  $('[data-continue]').addEventListener('click', () => openCover());
  $('[data-switch]').addEventListener('click', () => { $('[data-welcome]').hidden = true; $('[data-signin]').hidden = false });
  for (const b of $$('[data-login]')) b.addEventListener('click', () => b.dataset.login === 'google' ? googleSignIn(b) : openCover(signIn(b.dataset.login)));

  /* ── Sign in with Google or email (Privy): no seed phrase, no wallet pop-up, no gas ──
     Privy gives the player an embedded NEAR wallet; its key becomes their game account's key,
     so the same Google or email signs in to the same dragon on any device. */
  const PRIVY_APP_ID = document.querySelector('meta[name="privy-app-id"]')?.content || '';
  let privy = null;
  const signinNote = msg => {
    let n = $('[data-signin-note]');
    if (!n) { n = document.createElement('p'); n.className = 'fine'; n.dataset.signinNote = ''; n.setAttribute('role', 'status'); $('[data-signin]').append(n); }
    n.textContent = msg;
  };
  function loadPrivy() {
    if (!privy) privy = import('./privy.bundle.js').then(m => m.startPrivy({
      appId: PRIVY_APP_ID,
      onIdentity: async identity => {
        const prev = store.get(), acct = { method: 'privy', name: identity.name, email: identity.email, handle: prev?.method === 'privy' ? prev.handle : '' };
        store.set(acct);
        if (!login.hidden) openCover(acct); else renderAccount(acct);
        const chain = await window.DLD?.chainReady;
        if (chain) { const id = await window.DLD.market.login(identity.name, identity); if (id) { store.set({ ...acct, handle: id }); renderAccount(store.get()); } }
      },
      onLogout: () => { store.set(null); window.DLD?.market?.signOut?.(); location.reload(); },
      onError: e => signinNote(typeof e === 'string' && e === 'exited_auth_flow' ? 'Sign-in was closed.' : 'Sign-in did not finish. Try again, or play as a guest.'),
    }));
    return privy;
  }
  async function privySignIn(btn, opts) {
    if (!PRIVY_APP_ID) return signinNote('Sign-in is not set up on this copy of the game. Play as a guest.');
    btn && (btn.disabled = true); signinNote('Opening sign-in…');
    try {
      const api = await loadPrivy();
      for (let i = 0; i < 50 && !api.ready; i++) await new Promise(r => setTimeout(r, 100));
      api.login(opts); signinNote('');
    } catch (e) { console.warn('Privy', e); signinNote('Sign-in is not available right now. Play as a guest.'); }
    btn && (btn.disabled = false);
  }
  function googleSignIn(btn) { return privySignIn(btn, { loginMethods: ['google'] }); }
  $('[data-email-form]').addEventListener('submit', e => {
    e.preventDefault();
    privySignIn(e.submitter, { loginMethods: ['email'], prefill: { type: 'email', value: $('#email').value } });
  });
  // a returning Privy player: restore the session (and their wallet signer) quietly
  if (store.get()?.method === 'privy') loadPrivy().catch(() => {});

  /* ── settings insert ── */
  const settings = $('#settings');
  const openSettings = () => { syncMix(); settings.showModal() };
  for (const b of $$('[data-open-settings], [data-account-chip]')) b.addEventListener('click', openSettings);
  // sliders show 0–100; 50 is the designed default mix
  const SCALE = { music: .68, sfx: 1.1 };
  function syncMix() {
    const mix = window.DLD?.mix || { music: .34, sfx: .55 };
    for (const r of $$('[data-mix]')) {
      const k = r.dataset.mix; r.value = Math.round(mix[k] / SCALE[k] * 100);
      $(`[data-mix-out="${k}"]`).textContent = r.value;
    }
  }
  for (const r of $$('[data-mix]')) r.addEventListener('input', () => {
    const k = r.dataset.mix; $(`[data-mix-out="${k}"]`).textContent = r.value;
    window.DLD?.setMix(k, r.value / 100 * SCALE[k]);
  });
  $('[data-signout]').addEventListener('click', async () => {
    if (store.get()?.method === 'privy') { try { const api = await loadPrivy(); await api.logout(); return; } catch {} }
    store.set(null); window.DLD?.market?.signOut?.(); location.reload();
  });
  $('[data-reset]').addEventListener('click', () => {
    if (confirm('Erase your dragon? It starts again from the egg. This cannot be undone.')) window.DLD?.resetProgress();
  });

  /* ── link menu: a room code for a friend online, or Robo the club bot on this screen ── */
  const menu = $('#link-menu');
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '', roomPoll = null, room = null;
  const chain = () => window.DLD?.market?.chain?.accountId ? window.DLD.market.chain : null;
  const me = () => ({ account: chain()?.accountId, name: store.get()?.name || 'Guest', edition: window.DLD?.devices?.[0]?.edition || 'kiln' });
  function setMode(mode) {
    for (const b of $$('[data-mode]', menu)) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    for (const p of $$('[data-pane]', menu)) p.hidden = p.dataset.pane !== mode;
  }
  function setTab(tab) {
    for (const b of $$('[data-tab]', menu)) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of $$('[data-tabpane]', menu)) p.hidden = p.dataset.tabpane !== tab;
    if (tab === 'join') setTimeout(() => $('#join-code').focus(), 30);
  }
  function showCode(c) {
    code = c;
    const box = $('[data-code]', menu);
    box.innerHTML = [...code].map(ch => `<span>${ch}</span>`).join('');
    box.setAttribute('aria-label', `Room code ${[...code].join(' ')}`);
    $('[data-copy]', menu).textContent = 'Copy invite link';
  }
  function linkWith(friend) {
    clearInterval(roomPoll);
    if (menu.open) menu.close();
    window.DLD?.link(friend);
  }
  async function hostRoom() {
    clearInterval(roomPoll);
    const c = chain();
    if (!c) { showCode(Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')); return; }
    showCode('····');
    try {
      const { code: got } = await c.room.host(me());
      showCode(got); room = { code: got };
      roomPoll = setInterval(async () => {
        if (!menu.open) return clearInterval(roomPoll);
        const s = await c.room.status(got).catch(() => null);
        if (s?.friend) linkWith(s.friend);
      }, 2000);
    } catch (e) { $('.waiting', menu).textContent = e.message; }
  }
  async function joinRoom(value) {
    const c = chain(), err = $('[data-join-error]');
    if (!c) { linkWith(null); return; }
    try { const { friend, code: got } = await c.room.join(value, me()); room = { code: got }; linkWith(friend); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
  }
  async function linkHere() {
    const c = chain();
    if (!c) return linkWith(null);
    const bot = await c.bot().catch(() => null);
    room = null;
    linkWith(bot ? { account: bot.account, name: bot.name, edition: bot.edition, bot: true } : null);
  }
  for (const b of $$('[data-mode]', menu)) b.addEventListener('click', () => setMode(b.dataset.mode));
  for (const b of $$('[data-tab]', menu)) b.addEventListener('click', () => setTab(b.dataset.tab));
  menu.addEventListener('close', () => clearInterval(roomPoll));
  $('[data-copy]', menu).addEventListener('click', async e => {
    const url = `${location.origin}${location.pathname}?link=${code}`;
    try { await navigator.clipboard.writeText(url); e.target.textContent = 'Link copied' } catch { e.target.textContent = url }
  });
  $('[data-join-form]', menu).addEventListener('submit', e => {
    e.preventDefault();
    const value = $('#join-code').value.trim().toUpperCase();
    const err = $('[data-join-error]');
    if (!/^[A-Z0-9]{4}$/.test(value)) { err.textContent = 'Codes are 4 letters or numbers, like K7QX.'; err.hidden = false; return }
    err.hidden = true;
    joinRoom(value);
  });
  $('[data-link-local]', menu).addEventListener('click', linkHere);
  // an invite link (?link=CODE) opens the menu on "I have a code" with the code filled in
  const invited = new URLSearchParams(location.search).get('link');

  /* ── trade: up to three kinds each way, through escrow in the items contract ── */
  const tradeDlg = $('#trade');
  const TNAMES = { scales: 'Coins', ore: 'Ember', grilled: 'Fish', pearl: 'Pearl' };
  const give = {}, want = {};
  let friendBag = {}, shownOffers = new Set();
  function valueOf(item) {
    if (item === 'scales') return 1;
    const snap = window.DLD.market.snapshot();
    for (const m of snap.merchants) { const q = m.quotes.find(x => x.item === item); if (q) return q.sell ?? q.buy ?? 1; }
    return 1;
  }
  const worth = side => Object.entries(side).reduce((a, [t, n]) => a + valueOf(t) * n, 0);
  function stepperList(el, bag, side, max) {
    const items = Object.keys(TNAMES).filter(k => (bag[k] || 0) > 0 || side[k] > 0);
    el.innerHTML = items.length ? items.map(k => {
      const n = side[k] || 0, kinds = Object.values(side).filter(v => v > 0).length;
      return `<li><span>${ICON(k)} ${TNAMES[k]}<small>${max ? 'has' : 'you have'} ${bag[k] || 0} · ≈${valueOf(k)} ${COIN} each</small></span>
        <button class="icon-btn step" type="button" data-step="-1" data-item="${k}" aria-label="Less ${TNAMES[k]}" ${n ? '' : 'disabled'}>−</button>
        <output>${n}</output>
        <button class="icon-btn step" type="button" data-step="1" data-item="${k}" aria-label="More ${TNAMES[k]}" ${n >= (bag[k] || 0) || (!n && kinds >= 3) ? 'disabled' : ''}>+</button></li>`;
    }).join('') : `<li class="empty">${max ? 'Their bag is empty.' : 'Your bag is empty. Go for a walk first.'}</li>`;
  }
  function renderTrade() {
    const friend = window.DLD?.friend;
    $('[data-trade-with]').textContent = friend?.name ? `Trade with ${friend.name}` : 'Trade with your friend';
    stepperList($('[data-give]'), window.DLD.market.snapshot().bag, give, false);
    stepperList($('[data-want]'), friendBag, want, true);
    const g = worth(give), w = worth(want);
    $('[data-give-sum]').textContent = `≈ ${g} coins at today’s street prices`;
    $('[data-want-sum]').textContent = `≈ ${w} coins at today’s street prices`;
    $('[data-send-offer]').disabled = !Object.values(give).some(v => v > 0);
  }
  function stepClick(side) {
    return e => {
      const b = e.target.closest('[data-step]'); if (!b) return;
      const k = b.dataset.item; side[k] = Math.max(0, (side[k] || 0) + Number(b.dataset.step));
      renderTrade();
    };
  }
  $('[data-give]').addEventListener('click', stepClick(give));
  $('[data-want]').addEventListener('click', stepClick(want));
  async function openTrade() {
    const c = chain(), friend = window.DLD?.friend, res = $('[data-trade-result]');
    if (!c || !friend?.account) {
      res.hidden = false; res.textContent = 'Trading needs the game server: run node server/index.mjs and open localhost:8787. On this page, link with a friend from the Link menu first.';
    } else res.hidden = true;
    for (const k of Object.keys(give)) delete give[k];
    for (const k of Object.keys(want)) delete want[k];
    friendBag = c && friend?.account ? await c.balances(friend.account).catch(() => ({})) : {};
    renderTrade();
    if (!tradeDlg.open) tradeDlg.showModal();
    checkOffers();
  }
  $('[data-send-offer]').addEventListener('click', async () => {
    const friend = window.DLD?.friend, res = $('[data-trade-result]');
    if (!friend?.account || !chain()) return;
    const btn = $('[data-send-offer]'); btn.disabled = true;
    res.hidden = false; res.dataset.state = 'pending';
    res.textContent = `Putting your items in escrow and sending the offer to ${friend.name}…`;
    const r = await window.DLD.market.offer(friend.account, { ...give }, { ...want });
    if (!r.ok) { res.dataset.state = 'error'; res.textContent = `The offer did not go through: ${r.error}`; btn.disabled = false; return; }
    const verdict = r.bot?.[0];
    if (verdict) {
      res.dataset.state = verdict.accepted ? 'ok' : 'error';
      res.textContent = `${friend.name}: “${verdict.reason}” ${verdict.accepted ? 'The swap is done.' : 'Your items came back from escrow.'}`;
    } else {
      res.dataset.state = 'pending';
      res.textContent = `Offer sent. Your items wait in escrow until ${friend.name} accepts or declines.`;
    }
    for (const k of Object.keys(give)) delete give[k];
    for (const k of Object.keys(want)) delete want[k];
    friendBag = await chain().balances(friend.account).catch(() => friendBag);
    setTimeout(renderTrade, 800);
  });
  // offers from a friend online: shown in the trade dialog and announced on the Link card
  async function checkOffers() {
    const c = chain(); if (!c) return;
    const offers = await c.offers().catch(() => []);
    const mine = c.accountId;
    const incoming = (offers || []).filter(o => o.to === mine);
    const box = $('[data-incoming]');
    box.hidden = !incoming.length;
    box.innerHTML = incoming.map(o => {
      const list = xs => xs.map(([t, n]) => `${n} ${TNAMES[t] || t}`).join(', ') || 'nothing';
      const g = o.give.reduce((a, [t, n]) => a + valueOf(t) * n, 0), w = o.want.reduce((a, [t, n]) => a + valueOf(t) * n, 0);
      return `<div class="offer"><p><b>${escape(window.DLD?.friend?.account === o.from ? window.DLD.friend.name : o.from)}</b> offers ${list(o.give)} (≈${g} coins) for ${list(o.want)} (≈${w} coins).</p>
        <div class="actions"><button class="btn spot" type="button" data-accept="${o.id}">Accept</button><button class="btn" type="button" data-decline="${o.id}">Decline</button></div></div>`;
    }).join('');
    const fresh = incoming.filter(o => !shownOffers.has(o.id));
    for (const o of fresh) shownOffers.add(o.id);
    const tradeBtn = $('[data-open-trade]');
    if (tradeBtn) tradeBtn.textContent = incoming.length ? `Trade · ${incoming.length} offer waiting` : 'Trade';
    if (fresh.length) window.dispatchEvent(new CustomEvent('dragonlink:chain', { detail: { state: 'ok', label: 'A trade offer arrived', url: null } }));
  }
  $('[data-incoming]').addEventListener('click', async e => {
    const a = e.target.closest('[data-accept]'), d = e.target.closest('[data-decline]');
    if (!a && !d) return;
    e.target.disabled = true;
    const r = a ? await window.DLD.market.acceptOffer(Number(a.dataset.accept)) : await window.DLD.market.cancelOffer(Number(d.dataset.decline));
    const res = $('[data-trade-result]'); res.hidden = false; res.dataset.state = r.ok ? 'ok' : 'error';
    res.textContent = r.ok ? (a ? 'Swapped. The items are in your bag.' : 'Declined. Their items went back to them.') : `That did not work: ${r.error}`;
    checkOffers(); renderTrade();
  });
  setInterval(() => { if (window.DLD?.friend?.account && !window.DLD.friend.bot) checkOffers(); }, 4000);

  window.DragonLinkUI = {
    openLinkMenu() {
      setMode('online'); setTab('host');
      $('#join-code').value = ''; $('[data-join-error]').hidden = true;
      $('.waiting', menu).innerHTML = '<i></i><i></i><i></i>Waiting for your friend';
      menu.showModal(); hostRoom();
    },
    openTrade,
  };
  if (invited) window.DLD?.chainReady?.then(() => setTimeout(() => {
    if (!document.querySelector('#login')?.hidden) return;
    window.DragonLinkUI.openLinkMenu(); setTab('join'); $('#join-code').value = invited.toUpperCase().slice(0, 4);
  }, 400));

  /* ── market street panel ── */
  const NAMES = { grilled: 'Fish', pearl: 'Pearl', ore: 'Ember' };
  const spark = (series, w = 64, h = 24) => {
    const xs = (series || []).slice(-20); if (xs.length < 2) return '';
    const lo = Math.min(...xs), hi = Math.max(...xs), span = hi - lo || 1;
    const pts = xs.map((v, i) => `${(i / (xs.length - 1) * w).toFixed(1)},${(h - 2 - (v - lo) / span * (h - 4)).toFixed(1)}`);
    const [lx, ly] = pts.at(-1).split(',');
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="#1d1d1b" stroke-width="1.4"/><circle cx="${lx}" cy="${ly}" r="2.6" fill="#ff3f8e"/>`;
  };
  let whyFor = 'kama';
  function renderMarket(snap) {
    if (!snap) return;
    $('[data-mkt-day]').textContent = `Day ${snap.day}, hour ${snap.hour + 1}${snap.event ? (snap.event === 'typhoon' ? ', typhoon' : ', festival') : ''}`;
    const bag = snap.bag;
    const items = ['grilled', 'pearl', 'ore'];
    $('[data-bag]').innerHTML = `<li class="money">${COIN}${bag.scales}<span>Coins</span></li>` + items.map(k => `<li>${ICON(k)}${bag[k]}<span>${NAMES[k]}</span></li>`).join('');
    $('[data-stalls]').innerHTML = snap.merchants.map(m => {
      const item = m.sells[0], q = m.quotes.find(x => x.item === item), hist = snap.history[item] || [];
      const prev = hist.at(-2), dir = prev == null || prev === q.sell ? '' : q.sell > prev ? 'up' : 'down';
      const right = m.open ? `<span class="price ${dir}">${q.sell}${COIN}${dir === 'up' ? ' ↑' : dir === 'down' ? ' ↓' : ''}</span>`
        : `<button class="btn invest" type="button" data-invest="${m.id}">Invest 50 coins</button>`;
      return `<li><div class="stall" tabindex="0" data-stall="${m.id}" ${m.open ? '' : 'data-closed'} aria-current="${m.id === whyFor}">
        <span>${m.name}<small>${m.trade}${m.open ? `, sells ${NAMES[item]}` : ', closed'}</small></span>
        <svg viewBox="0 0 64 24" aria-hidden="true">${spark(hist)}</svg>${right}</div></li>`;
    }).join('');
    showWhy(snap, whyFor);
    for (const chip of $$('[data-account-chip]')) $('small', chip).textContent = `${bag.scales} coins`;
  }
  function showWhy(snap, id) {
    const m = snap.merchants.find(x => x.id === id); if (!m) return;
    $('[data-why]').textContent = [...new Set(m.quotes.map(q => q.why))].join(' ');
  }
  const stallList = $('[data-stalls]');
  const pick = e => {
    const el = e.target.closest('[data-stall]'); if (!el || el.dataset.stall === whyFor) return;
    whyFor = el.dataset.stall;
    for (const s2 of $$('[data-stall]')) s2.setAttribute('aria-current', String(s2 === el));
    showWhy(window.DLD.market.snapshot(), whyFor);
  };
  stallList.addEventListener('pointerover', pick);
  stallList.addEventListener('focusin', pick);
  stallList.addEventListener('click', e => {
    const b = e.target.closest('[data-invest]'); if (!b) return;
    const r = window.DLD.market.invest(b.dataset.invest, 50);
    $('[data-why]').textContent = r.ok
      ? (r.reopened ? 'You invested 50 coins and the shop reopened. You get 30% of its sales until you are paid back 75 coins.' : 'You invested 50 coins. The shop reopens once it can pay the 20 coins rent.')
      : 'You need 50 coins to invest.';
  });
  window.addEventListener('dragonlink:market', e => renderMarket(e.detail));
  if (window.DLD?.market) renderMarket(window.DLD.market.snapshot());

  /* ── for judges: a week of trading, replayed in about 15 seconds ── */
  const ff = $('#ffwd');
  const SERIES = [['grilled', 'Fish', 'Kama sells'], ['pearl', 'Pearl', 'Gen sells'], ['ore', 'Ember', 'best price paid']];
  let ffTimer = null, run = null;
  function drawWeek(upto) {
    const frames = run.frames.slice(0, upto + 1), f = frames.at(-1), perDay = 10, total = run.frames.length - 1;
    const day = Math.min(run.days, Math.floor(f.hour / perDay) + 1);
    $('[data-ff-day]').innerHTML = `Day ${day}<span>hour ${f.hour} of ${total}</span>`;
    $('[data-ff-charts]').innerHTML = SERIES.map(([k, name, who]) => {
      const all = run.frames.map(x => x.price[k]), lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
      const X = i => (i / total * 300).toFixed(1), Y = v => (66 - (v - lo) / span * 58).toFixed(1);
      const pts = frames.map((x, i) => `${X(i)},${Y(x.price[k])}`).join(' ');
      const days = Array.from({ length: run.days - 1 }, (_, d) => `<line x1="${X((d + 1) * perDay)}" x2="${X((d + 1) * perDay)}" y1="0" y2="70" stroke="#1d1d1b22"/>`).join('');
      return `<div class="ff-chart"><h4>${ICON(k)} ${name}<span>${who}, now ${f.price[k]} coins, range ${lo}–${hi}</span></h4>
        <svg viewBox="0 0 300 70" preserveAspectRatio="none" aria-hidden="true">${days}<polyline points="${pts}" fill="none" stroke="#1d1d1b" stroke-width="1.6" vector-effect="non-scaling-stroke"/><circle cx="${X(upto)}" cy="${Y(f.price[k])}" r="3" fill="#ff3f8e"/></svg></div>`;
    }).join('');
    $('[data-ff-shops]').innerHTML = [['kama', 'Kama'], ['gen', 'Gen']].map(([id, n]) =>
      `<div class="ff-shop" ${f.open[id] ? '' : 'data-closed'}>${n}<small>${f.open[id] ? 'open' : 'closed'}, cash ${f.cash[id]} coins</small></div>`).join('');
    const seen = run.log.filter(l => l.day <= day);
    $('[data-ff-log]').innerHTML = seen.map(l => `<li>${escape(l.text)}</li>`).join('') || '<li>Quiet so far.</li>';
  }
  function playWeek() {
    clearInterval(ffTimer);
    run = window.DLD.simulateWeek({ seed: 98, bots: 50, days: 7 });
    let i = 0; drawWeek(0);
    if (reduced) { drawWeek(run.frames.length - 1); return; }
    ffTimer = setInterval(() => { i++; drawWeek(i); if (i >= run.frames.length - 1) clearInterval(ffTimer) }, 200);
  }
  $('[data-ffwd]').addEventListener('click', () => { settings.close(); ff.showModal(); playWeek() });
  $('[data-ff-replay]').addEventListener('click', playWeek);
  $('[data-ff-skip]').addEventListener('click', () => { clearInterval(ffTimer); drawWeek(run.frames.length - 1) });
  ff.addEventListener('close', () => clearInterval(ffTimer));

  /* ── chain status: one quiet line, for anyone who wants to see the market settle on NEAR ── */
  const chainLine = $('[data-chain]');
  let chainHide = null;
  window.addEventListener('dragonlink:chain', e => {
    const { state, label, error, url } = e.detail;
    clearTimeout(chainHide);
    chainLine.hidden = false;
    chainLine.dataset.state = state;
    const mark = state === 'pending' ? '…' : state === 'ok' ? '✓' : '✕';
    chainLine.innerHTML = `<b>${mark} ${escape(label)}</b><span>${state === 'pending' ? 'saving on NEAR' : state === 'ok' ? 'settled on NEAR' : escape(error || 'failed')}</span>${url ? ` <a href="${url}" target="_blank" rel="noopener">view</a>` : ''}`;
    if (state !== 'pending') chainHide = setTimeout(() => { chainLine.hidden = true }, 12000);
    if (state === 'ok' && label === 'Game account ready') renderAccount(store.get());
  });

  /* ── first-visit tour: one part of the page at a time, and most steps ask you to do the thing ── */
  const TOUR_KEY = 'dragon-link-tour-v1';
  const tourEl = $('#tour'), spot = $('[data-tour-spot]', tourEl), tcard = $('[data-tour-card]', tourEl);
  const pet = () => window.DLD?.devices?.[0];
  // where on the canvas the console's screen is, roughly: the middle of the 3D view
  const area = (sel, fx = [0, 1], fy = [0, 1]) => () => {
    const el = $(sel); if (!el) return null;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null;
    return { left: r.left + r.width * fx[0], top: r.top + r.height * fy[0], width: r.width * (fx[1] - fx[0]), height: r.height * (fy[1] - fy[0]) };
  };
  const STEPS = [
    { title: 'This is your egg', text: 'Use ◀ ▶ to look at the four eggs and ● to take one. Then press ● again to hatch it.',
      keys: ['◀', '●', '▶', 'or', 'A', 'S', 'D'], target: area('#view', [.22, .78], [.12, .9]), done: () => pet()?.hatched },
    { title: 'Three buttons do everything', text: '◀ and ▶ move through the menu at the bottom of the screen. ● chooses. Try moving once.',
      keys: ['◀', '▶'], target: area('#view', [.25, .75], [.55, .9]), start: s => { s.sel = pet()?.selection; }, done: s => pet()?.selection !== s.sel },
    { title: 'Name and needs', text: 'Top left is your dragon’s name. When food or joy runs out, a bowl or a heart blinks top right and the button to press lights up. The last icon, STATUS, shows its stage, food, joy and your wallet.',
      target: area('#view', [.25, .75], [.1, .4]) },
    { title: 'Feed your dragon', text: 'Open CARE and choose FEED. Fish comes from your bag; the club gives one free each day, and Kama sells more.',
      keys: ['CARE', '→', 'FEED'], target: area('#view', [.22, .78], [.12, .9]), start: s => { s.h = pet()?.hunger; }, done: s => pet()?.mood === 'eat' || (pet()?.hunger ?? 0) > s.h },
    { title: 'What your dragon says', text: 'This little screen tells you what just happened, what a merchant thinks of a price, and what you can do next.', target: area('.side .sec') },
    { title: 'Market street', text: 'Your bag and today’s prices. Kama grills fish and Gen makes pearls, and both buy the embers you find on walks, so check who pays more. Open SHOP on the console to buy and sell.', target: area('.sec.market') },
    { title: 'LINK with a friend', text: 'Link online with a 4-letter code, or with Robo the club bot right here. Linked units trade items and battle together.', target: area('[data-link-card]') },
    { title: 'Your account and settings', text: 'Your game account is made for you, no wallet needed. Settings has the sound, this tour again, and a week of trading for judges.', target: area('.game-head .tools') },
  ];
  let tour = null;
  function placeTour() {
    if (!tour) return;
    const step = STEPS[tour.i], r = step.target();
    if (!r) { spot.hidden = true; tcard.style.left = '50%'; tcard.style.top = '50%'; tcard.style.transform = 'translate(-50%,-50%)'; return; }
    spot.hidden = false; tcard.style.transform = '';
    const pad = 8;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const cw = tcard.offsetWidth, ch = tcard.offsetHeight, vw = innerWidth, vh = innerHeight;
    let left = r.left + r.width + 20, arrow = 'left';
    if (left + cw > vw - 12) { left = r.left - cw - 20; arrow = 'right'; }
    if (left < 12) { left = Math.min(vw - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2)); arrow = 'none'; }
    const top = Math.min(vh - ch - 12, Math.max(12, r.top + r.height / 2 - ch / 2));
    Object.assign(tcard.style, { left: `${left}px`, top: `${arrow === 'none' ? Math.min(vh - ch - 12, r.top + r.height + 16) : top}px` });
    tcard.dataset.arrow = arrow;
  }
  function showStep(i) {
    tour.i = i; tour.state = {};
    const step = STEPS[i];
    step.start?.(tour.state);
    $('[data-tour-step]', tcard).textContent = `Step ${i + 1} of ${STEPS.length}`;
    $('[data-tour-title]', tcard).textContent = step.title;
    $('[data-tour-text]', tcard).textContent = step.text;
    const keys = $('[data-tour-keys]', tcard);
    keys.hidden = !step.keys;
    keys.innerHTML = step.keys ? 'Try it: ' + step.keys.map(k => (k === 'or' || k === '→') ? `<span>${k}</span>` : `<kbd>${escape(k)}</kbd>`).join(' ') : '';
    $('[data-tour-done]', tcard).hidden = true;
    $('[data-tour-back]', tcard).disabled = i === 0;
    $('[data-tour-next]', tcard).textContent = i === STEPS.length - 1 ? 'Done' : 'Next';
    $('[data-tour-dots]', tcard).innerHTML = STEPS.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    requestAnimationFrame(placeTour);
  }
  function endTour() {
    if (!tour) return;
    clearInterval(tour.timer); tour = null; tourEl.hidden = true;
    try { localStorage.setItem(TOUR_KEY, '1'); } catch {}
  }
  function startTour() {
    if (tour) return;
    tourEl.hidden = false;
    tour = { i: 0, state: {}, timer: setInterval(() => {
      if (!tour) return;
      const step = STEPS[tour.i];
      placeTour();
      if (step.done && !tour.state.passed && step.done(tour.state)) {
        tour.state.passed = true;
        $('[data-tour-done]', tcard).hidden = false;
        setTimeout(() => { if (tour && STEPS[tour.i] === step) (tour.i < STEPS.length - 1 ? showStep(tour.i + 1) : endTour()); }, 1100);
      }
    }, 250) };
    showStep(0);
  }
  $('[data-tour-next]', tcard).addEventListener('click', () => tour && (tour.i < STEPS.length - 1 ? showStep(tour.i + 1) : endTour()));
  $('[data-tour-back]', tcard).addEventListener('click', () => tour && tour.i > 0 && showStep(tour.i - 1));
  $('[data-tour-skip]', tcard).addEventListener('click', endTour);
  addEventListener('resize', placeTour);
  addEventListener('keydown', e => { if (tour && e.key === 'Escape') endTour(); });
  $('[data-tour-again]').addEventListener('click', () => { settings.close(); startTour(); });
  // first visit: start once the game is on screen (the shelf's #title hides when the box opens)
  let seen = false; try { seen = localStorage.getItem(TOUR_KEY) === '1'; } catch {}
  if (!seen) {
    const watch = setInterval(() => { if ($('#title')?.hidden) { clearInterval(watch); setTimeout(startTour, 700); } }, 400);
  }
  window.DragonLinkTour = { start: startTour, end: endTour, get step() { return tour ? tour.i : -1; } };

  /* ── link status card ── */
  const card = $('[data-link-card]');
  $('[data-open-trade]').addEventListener('click', openTrade);
  window.addEventListener('dragonlink:link', e => {
    const { linked, friend } = e.detail;
    card.toggleAttribute('data-linked', linked);
    $('[data-link-status]').textContent = linked ? `Linked with ${window.DLD?.friend?.name || friend}${window.DLD?.friend?.bot ? ', the club bot' : ''}` : 'Not linked';
    $('[data-open-trade]').hidden = !linked;
    if (linked) setTimeout(checkOffers, 500);
    if (!linked && room && chain()) { chain().room.leave(room.code).catch(() => {}); room = null; }
  });
})();
