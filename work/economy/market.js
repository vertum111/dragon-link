// Market street 商店街: three merchant agents with their own cash and stock,
// a player bag, market hours and days, town demand, events and investments.
// Prices and the merchants' explanations live in ./pricing.js.
//
// Phase 1 (this file) runs in the browser. In phase 2 the bag and the merchants'
// balances move to a NEP-245 contract on NEAR testnet; the rules stay the same.
import { RULES, ITEMS, EDITION_MATERIAL, sellPrice, buyPrice, explain } from './pricing.js';

export { RULES, ITEMS, EDITION_MATERIAL, sellPrice, buyPrice, explain };

const STORE_KEY = 'dragon-link-market-v2';
const HISTORY = 40;               // hours of price history kept for sparklines
const PRODUCTS = ['grilled', 'pearl'];
const MATERIALS = ['ore'];

export function freshMerchants() {
  const ms = {
    kama:  { id: 'kama',  name: 'Kama',  jp: 'お釜', trade: 'Grill',      cash: 150, open: true,
             sells: ['grilled'], buys: ['ore'], recipe: { in: { ore: 1 }, out: { grilled: 2 } },
             stock: { grilled: 8, ore: 4 }, target: { grilled: 8, ore: 6 },
             soldLastHour: {}, avgSold: { grilled: 2 }, investors: {} },
    gen:   { id: 'gen',   name: 'Gen',   jp: '源',   trade: 'Curio shop', cash: 260, open: true,
             sells: ['pearl'], buys: ['ore'], recipe: { in: { ore: 5 }, out: { pearl: 1 } },
             stock: { pearl: 1, ore: 6 }, target: { pearl: 2, ore: 8 },
             soldLastHour: {}, avgSold: { pearl: 1 }, investors: {} },
  };
  for (const m of Object.values(ms)) m.minTarget = { ...m.target };
  return ms;
}

export function freshState(seed = 1998, now = Date.now()) {
  return {
    v: 2, seed, rng: seed >>> 0, hour: 0, day: 1, lastTick: now,
    event: null,
    merchants: freshMerchants(),
    bag: { scales: 20, grilled: 5, pearl: 0, ore: 0 },
    riceDay: 0,
    history: {},
    log: [],
  };
}

