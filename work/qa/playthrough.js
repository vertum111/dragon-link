// In-browser playthrough for QA: paste into the page console (or run from a test harness) after the page loads.
// It drives the real game through window.DLD and the real buttons, and returns a pass/fail list.
// Offline (python http.server) it checks the local economy; on the game server it also waits for NEAR.
async function playthrough({ fresh = true } = {}) {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const q = s => document.querySelector(s);
  const results = [];
  const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(250); } return false; };
  const M = window.DLD.market, e = window.DLD.devices[0];
  const bag = () => M.snapshot().bag;
  const reset = () => { e.page = null; e.shop = null; e.bag = false; e.game = null; e.mood = 'idle'; e.moodUntil = 0; e.toast = null; };
  const press = i => window.DLD.press(0, i);
  const openPage = idx => { reset(); e.selection = idx; press(1); };
  const chain = await window.DLD.chainReady;
  // a hidden browser pane pauses requestAnimationFrame; drive frames ourselves so animations (unboxing) still run
  const pump = setInterval(() => { try { window.DLD.frame(1); } catch {} }, 40);

  // sign in and open a box
  const cont = q('[data-continue]');
  (cont && !cont.closest('[hidden]') ? cont : q('[data-login=guest]')).click();
  await wait(1500);
  const st = q('#start');
  (st.hidden ? q('#unbox') : st).click();
  check('game starts after the cover and the box', await until(() => q('#title').hidden, 15000));
  if (chain) check('chain mode: game account exists', await until(() => !!chain.accountId, 30000), chain.accountId || '');

  // choose an egg, then hatch
  if (!e.hatched && !e.species) { reset(); press(2); press(1); }
  check('an egg can be chosen first', !!e.species, e.species || 'none');
  if (!e.hatched) { reset(); press(1); await until(() => e.hatched, 4000); }
  check('egg hatches into a baby', e.hatched && e.stage >= 1, `stage ${e.stage}`);
  await wait(1500);

  // feed from the bag
  if (bag().grilled < 1) M.reward('walk', 'fish', 0);
  const g0 = bag().grilled; e.hunger = 1;
  openPage(0);
  e.sub = window.DLD.submenu(e).indexOf('FEED'); press(1);
  check('FEED eats a Grilled Fish', bag().grilled === Math.max(0, g0 - 1) && e.hunger > 1, `grilled ${g0} → ${bag().grilled}, hunger ${e.hunger}`);
  await wait(1800);

  // shop: buy a Grilled Fish from Kama
  reset(); e.selection = 3; press(1);
  check('SHOP opens market street', !!e.shop);
  press(1);                                              // enter Kama's grill
  const s0 = bag().scales, f0 = bag().grilled;
  press(1);                                              // BUY grilled fish
  check('buying Grilled Fish from Kama', bag().grilled === f0 + 1 && bag().scales < s0, `fish ${f0} → ${bag().grilled}, 鱗 ${s0} → ${bag().scales}`);
  reset();

  // walk brings a material; sell it back
  reset(); const before = JSON.stringify(bag());
  openPage(2); e.sub = 0; press(1);
  await wait(3200);
  const found = e.found?.item;
  check('WALK finds embers', !!found && bag()[found] >= 1 && JSON.stringify(bag()) !== before, found || 'nothing');
  const buyer = { ore: [0, 1] }[found];
  if (buyer) {
    reset(); e.selection = 3; press(1);
    for (let k = 0; k < buyer[0]; k++) press(2);
    press(1);
    const rows = window.DLD.shopRows(e); e.shop.row = rows.findIndex(r => r.act === 'sell' && r.item === found);
    const n0 = bag()[found], c0 = bag().scales;
    press(1);
    check('SHOP sells it back', bag()[found] === n0 - 1 && bag().scales > c0, `${found} ${n0} → ${bag()[found]}`);
  }
  reset();

  // bag screen
  openPage(0); e.sub = window.DLD.submenu(e).indexOf('BAG'); press(1);
  check('BAG screen opens', e.bag === true);
  press(1); check('BAG closes on any button', e.bag === false);

  // evolution: baby → adult on XP, adult → elder with a pearl
  if (e.stage < 2) { window.DLD.addXP(e, 40); await wait(200); }
  check('baby evolves into an adult', e.stage === 2 || e.stage === 3, `stage ${e.stage}`);
  check('evolution flickers between forms', !!e.evolveFx || e.stage === 3);
  if (e.stage === 2 && !chain) {            // on NEAR a pearl only drops from battle, so the elder step runs offline
    if (!M.count('pearl')) M.reward('walk', 'pearl', 1);
    openPage(0); e.sub = window.DLD.submenu(e).indexOf('EVOLVE');
    check('EVOLVE appears with a Dragon Pearl', e.sub === 0);
    press(1);
    check('adult becomes an elder', e.stage === 3);
  }
  await wait(800);

  // link and trade
  reset();
  q('#link').click(); await wait(600);
  q('[data-mode=local]').click(); q('[data-link-local]').click();
  check('LINK on this screen docks a friend', await until(() => window.DLD.docked, 15000), window.DLD.friend?.name || 'offline friend');
  check('LCD LINK menu has TRADE', window.DLD.submenu({ ...e, page: 4 }).includes('TRADE'));
  q('[data-open-trade]').click(); await wait(2000);
  check('trade dialog opens', q('#trade').open);
  if (chain && window.DLD.friend?.bot) {
    const b = bag();   // what the player sees in the dialog
    const give = ['ore', 'grilled'].find(k => b[k] > 0);
    if (give) {
      q(`[data-give] [data-item=${give}][data-step="1"]`).click();
      q('[data-want] [data-item=scales][data-step="1"]').click();
      q('[data-send-offer]').click();
      await until(() => q('[data-trade-result]').dataset.state !== 'pending', 60000);
      check('Robo answers a trade offer on NEAR', /Deal|more|only have/.test(q('[data-trade-result]').textContent), q('[data-trade-result]').textContent.slice(0, 90));
    }
  }
  q('#trade').close();
  q('#link').click(); await until(() => !window.DLD.docked, 6000);
  check('UNLINK works', !window.DLD.docked);

  // investing in a closed shop (offline only; on NEAR the server owns the shops)
  if (!chain) {
    M.state.merchants.gen.open = false; M.state.merchants.gen.cash = 0; M.give('scales', 60);
    const r = M.invest('gen', 50);
    check('investing reopens a closed shop', r.ok && M.state.merchants.gen.open);
  }

  // judges' week
  q('[data-open-settings]').click(); await wait(200);
  q('[data-ffwd]').click(); await wait(1200);
  q('[data-ff-skip]').click();
  check('judges’ week runs to day 7', /Day 7/.test(q('[data-ff-day]').textContent), q('[data-ff-day]').textContent);
  q('#ffwd').close();

  if (chain) {
    await until(() => !document.querySelector('[data-chain][data-state=pending]'), 60000);
    const b = await chain.balances(), local = bag();
    check('bag on screen matches the items contract', ['scales', 'grilled', 'ore', 'pearl'].every(k => b[k] === local[k]), JSON.stringify({ chain: b, screen: local }));
  }
  clearInterval(pump);
  return results;
}
