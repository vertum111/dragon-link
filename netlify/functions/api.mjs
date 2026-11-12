// Dragon Link game server as one Netlify function on the game's own domain (/api/*).
// Same jobs as server/index.mjs, without a long-running process:
//   - creates the player's NEAR account (name-xxxx.dragonlink.testnet) for the public key the browser
//     or the player's Privy wallet holds; the private key never reaches us;
//   - runs the market (merchants, prices, rent, investors) and keeps merchant stock on-chain in step;
//   - signs merchant quotes; the player accepts one in their own transaction and the contract checks
//     the merchant's signature, so this server cannot move a player's tokens;
//   - relays the players' signed meta-transactions (NEP-366) and pays their gas;
//   - mints capped rewards; runs Robo, the club bot, and the LINK rooms.
// State lives in Netlify Blobs. Keys come from the site's environment variables:
//   ROOT_PRIVATE_KEY (dragonlink.testnet), MERCHANT_KEYS (JSON {kama, tsuki, gen}: quote-signing secret keys),
//   BOT_PRIVATE_KEY (bot.dragonlink.testnet).
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { Account, JsonRpcProvider, KeyPair, SCHEMA, actions, teraToGas, nearToYocto } from 'near-api-js';
import { deserialize } from 'borsh';
import { createMarket, sellPrice, buyPrice, ITEMS } from '../../work/economy/market.js';

const CFG = {
  network: 'testnet', rpc: process.env.NEAR_RPC || 'https://test.rpc.fastnear.com',
  rootAccount: 'dragonlink.testnet', itemsContract: 'items.dragonlink.testnet',
  merchants: { kama: 'kama.dragonlink.testnet', tsuki: 'tsuki.dragonlink.testnet', gen: 'gen.dragonlink.testnet' },
  explorer: 'https://testnet.nearblocks.io',
};
const BOT = `bot.${CFG.rootAccount}`;
const BOT_STOCK = { scales: 120, ore: 10, grilled: 6 };
const MARKET_KEY = 'market-v2';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const txHash = r => r?.transaction?.hash || r?.transaction_outcome?.id || null;
const okResult = r => r?.status && ('SuccessValue' in r.status || 'SuccessReceiptId' in r.status) && !(r.receipts_outcome || []).some(o => o.outcome?.status?.Failure);
const failure = r => JSON.stringify((r?.receipts_outcome || []).map(o => o.outcome?.status?.Failure).find(Boolean) || r?.status?.Failure || 'failed');
const merchantIdOf = acc => Object.keys(CFG.merchants).find(id => CFG.merchants[id] === acc);
const isPlayer = id => typeof id === 'string' && /^[a-z0-9-]{2,40}\.dragonlink\.testnet$/.test(id) && !merchantIdOf(id) && id !== CFG.itemsContract && id !== BOT;

let ctx = null;   // reused while the function instance stays warm
function context() {
  if (ctx) return ctx;
  for (const k of ['ROOT_PRIVATE_KEY', 'MERCHANT_KEYS', 'BOT_PRIVATE_KEY']) if (!process.env[k]) throw new Error(`Server is missing ${k}`);
  const provider = new JsonRpcProvider({ url: CFG.rpc });
  const root = new Account(CFG.rootAccount, provider, process.env.ROOT_PRIVATE_KEY);
  const quoteKeys = Object.fromEntries(Object.entries(JSON.parse(process.env.MERCHANT_KEYS)).map(([id, k]) => [id, KeyPair.fromString(k)]));
  const bot = new Account(BOT, provider, process.env.BOT_PRIVATE_KEY);
  const call = (methodName, args, gas = 30) => root.callFunction({ contractId: CFG.itemsContract, methodName, args, gas: teraToGas(gas), deposit: 0n });
  ctx = { provider, root, quoteKeys, bot, call, hits: new Map() };
  return ctx;
}

