// Dragon Link game server: serves the game, runs 商店街 (the authoritative market), and is the
// players' relayer on NEAR testnet so they never see a wallet, a seed phrase or a gas fee.
//
//   node server/index.mjs            (after `node server/setup.mjs` has written server/config.json)
//
// What it does on-chain, and why the player stays in control:
//   - creates `name-xxxx.<root>` for a new player with the public key the browser generated
//     (the private key never leaves the browser);
//   - signs merchant *quotes*; the player accepts one in their own (relayed) transaction and the
//     items contract checks the merchant's signature, so the server cannot move a player's tokens;
//   - relays players' signed meta-transactions (NEP-366), only to the items contract, only for
//     trade / consume / mt_transfer / mt_batch_transfer;
//   - mints rewards (walk finds, game scores, battle loot) within fixed limits;
//   - keeps merchant stock on-chain equal to the market every market hour.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, SCHEMA, actions, teraToGas, nearToYocto } from 'near-api-js';
import { deserialize } from 'borsh';
import { createMarket, sellPrice, buyPrice, ITEMS, RULES } from '../work/economy/market.js';
import { createLink } from './link.mjs';

const HERE = import.meta.dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const STATE = path.join(HERE, 'state');
fs.mkdirSync(STATE, { recursive: true });
const credential = id => JSON.parse(fs.readFileSync(path.join(os.homedir(), '.near-credentials', cfg.network, `${id}.json`), 'utf8')).private_key;

const provider = new JsonRpcProvider({ url: cfg.rpc });
const root = new Account(cfg.rootAccount, provider, credential(cfg.rootAccount));   // owner + operator
const quoteKeys = JSON.parse(fs.readFileSync(path.join(STATE, 'merchant-keys.json'), 'utf8'));
const signer = Object.fromEntries(Object.entries(quoteKeys).map(([id, k]) => [id, KeyPair.fromString(k.secretKey)]));
const merchantAccount = id => cfg.merchants[id];
const merchantIdOf = acc => Object.keys(cfg.merchants).find(id => cfg.merchants[id] === acc);

// ── the market: same engine and rules as the browser, persisted to a file ──
const fileStore = {
  getItem: k => { try { return fs.readFileSync(path.join(STATE, `${k}.json`), 'utf8'); } catch { return null; } },
  setItem: (k, v) => fs.writeFileSync(path.join(STATE, `${k}.json`), v),
};
const payouts = [];
const market = createMarket({ storage: fileStore, storeKey: 'market-v2', onPayout: (who, cut) => payouts.push([who, cut]) });

// ── chain helpers ──
const call = (methodName, args, gas = 30) =>
  root.callFunction({ contractId: cfg.itemsContract, methodName, args, gas: teraToGas(gas), deposit: 0n });
const txHash = r => r?.transaction?.hash || r?.transaction_outcome?.id || null;
const ok = r => r?.status && ('SuccessValue' in r.status || 'SuccessReceiptId' in r.status) &&
  !(r.receipts_outcome || []).some(o => o.outcome?.status?.Failure);
const failure = r => JSON.stringify((r?.receipts_outcome || []).map(o => o.outcome?.status?.Failure).find(Boolean) || r?.status?.Failure || 'failed');

let lastSynced = '';
async function syncMerchants() {
  const snap = market.snapshot();
  const plan = snap.merchants.map(m => ({ id: m.id, tokens: ['scales', ...Object.keys(m.stock)], amounts: [String(Math.max(0, Math.round(m.cash))), ...Object.values(m.stock).map(String)] }));
  const sig = JSON.stringify(plan);
  if (sig === lastSynced) return;
  const acts = plan.map(p => actions.functionCall('set_merchant_stock', { merchant_id: merchantAccount(p.id), token_ids: p.tokens, amounts: p.amounts }, teraToGas(60), 0n));
  try { await root.signAndSendTransaction({ receiverId: cfg.itemsContract, actions: acts }); lastSynced = sig; }
  catch (e) { console.warn('merchant sync failed:', e.message); }
}
async function flushPayouts() {
  while (payouts.length) {
    const [who, cut] = payouts.shift();
    if (!who.endsWith(`.${cfg.rootAccount}`)) continue;
    try { await call('mint', { owner_id: who, token_ids: ['scales'], amounts: [String(cut)], memo: 'investor payout' }); }
    catch (e) { console.warn('payout failed:', e.message); }
  }
}
setInterval(async () => { if (market.update() !== undefined) { await syncMerchants(); await flushPayouts(); } }, 5_000);

