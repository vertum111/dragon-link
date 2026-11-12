// ─────────────────────────────────────────────────────────────────────────────
// Dragon Link market rules. Every price on 商店街 comes from this one file.
// Merchants are agents: they read their own stock and recent sales, and these
// functions turn that into a price and a sentence that explains it.
// ─────────────────────────────────────────────────────────────────────────────

export const RULES = {
  hourMs: 60_000,        // one market hour = one real minute
  hoursPerDay: 10,       // a market day closes every 10 minutes of play
  elasticity: 0.6,       // how hard a merchant's own stock pushes its sell price
  buyElasticity: 0.8,    // how hard stock pushes what a merchant pays for materials
  demandWeight: 0.4,     // how much last hour's sales lift the price
  minMul: 0.3,           // price never falls under 0.3 × base
  maxMul: 4,             // …or rises over 4 × base
  maxSpendShare: 0.2,    // a merchant spends at most 20% of its cash on one purchase
  rentPerDay: 20,        // paid to the club at day close; can't pay → shutters
  investorShare: 0.3,    // 30% of every sale goes to investors…
  investorCap: 1.5,      // …until each has been paid back 1.5 × what they put in
  expandAt: 400,         // a merchant with more cash than this at day close grows its stall…
  expandCost: 120,       // …which costs this much
  shrinkAt: 60,          // under this it shrinks back toward its starting size
};

export const ITEMS = {
  scales:  { name: 'Coins',        jp: '鱗', lcd: '鱗' },
  ore:     { name: 'Ember',        jp: '火', lcd: '火',   base: 6 },    // the one thing walks find
  grilled: { name: 'Fish', jp: '焼き魚', lcd: '焼魚', base: 14 },  // the one food
  pearl:   { name: 'Pearl', jp: '竜珠', lcd: '竜珠', base: 60 },  // grows a young dragon up
};

// Every edition finds embers. The two merchants compete for them: Kama grills fish with them,
// Gen makes pearls from them, so the ember price is a tug-of-war between food and growth.
export const EDITION_MATERIAL = { kiln: 'ore', ryu: 'ore', fossil: 'ore', nocturne: 'ore' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** What a merchant asks a player for one unit it makes. */
export function sellPrice(m, item) {
  const base = ITEMS[item].base;
  const scarcity = Math.pow(m.target[item] / (m.stock[item] + 1), RULES.elasticity);
  // one extra sale lifts the price a little; a rush of sales lifts it a lot
  const demand = 1 + RULES.demandWeight * ((m.soldLastHour[item] || 0) / Math.max(3, m.avgSold[item] || 0));
  return Math.max(1, Math.round(base * clamp(scarcity * demand, RULES.minMul, RULES.maxMul)));
}

/** What a merchant pays a player for one unit of a material it needs. 0 = it can't afford it. */
export function buyPrice(m, item) {
  const base = ITEMS[item].base;
  const want = Math.pow(m.target[item] / (m.stock[item] + 1), RULES.buyElasticity);
  const price = Math.max(1, Math.round(base * clamp(want, RULES.minMul, RULES.maxMul)));
  return price <= m.cash * RULES.maxSpendShare ? price : 0;
}

/** The merchant's own words for a price, built from the same numbers the formula used. */
export function explain(m, item) {
  const it = ITEMS[item], have = m.stock[item], want = m.target[item];
  if (!m.open) return `${m.name}: “Shutters are down. I couldn’t pay the ${RULES.rentPerDay} coins rent. Invest and I’ll reopen.”`;
  if (m.sells.includes(item)) {
    const p = sellPrice(m, item), sold = m.soldLastHour[item] || 0;
    const mood = have < want / 2 ? 'running low' : have > want * 1.5 ? 'overstocked' : 'about right';
    return `${m.name}: “${it.name} is ${p} coins. I have ${have}, I like to keep ${want} — ${mood}. Sold ${sold} in the last hour.”`;
  }
  const p = buyPrice(m, item);
  if (!p) return `${m.name}: “I need ${it.name}, but I can’t afford more right now.”`;
  const mood = have < want ? 'I need more' : 'I have plenty';
  return `${m.name}: “I pay ${p} coins for ${it.name}. I have ${have}, want ${want} — ${mood}.”`;
}