// deterministic random: the same seed replays the same market
function rand(s) {
  s.rng = (s.rng + 0x6D2B79F5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (s, lo, hi) => lo + Math.floor(rand(s) * (hi - lo + 1));

function note(s, text) {
  s.log.unshift({ day: s.day, hour: s.hour, text });
  s.log.length = Math.min(s.log.length, 60);
}

// a sale by a merchant: money in, stock out, investors take their share
function merchantSells(s, m, item, price, payTo) {
  m.stock[item]--;
  m.cash += price;
  m.soldLastHour[item] = (m.soldLastHour[item] || 0) + 1;
  let pool = Math.round(price * RULES.investorShare);
  const owed = Object.entries(m.investors).filter(([, v]) => v.paid < v.in * RULES.investorCap);
  const total = owed.reduce((a, [, v]) => a + v.in, 0);
  for (const [who, v] of owed) {
    if (pool <= 0) break;
    const cut = Math.min(Math.max(1, Math.round(pool * v.in / total)), v.in * RULES.investorCap - v.paid, m.cash);
    if (cut <= 0) continue;
    v.paid += cut; m.cash -= cut; pool -= cut;
    payTo?.(who, cut);
  }
}

function craft(m) {
  const [outItem, outN] = Object.entries(m.recipe.out)[0];
  let made = 0;
  while (m.stock[outItem] < m.target[outItem] * 1.5 &&
         Object.entries(m.recipe.in).every(([k, n]) => m.stock[k] >= n)) {
    for (const [k, n] of Object.entries(m.recipe.in)) m.stock[k] -= n;
    m.stock[outItem] += outN; made += outN;
  }
  return made;
}

function record(s) {
  const k = s.merchants;
  const point = {
    grilled: sellPrice(k.kama, 'grilled'), pearl: sellPrice(k.gen, 'pearl'),
    ore: Math.max(buyPrice(k.kama, 'ore'), buyPrice(k.gen, 'ore')),     // the best price an ember fetches today
  };
  for (const [item, p] of Object.entries(point)) {
    (s.history[item] ||= []).push(p);
    if (s.history[item].length > HISTORY) s.history[item].shift();
  }
  return point;
}

// the day's weather has its own stream (seed × day), so it doesn't depend on how busy the hour was
function dayRand(s) {
  const t = { rng: (s.seed ^ Math.imul(s.day, 0x9E3779B1)) >>> 0 };
  rand(t); return rand(t);
}

function startDay(s) {
  const r = dayRand(s);
  s.event = r < 0.22 ? 'rain' : r < 0.42 ? 'festival' : null;
  if (s.event === 'rain') note(s, `Day ${s.day}: rain all day. Hardly any embers on the trails.`);
  if (s.event === 'festival') note(s, `Day ${s.day}: summer festival. Everyone wants Fish.`);
}

function closeDay(s) {
  for (const m of Object.values(s.merchants)) {
    if (!m.open) continue;
    if (m.cash >= RULES.rentPerDay) m.cash -= RULES.rentPerDay;
    else { m.open = false; note(s, `Day ${s.day}: ${m.name}’s ${m.trade.toLowerCase()} couldn’t pay rent and closed.`); continue; }
    // the agent's own business decision: grow when cash piles up, shrink when it runs thin
    const grow = m.cash > RULES.expandAt, shrink = m.cash < RULES.shrinkAt;
    if (grow || shrink) {
      const step = grow ? 1 : -1;
      for (const k of Object.keys(m.target)) {
        const unit = m.recipe.in[k] || Object.values(m.recipe.out)[0];
        m.target[k] = Math.max(m.minTarget[k], m.target[k] + step * unit * 2);
      }
      if (grow) { m.cash -= RULES.expandCost; note(s, `Day ${s.day}: ${m.name} spent ${RULES.expandCost} coins to grow the ${m.trade.toLowerCase()}. It now buys and makes more.`); }
    }
  }
}

/** One market hour: the town buys and sells, merchants craft, prices are recorded. */
function hourTick(s, payTo) {
  for (const m of Object.values(s.merchants)) {
    if (!m.open) { m.soldLastHour = {}; continue; }
    // townsfolk bring materials
    for (const item of m.buys) {
      let n = randInt(s, 0, 2);
      if (item === 'ore' && s.event === 'rain') n = rand(s) < 0.15 ? 1 : 0;
      for (let i = 0; i < n; i++) { const p = buyPrice(m, item); if (!p) break; m.cash -= p; m.stock[item]++; }
    }
    craft(m);
    // townsfolk buy what the merchant makes
    for (const item of m.sells) {
      let n = item === 'pearl' ? (rand(s) < 0.28 ? 1 : 0) : randInt(s, 0, 2);
      if (item === 'grilled' && s.event === 'festival') n += 2;
      for (let i = 0; i < n && m.stock[item] > 0; i++) merchantSells(s, m, item, sellPrice(m, item), payTo);
    }
  }
  record(s);
  for (const m of Object.values(s.merchants)) {
    for (const item of m.sells) m.avgSold[item] = m.avgSold[item] * 0.8 + (m.soldLastHour[item] || 0) * 0.2;
    m.soldLastHour = {};
  }
  s.hour++;
  if (s.hour % RULES.hoursPerDay === 0) { closeDay(s); s.day++; startDay(s); }
}

/** The live market the game talks to. */
export function createMarket({ storage = globalThis.localStorage, now = () => Date.now(), seed = 1998, storeKey = STORE_KEY, onPayout = null } = {}) {
  let s;
  try { s = JSON.parse(storage?.getItem(storeKey) || 'null'); } catch { s = null; }
  if (!s || s.v !== 2) { s = freshState(seed, now()); record(s); }
  const listeners = new Set();
  // investor payouts: the local player's go into the bag; on the server, onPayout mints them on-chain
  const payYou = (who, cut) => { if (who === 'you') s.bag.scales += cut; else onPayout?.(who, cut); };
  const persist = () => { try { storage?.setItem(storeKey, JSON.stringify(s)); } catch {} };
  const changed = () => { persist(); for (const fn of listeners) fn(api.snapshot()); };

  const api = {
    get state() { return s; },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** Run the market hours that have passed. Returns a report when the player was away. */
    update() {
      if (api.remote) return null;                 // chain mode: the server runs the market hours
      const due = Math.floor((now() - s.lastTick) / RULES.hourMs);
      if (due <= 0) return null;
      const steps = Math.min(due, 60);
      const before = { day: s.day, prices: Object.fromEntries(Object.entries(s.history).map(([k, v]) => [k, v.at(-1)])),
        open: Object.fromEntries(Object.values(s.merchants).map(m => [m.id, m.open])), scales: s.bag.scales, logLen: s.log.length };
      for (let i = 0; i < steps; i++) hourTick(s, payYou);
      s.lastTick += due * RULES.hourMs;
      changed();
      if (steps < 3) return null;
      return api.awayReport(before);
    },

    awayReport(before) {
      const lines = [];
      const name = { grilled: 'Fish', pearl: 'Pearl' };
      for (const item of PRODUCTS) {
        const a = before.prices[item], b = s.history[item]?.at(-1);
        if (a && b && Math.abs(b - a) / a >= 0.15) lines.push(`${name[item]} ${b > a ? 'went up' : 'got cheaper'}: ${a} → ${b} coins.`);
      }
      for (const m of Object.values(s.merchants)) {
        if (before.open[m.id] && !m.open) lines.push(`${m.name} closed. You can invest to reopen it.`);
        if (!before.open[m.id] && m.open) lines.push(`${m.name} reopened.`);
      }
      const earned = s.bag.scales - before.scales;
      if (earned > 0) lines.push(`Your investments paid ${earned} coins.`);
      if (s.day > before.day) lines.unshift(`${s.day - before.day} market day${s.day - before.day > 1 ? 's' : ''} passed.`);
      return lines.length ? lines : null;
    },

    remote: false,
    count: item => s.bag[item] || 0,

    /** Rewards from play. Battle loot rolls its pearl here, so the server can roll it instead in chain mode. */
    reward(kind, item, n = 1) {
      if (kind === 'walk') s.bag[item] = (s.bag[item] || 0) + n;
      if (kind === 'game') s.bag.scales += n;
      if (kind === 'battle') { s.bag.scales += 30; if (Math.random() < 0.1) { s.bag.pearl++; changed(); return { pearl: true }; } }
      changed();
      return { pearl: false };
    },
    /** Chain mode: the bag is whatever the items contract says. */
    setBag(bag) { s.bag = { ...s.bag, ...bag }; changed(); },
    /** Chain mode: merchants, prices and the day come from the server's market. */
    replaceShared(remote) {
      for (const k of ['day', 'hour', 'event', 'merchants', 'history', 'log']) if (k in remote) s[k] = remote[k];
      changed();
    },
    give(item, n = 1) { s.bag[item] = (s.bag[item] || 0) + n; changed(); },
    take(item, n = 1) { if ((s.bag[item] || 0) < n) return false; s.bag[item] -= n; changed(); return true; },

    /** The club gives one free Fish per market day, so a broke player's dragon never starves. */
    claimRice() { if (s.riceDay === s.day) return false; s.riceDay = s.day; s.bag.grilled++; changed(); return true; },

    quote(id, item) {
      const m = s.merchants[id];
      return { sell: m.sells.includes(item) ? sellPrice(m, item) : null, buy: m.buys.includes(item) ? buyPrice(m, item) : null,
               stock: m.stock[item], open: m.open, why: explain(m, item) };
    },

    buy(id, item) {
      const m = s.merchants[id];
      if (!m.open) return { ok: false, reason: 'CLOSED' };
      if (!m.sells.includes(item)) return { ok: false, reason: 'NOT SOLD' };
      if (m.stock[item] <= 0) return { ok: false, reason: 'SOLD OUT' };
      const price = sellPrice(m, item);
      if (s.bag.scales < price) return { ok: false, reason: 'NO COINS', price };
      s.bag.scales -= price; s.bag[item]++;
      merchantSells(s, m, item, price, payYou);
      changed();
      return { ok: true, price };
    },

    sell(id, item) {
      const m = s.merchants[id];
      if (!m.open) return { ok: false, reason: 'CLOSED' };
      if (!m.buys.includes(item)) return { ok: false, reason: 'NOT WANTED' };
      if ((s.bag[item] || 0) <= 0) return { ok: false, reason: 'NONE' };
      const price = buyPrice(m, item);
      if (!price) return { ok: false, reason: 'NO CASH' };
      s.bag[item]--; s.bag.scales += price; m.cash -= price; m.stock[item]++;
      craft(m);
      changed();
      return { ok: true, price };
    },

    invest(id, amount) {
      const m = s.merchants[id];
      if (amount <= 0 || s.bag.scales < amount) return { ok: false, reason: 'NO COINS' };
      s.bag.scales -= amount; m.cash += amount;
      const v = (m.investors.you ||= { in: 0, paid: 0 }); v.in += amount;
      let reopened = false;
      if (!m.open && m.cash >= RULES.rentPerDay) { m.open = true; reopened = true; note(s, `Day ${s.day}: you invested ${amount} coins and ${m.name} reopened.`); }
      changed();
      return { ok: true, reopened };
    },

    snapshot() {
      return {
        day: s.day, hour: s.hour % RULES.hoursPerDay, event: s.event, bag: { ...s.bag },
        merchants: Object.values(s.merchants).map(m => ({
          id: m.id, name: m.name, jp: m.jp, trade: m.trade, open: m.open, cash: m.cash, sells: m.sells, buys: m.buys,
          stock: { ...m.stock }, invested: m.investors.you ? { ...m.investors.you } : null,
          quotes: [...m.sells, ...m.buys].map(item => ({ item, ...api.quote(m.id, item) })),
        })),
        history: s.history, log: s.log.slice(0, 12),
      };
    },
    reset() { s = freshState(seed, now()); record(s); changed(); },

    // ── server side: a trade already settled on NEAR. Only the merchant changes; the bag lives on-chain. ──
    settleTrade(id, item, side, price) {
      const m = s.merchants[id];
      if (side === 'buy') { if (m.stock[item] > 0) merchantSells(s, m, item, price, payYou); }
      else { m.cash -= price; m.stock[item]++; craft(m); }
      changed();
    },
    investFrom(who, id, amount) {
      const m = s.merchants[id];
      m.cash += amount;
      const v = (m.investors[who] ||= { in: 0, paid: 0 }); v.in += amount;
      let reopened = false;
      if (!m.open && m.cash >= RULES.rentPerDay) { m.open = true; reopened = true; note(s, `Day ${s.day}: ${who} invested ${amount} coins and ${m.name} reopened.`); }
      changed();
      return { ok: true, reopened };
    },
  };
  return api;
}

/**
 * For judges: a week of trading with bot players, run from a fixed seed.
 * Uses the same rules as the live game but never touches the player's market.
 */
export function simulateWeek({ seed = 98, bots = 50, days = 7 } = {}) {
  const s = freshState(seed, 0);
  record(s);
  const editions = Object.keys(EDITION_MATERIAL);
  const roles = ['farmer', 'farmer', 'farmer', 'farmer', 'consumer', 'consumer', 'consumer', 'trader', 'trader', 'investor'];
  const people = Array.from({ length: bots }, (_, i) => ({
    id: `bot${i}`, role: roles[i % roles.length], edition: editions[i % 4],
    bag: { scales: 30, ore: 0, grilled: 2, pearl: 0 }, hunger: 0,
  }));
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  const payTo = (who, cut) => { if (byId[who]) byId[who].bag.scales += cut; };
  const M = s.merchants;
  const frames = [];
  const snap = () => frames.push({
    day: s.day, hour: s.hour,
    price: { grilled: s.history.grilled.at(-1), pearl: s.history.pearl.at(-1), ore: s.history.ore.at(-1) },
    cash: { kama: M.kama.cash, gen: M.gen.cash },
    open: { kama: M.kama.open, gen: M.gen.open },
  });
  snap();
  startDay(s);
  for (let h = 0; h < days * RULES.hoursPerDay; h++) {
    for (const p of people) {
      if (rand(s) > 0.35) continue;           // not every bot plays every hour
      if (p.role === 'farmer' || p.role === 'trader') {
        if (!(s.event === 'rain' && rand(s) < 0.85)) p.bag.ore += randInt(s, 1, 2);
        // sell embers to whichever merchant pays more right now
        while (p.bag.ore > 0) {
          const m = [M.kama, M.gen].filter(x => x.open).sort((x, y) => buyPrice(y, 'ore') - buyPrice(x, 'ore'))[0];
          const price = m ? buyPrice(m, 'ore') : 0;
          if (!price) break;
          if (p.role === 'trader' && price < ITEMS.ore.base * 1.2) break;   // traders hold out for a good price
          p.bag.ore--; p.bag.scales += price; m.cash -= price; m.stock.ore++; craft(m);
        }
      }
      p.hunger++;
      if (p.hunger >= 3 && M.kama.open && M.kama.stock.grilled > 0) {
        const price = sellPrice(M.kama, 'grilled');
        if (p.bag.scales >= price) { p.bag.scales -= price; merchantSells(s, M.kama, 'grilled', price, payTo); p.hunger = 0; }
      }
      if (rand(s) < 0.04 && M.gen.open && M.gen.stock.pearl > 0) {
        const price = sellPrice(M.gen, 'pearl');
        if (p.bag.scales >= price) { p.bag.scales -= price; merchantSells(s, M.gen, 'pearl', price, payTo); }
      }
      if (p.role === 'investor') {
        const closed = Object.values(M).find(m => !m.open);
        if (closed && p.bag.scales >= 60) {
          p.bag.scales -= 50; closed.cash += 50;
          const v = (closed.investors[p.id] ||= { in: 0, paid: 0 }); v.in += 50;
          if (closed.cash >= RULES.rentPerDay) { closed.open = true; note(s, `Day ${s.day}: an investor put 50 coins into ${closed.name}, and it reopened.`); }
        }
      }
    }
    hourTick(s, payTo);
    snap();
  }
  return { frames, log: [...s.log].reverse(), bots, days, seed };
}