// ── the market, loaded from Blobs for each request and saved back if it changed ──
async function loadMarket(store) {
  const text = await store.get(MARKET_KEY);
  const mem = new Map(text ? [[MARKET_KEY, text]] : []);
  const payouts = [];
  const market = createMarket({ storage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) }, storeKey: MARKET_KEY, onPayout: (who, cut) => payouts.push([who, cut]) });
  return { market, payouts, save: async () => { const t = mem.get(MARKET_KEY); if (t && t !== text) await store.set(MARKET_KEY, t); } };
}
async function syncMerchants(store, market) {
  const plan = market.snapshot().merchants.map(m => ({ id: m.id, tokens: ['scales', ...Object.keys(m.stock)], amounts: [String(Math.max(0, Math.round(m.cash))), ...Object.values(m.stock).map(String)] }));
  const sig = JSON.stringify(plan);
  if (sig === await store.get('merchants-synced')) return;
  const acts = plan.map(p => actions.functionCall('set_merchant_stock', { merchant_id: CFG.merchants[p.id], token_ids: p.tokens, amounts: p.amounts }, teraToGas(60), 0n));
  try { await context().root.signAndSendTransaction({ receiverId: CFG.itemsContract, actions: acts }); await store.set('merchants-synced', sig); }
  catch (e) { console.warn('merchant sync failed:', e.message); }
}
async function flushPayouts(payouts) {
  for (const [who, cut] of payouts) {
    if (!isPlayer(who)) continue;
    try { await context().call('mint', { owner_id: who, token_ids: ['scales'], amounts: [String(cut)], memo: 'investor payout' }); }
    catch (e) { console.warn('payout failed:', e.message); }
  }
}

// ── limits: rewards are reported by the browser, so they are capped and rate-limited ──
async function cooldown(store, key, ms) {
  const t = Date.now(), prev = Number(await store.get(`cd:${key}`)) || 0;
  if (t - prev < ms) return false;
  await store.set(`cd:${key}`, String(t));
  return true;
}

// ── Robo, the club bot ──
function valueOf(market, item) {
  const ms = Object.values(market.state.merchants);
  if (item === 'scales') return 1;
  const seller = ms.find(m => m.sells.includes(item)), buyer = ms.find(m => m.buys.includes(item));
  if (seller) return sellPrice(seller, item);
  if (buyer) return buyPrice(buyer, item) || ITEMS[item]?.base || 5;
  return ITEMS[item]?.base || 5;
}
async function botRestock() {
  const { provider, call } = context(), ids = Object.keys(BOT_STOCK);
  const have = await provider.callFunction({ contractId: CFG.itemsContract, method: 'mt_batch_balance_of', args: { account_id: BOT, token_ids: ids } });
  const top = ids.map((t, i) => [t, BOT_STOCK[t] - Number(have[i])]).filter(([, n]) => n > 0);
  if (top.length) await call('mint', { owner_id: BOT, token_ids: top.map(x => x[0]), amounts: top.map(x => String(x[1])), memo: 'club bot restock' });
}
async function botReview(market) {
  const { provider, bot } = context();
  const offers = await provider.callFunction({ contractId: CFG.itemsContract, method: 'offers_for', args: { account_id: BOT } });
  const worth = list => list.reduce((a, [t, n]) => a + valueOf(market, t) * Number(n), 0);
  const out = [];
  for (const o of offers || []) {
    if (o.to !== BOT) continue;
    const get = worth(o.give), give = worth(o.want), ids = o.want.map(([t]) => t);
    const have = ids.length ? await provider.callFunction({ contractId: CFG.itemsContract, method: 'mt_batch_balance_of', args: { account_id: BOT, token_ids: ids } }) : [];
    const short = o.want.find(([, n], i) => Number(have[i]) < Number(n)), fair = get >= give * 0.9, accept = !short && fair;
    const reason = short ? `I only have ${have[o.want.indexOf(short)]} ${ITEMS[short[0]]?.name || short[0]}.`
      : fair ? `You give about ${get} coins worth, I give about ${give} coins worth. Deal!`
      : `You give about ${get} coins worth, but you ask for about ${give} coins worth. Add a little more?`;
    try { await bot.callFunction({ contractId: CFG.itemsContract, methodName: accept ? 'offer_accept' : 'offer_cancel', args: { id: o.id }, gas: teraToGas(60) }); out.push({ id: o.id, accepted: accept, reason, value: { get, give } }); }
    catch (e) { out.push({ id: o.id, accepted: false, reason: `Robo could not finish: ${e.message}` }); }
  }
  if (out.some(x => x.accepted)) await botRestock().catch(() => {});
  return out;
}

// ── routes ──
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const who = p => ({ account: String(p.account || ''), name: String(p.name || 'Friend').slice(0, 20), edition: ['kiln', 'ryu', 'fossil', 'nocturne'].includes(p.edition) ? p.edition : 'ryu' });