// ── limits (rewards are client-reported, so they are capped and rate-limited) ──
const last = new Map();
const cooldown = (key, ms) => { const t = Date.now(), prev = last.get(key) || 0; if (t - prev < ms) return false; last.set(key, t); return true; };
const isPlayer = id => typeof id === 'string' && /^[a-z0-9-]{2,40}\.[a-z0-9._-]+$/.test(id) && id.endsWith(`.${cfg.rootAccount}`) && !merchantIdOf(id) && id !== cfg.itemsContract && id !== `bot.${cfg.rootAccount}`;
const MATERIALS = ['ore'];
const pending = new Map();   // quote nonce → what it was for, so a settled trade updates the market
const link = createLink({ cfg, provider, root, market, stateDir: STATE, call });
let nonceSeq = 0;

const routes = {
  'GET /api/config': async () => ({ network: cfg.network, rpc: cfg.rpc, items: cfg.itemsContract, root: cfg.rootAccount, merchants: cfg.merchants, explorer: cfg.explorer }),

  'GET /api/market': async () => { const s = market.snapshot(); delete s.bag; return s; },

  // the shared part of the market (merchants, prices, day) in the engine's own shape, for browsers in chain mode
  'GET /api/market/state': async () => {
    const s = market.state;
    return { day: s.day, hour: s.hour, event: s.event, merchants: s.merchants, history: s.history, log: s.log.slice(0, 30) };
  },

  'POST /api/account': async ({ name, publicKey }, req) => {
    if (!cooldown(`acct:${req.socket.remoteAddress}`, 8_000)) throw new Error('Too many new accounts; wait a few seconds.');
    const base = String(name || 'player').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'player';
    const prefix = `${base}-${crypto.randomBytes(2).toString('hex')}`;
    const accountId = `${prefix}.${cfg.rootAccount}`;
    await root.createSubAccount({ accountOrPrefix: prefix, publicKey, nearToTransfer: nearToYocto('0.03') });
    const r = await call('mint', { owner_id: accountId, token_ids: ['scales', 'grilled'], amounts: ['20', '5'], memo: 'starter kit' });
    return { accountId, txHash: txHash(r) };
  },

  'POST /api/quote': async ({ player, merchant, item, side }) => {
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
    const quote = { merchant: merchantAccount(merchant), player, give_token: give[0], give_amount: String(give[1]),
      take_token: take[0], take_amount: String(take[1]), nonce: Date.now() * 100 + (nonceSeq++ % 100), expires_at_ms: Date.now() + 120_000 };
    const message = `dragonlink-quote:v1:${quote.merchant}:${quote.player}:${quote.give_token}:${quote.give_amount}:${quote.take_token}:${quote.take_amount}:${quote.nonce}:${quote.expires_at_ms}`;
    const signature = Buffer.from(signer[merchant].sign(Buffer.from(message)).signature).toString('base64');
    pending.set(quote.nonce, { merchant, item, side, price, expires: quote.expires_at_ms });
    return { quote, signature, price };
  },

  'POST /api/relay': async ({ signedDelegate }) => {
    const sd = deserialize(SCHEMA.SignedDelegate, Buffer.from(signedDelegate, 'base64'));
    const da = sd.delegateAction;
    if (da.receiverId !== cfg.itemsContract) throw new Error('relay only to the items contract');
    if (!isPlayer(da.senderId)) throw new Error('relay only for game players');
    const calls = da.actions.map(a => a.functionCall);
    const allowed = ['trade', 'consume', 'mt_transfer', 'mt_batch_transfer', 'offer_create', 'offer_accept', 'offer_cancel'];
    if (!calls.length || calls.some(c => !c || !allowed.includes(c.methodName) || BigInt(c.deposit) > 1n || BigInt(c.gas) > teraToGas(100)))
      throw new Error('action not allowed');
    const r = await root.relayMetaTransaction(sd);
    if (!ok(r)) return { ok: false, error: failure(r), txHash: txHash(r) };
    // keep the market in step with what just settled
    for (const c of calls) {
      const args = JSON.parse(Buffer.from(c.args).toString());
      if (c.methodName === 'trade') {
        const p = pending.get(args.quote.nonce);
        if (p) { pending.delete(args.quote.nonce); market.settleTrade(p.merchant, p.item, p.side, p.price); }
      }
      if (c.methodName === 'mt_transfer' && String(args.memo || '').startsWith('invest:')) {
        const id = merchantIdOf(args.receiver_id);
        if (id && args.token_id === 'scales') market.investFrom(da.senderId, id, Number(args.amount));
      }
    }
    syncMerchants();
    // an offer to Robo, the club bot: it answers straight away
    const toBot = calls.some(c => c.methodName === 'offer_create' && JSON.parse(Buffer.from(c.args).toString()).to === link.BOT);
    const bot = toBot ? await link.botReview() : undefined;
    return { ok: true, txHash: txHash(r), bot };
  },

  'POST /api/reward': async ({ player, kind, item, amount }) => {
    if (!isPlayer(player)) throw new Error('unknown player');
    let tokens = [], amounts = [];
    if (kind === 'walk') {
      if (!MATERIALS.includes(item) || !cooldown(`walk:${player}`, 2_500)) throw new Error('not now');
      tokens = [item]; amounts = [Math.min(2, Math.max(1, amount | 0))];
    } else if (kind === 'game') {
      if (!cooldown(`game:${player}`, 8_000)) throw new Error('not now');
      tokens = ['scales']; amounts = [Math.min(40, Math.max(0, amount | 0))];
    } else if (kind === 'battle') {
      if (!cooldown(`battle:${player}`, 30_000)) throw new Error('not now');
      tokens = ['scales']; amounts = [30];
      if (Math.random() < 0.1) { tokens.push('pearl'); amounts.push(1); }
    } else if (kind === 'rice') {
      if (!cooldown(`rice:${player}:${market.state.day}`, 1e12)) throw new Error('already claimed today');
      tokens = ['grilled']; amounts = [1];   // the club's free fish for the day
    } else throw new Error('unknown reward');
    if (!amounts[0]) return { ok: true, minted: {} };
    const r = await call('mint', { owner_id: player, token_ids: tokens, amounts: amounts.map(String), memo: `${kind} reward` });
    return { ok: ok(r), minted: Object.fromEntries(tokens.map((t, i) => [t, amounts[i]])), txHash: txHash(r) };
  },
};

// ── static files: the built game in outputs/dragon-link ──
const WEB = path.resolve(HERE, cfg.staticDir || '../outputs/dragon-link');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2' };

Object.assign(routes, link.routes);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const route = routes[`${req.method} ${url.pathname}`];
  if (route) {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 64_000) break; }
    try {
      const out = await route(body ? JSON.parse(body) : {}, req);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }
  const file = path.join(WEB, decodeURIComponent(url.pathname === '/' ? '/dragon-link-manual.html' : url.pathname));
  if (!file.startsWith(WEB)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end('not found');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(data);
  });
}).listen(cfg.port || 8787, () => {
  console.log(`Dragon Link on http://localhost:${cfg.port || 8787}  ·  ${cfg.network}  ·  items ${cfg.itemsContract}`);
  syncMerchants();
  link.ensureBot().then(() => console.log('Robo the club bot is ready:', link.BOT)).catch(e => console.warn('bot setup failed:', e.message));
});