const routes = {
  'GET /api/config': async () => ({ network: CFG.network, rpc: CFG.rpc, items: CFG.itemsContract, root: CFG.rootAccount, merchants: CFG.merchants, explorer: CFG.explorer }),
  'GET /api/health': async ({ market }) => ({ ok: true, day: market.state.day, hour: market.state.hour }),
  'GET /api/market': async ({ market }) => { const s = market.snapshot(); delete s.bag; return s; },
  'GET /api/market/state': async ({ market }) => { const s = market.state; return { day: s.day, hour: s.hour, event: s.event, merchants: s.merchants, history: s.history, log: s.log.slice(0, 30) }; },
  'GET /api/bot': async ({ market }) => ({ account: BOT, name: 'Robo', edition: 'fossil', values: Object.fromEntries(Object.keys(BOT_STOCK).map(t => [t, valueOf(market, t)])) }),

  // One account per key: the same browser key or the same Privy wallet always gets the same account back.
  'POST /api/account': async ({ body, store, ip }) => {
    const publicKey = String(body.publicKey || '');
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{40,50}$/.test(publicKey)) throw new Error('Expected an ed25519 public key.');
    const known = await store.get(`acct:${publicKey}`);
    if (known) return { accountId: known, existing: true };
    if (!await cooldown(store, `acct-ip:${ip}`, 8_000)) throw new Error('Too many new accounts; wait a few seconds.');
    const base = String(body.name || 'player').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'player';
    const prefix = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    const accountId = `${prefix}.${CFG.rootAccount}`;
    const { root, call } = context();
    await root.createSubAccount({ accountOrPrefix: prefix, publicKey, nearToTransfer: nearToYocto('0.03') });
    const r = await call('mint', { owner_id: accountId, token_ids: ['scales', 'grilled'], amounts: ['20', '5'], memo: 'starter kit' });
    await store.set(`acct:${publicKey}`, accountId);
    return { accountId, txHash: txHash(r) };
  },

  'POST /api/quote': async ({ body, market }) => {
    const { player, merchant, item, side } = body;
    if (!isPlayer(player)) throw new Error('unknown player');
    const m = market.state.merchants[merchant];
    if (!m) throw new Error('unknown merchant');
    if (!m.open) throw new Error('CLOSED');
    let give, take, price;
    if (side === 'buy') {
      if (!m.sells.includes(item)) throw new Error('NOT SOLD');
      if (m.stock[item] <= 0) throw new Error('SOLD OUT');
      price = sellPrice(m, item); give = ['scales', price]; take = [item, 1];
    } else {
      if (!m.buys.includes(item)) throw new Error('NOT WANTED');
      price = buyPrice(m, item); if (!price) throw new Error('NO CASH');
      give = [item, 1]; take = ['scales', price];
    }
    const quote = { merchant: CFG.merchants[merchant], player, give_token: give[0], give_amount: String(give[1]), take_token: take[0], take_amount: String(take[1]),
      nonce: Date.now() * 100 + crypto.randomInt(100), expires_at_ms: Date.now() + 120_000 };
    const message = `dragonlink-quote:v1:${quote.merchant}:${quote.player}:${quote.give_token}:${quote.give_amount}:${quote.take_token}:${quote.take_amount}:${quote.nonce}:${quote.expires_at_ms}`;
    const signature = Buffer.from(context().quoteKeys[merchant].sign(Buffer.from(message)).signature).toString('base64');
    return { quote, signature, price };
  },

  'POST /api/relay': async ({ body, market, store }) => {
    const sd = deserialize(SCHEMA.SignedDelegate, Buffer.from(String(body.signedDelegate || ''), 'base64'));
    const da = sd.delegateAction;
    if (da.receiverId !== CFG.itemsContract) throw new Error('relay only to the items contract');
    if (!isPlayer(da.senderId)) throw new Error('relay only for game players');
    const calls = da.actions.map(a => a.functionCall);
    const allowed = ['trade', 'consume', 'mt_transfer', 'mt_batch_transfer', 'offer_create', 'offer_accept', 'offer_cancel'];
    if (!calls.length || calls.some(c => !c || !allowed.includes(c.methodName) || BigInt(c.deposit) > 1n || BigInt(c.gas) > teraToGas(100))) throw new Error('action not allowed');
    const r = await context().root.relayMetaTransaction(sd);
    if (!okResult(r)) return { ok: false, error: failure(r), txHash: txHash(r) };
    for (const c of calls) {
      const args = JSON.parse(Buffer.from(c.args).toString());
      if (c.methodName === 'trade') {   // the quote itself says what was traded, so the market follows the chain
        const q = args.quote, id = merchantIdOf(q.merchant);
        const side = q.give_token === 'scales' ? 'buy' : 'sell', item = side === 'buy' ? q.take_token : q.give_token;
        if (id) market.settleTrade(id, item, side, Number(side === 'buy' ? q.give_amount : q.take_amount));
      }
      if (c.methodName === 'mt_transfer' && String(args.memo || '').startsWith('invest:')) {
        const id = merchantIdOf(args.receiver_id);
        if (id && args.token_id === 'scales') market.investFrom(da.senderId, id, Number(args.amount));
      }
    }
    await syncMerchants(store, market);
    const toBot = calls.some(c => c.methodName === 'offer_create' && JSON.parse(Buffer.from(c.args).toString()).to === BOT);
    const bot = toBot ? await botReview(market) : undefined;
    return { ok: true, txHash: txHash(r), bot };
  },

  'POST /api/reward': async ({ body, market, store }) => {
    const { player, kind, item, amount } = body;
    if (!isPlayer(player)) throw new Error('unknown player');
    let tokens = [], amounts = [];
    if (kind === 'walk') {
      if (item !== 'ore' || !await cooldown(store, `walk:${player}`, 2_500)) throw new Error('not now');
      tokens = [item]; amounts = [Math.min(2, Math.max(1, amount | 0))];
    } else if (kind === 'game') {
      if (!await cooldown(store, `game:${player}`, 8_000)) throw new Error('not now');
      tokens = ['scales']; amounts = [Math.min(40, Math.max(0, amount | 0))];
    } else if (kind === 'battle') {
      if (!await cooldown(store, `battle:${player}`, 30_000)) throw new Error('not now');
      tokens = ['scales']; amounts = [30];
      if (Math.random() < 0.1) { tokens.push('pearl'); amounts.push(1); }
    } else if (kind === 'rice') {
      if (!await cooldown(store, `rice:${player}:${market.state.day}`, 1e12)) throw new Error('already claimed today');
      tokens = ['grilled']; amounts = [1];
    } else throw new Error('unknown reward');
    if (!amounts[0]) return { ok: true, minted: {} };
    const r = await context().call('mint', { owner_id: player, token_ids: tokens, amounts: amounts.map(String), memo: `${kind} reward` });
    return { ok: okResult(r), minted: Object.fromEntries(tokens.map((t, i) => [t, amounts[i]])), txHash: txHash(r) };
  },

  // LINK rooms: a 4-letter code for two players online
  'POST /api/room': async ({ body, store }) => {
    let code;
    do code = Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join(''); while (await store.get(`room:${code}`));
    await store.setJSON(`room:${code}`, { code, host: who(body), guest: null, touched: Date.now() });
    return { code };
  },
  'POST /api/room/join': async ({ body, store }) => {
    const code = String(body.code || '').toUpperCase(), r = await store.get(`room:${code}`, { type: 'json' });
    if (!r || Date.now() - r.touched > 30 * 60_000) throw new Error('No room with that code. Check the letters with your friend.');
    if (r.guest && r.guest.account !== body.account) throw new Error('That room already has two players.');
    r.guest = who(body); r.touched = Date.now(); await store.setJSON(`room:${code}`, r);
    return { code: r.code, friend: r.host };
  },
  'POST /api/room/status': async ({ body, store }) => {
    const code = String(body.code || '').toUpperCase(), r = await store.get(`room:${code}`, { type: 'json' });
    if (!r || Date.now() - r.touched > 30 * 60_000) return { open: false };
    r.touched = Date.now(); await store.setJSON(`room:${code}`, r);
    return { open: true, friend: r.host.account === body.account ? r.guest : r.host };
  },
  'POST /api/room/leave': async ({ body, store }) => {
    const code = String(body.code || '').toUpperCase(), r = await store.get(`room:${code}`, { type: 'json' });
    if (r && (r.host.account === body.account || r.guest?.account === body.account)) await store.delete(`room:${code}`);
    return { ok: true };
  },
};

export default async (req, netlifyContext) => {
  const url = new URL(req.url);
  const route = routes[`${req.method} ${url.pathname.replace(/\/+$/, '')}`];
  if (!route) return json(404, { ok: false, error: 'not found' });
  try {
    const store = getStore('dragon-link');
    const { market, payouts, save } = await loadMarket(store);
    const ticked = market.update() != null;
    let body = {};
    if (req.method === 'POST') { const text = await req.text(); if (text.length > 64_000) return json(413, { ok: false, error: 'too large' }); body = text ? JSON.parse(text) : {}; }
    const out = await route({ body, market, store, ip: netlifyContext?.ip || '' });
    await save();
    if (ticked) { await syncMerchants(store, market); await flushPayouts(payouts); }
    return json(200, out);
  } catch (e) {
    return json(400, { ok: false, error: String(e.message).slice(0, 300) });
  }
};

export const config = { path: '/api/*' };
