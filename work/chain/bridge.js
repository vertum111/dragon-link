// Chain mode: when the page is served by the Dragon Link game server (server/index.mjs), the market
// settles on NEAR testnet. The player never sees a wallet: the browser makes a key, the server creates
// the account and relays the player's signed meta-transactions, so gas is never the player's problem.
//
// The game keeps calling the same market API. Each action applies to the local copy at once (so the
// LCD responds instantly) and is queued for the chain; after every settlement the bag is re-read from
// the items contract, so the contract always has the last word.
import { Account, JsonRpcProvider, KeyPair, actions, teraToGas, encodeSignedDelegate } from 'near-api-js';
import { ITEMS } from '../economy/pricing.js';

const KEY = 'dragon-link-near-v1';
const TOKENS = ['scales', 'ore', 'grilled', 'pearl'];
const b64 = bytes => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

export async function connectChain() {
  if (location.protocol === 'file:') return null;
  let cfg;
  try { const r = await fetch('/api/config'); if (!r.ok) return null; cfg = await r.json(); } catch { return null; }
  if (!cfg?.items) return null;
  const provider = new JsonRpcProvider({ url: cfg.rpc });
  const post = async (path, body) => {
    const r = await fetch(path, { method: 'POST', body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.error || `request failed (${r.status})`);
    return j;
  };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
  let account = saved ? new Account(saved.accountId, provider, saved.secretKey) : null;

  return {
    cfg,
    get accountId() { return account?.accountId || null; },
    explorerTx: h => `${cfg.explorer}/txns/${h}`,
    explorerAccount: id => `${cfg.explorer}/address/${id}`,
    /** First sign-in on this device: make a key here, ask the server to create the account for it. */
    async login(name) {
      if (account) return account.accountId;
      const kp = KeyPair.fromRandom('ed25519');
      const { accountId } = await post('/api/account', { name, publicKey: kp.getPublicKey().toString() });
      try { localStorage.setItem(KEY, JSON.stringify({ accountId, secretKey: kp.toString() })); } catch {}
      account = new Account(accountId, provider, kp.toString());
      return accountId;
    },
    async balances(of = account.accountId) {
      const b = await provider.callFunction({ contractId: cfg.items, method: 'mt_batch_balance_of', args: { account_id: of, token_ids: TOKENS } });
      return Object.fromEntries(TOKENS.map((k, i) => [k, Number(b[i])]));
    },
    offers: () => provider.callFunction({ contractId: cfg.items, method: 'offers_for', args: { account_id: account.accountId } }),
    bot: () => fetch('/api/bot').then(r => r.json()),
    room: {
      host: me => post('/api/room', me),
      join: (code, me) => post('/api/room/join', { code, ...me }),
      status: code => post('/api/room/status', { code, account: account?.accountId }),
      leave: code => post('/api/room/leave', { code, account: account?.accountId }),
    },
    /** A call to the items contract, signed here and relayed by the server (NEP-366). */
    async send(method, args, deposit = 0n) {
      const { signedDelegate } = await account.createSignedMetaTransaction({ receiverId: cfg.items, actions: [actions.functionCall(method, args, teraToGas(50), deposit)] });
      return post('/api/relay', { signedDelegate: b64(encodeSignedDelegate(signedDelegate)) });
    },
    quote: (merchant, item, side) => post('/api/quote', { player: account.accountId, merchant, item, side }),
    reward: (kind, item, amount) => post('/api/reward', { player: account.accountId, kind, item, amount }),
    shared: () => fetch('/api/market/state').then(r => r.json()),
  };
}

export function bridgeMarket(market, chain) {
  market.remote = true;
  market.chain = chain;
  const status = (state, label, extra = {}) => window.dispatchEvent(new CustomEvent('dragonlink:chain', { detail: { state, label, ...extra } }));
  const refreshShared = async () => { try { market.replaceShared(await chain.shared()); } catch {} };
  const refreshBag = async () => { if (!chain.accountId) return; try { market.setBag(await chain.balances()); } catch (e) { console.warn(e); } };
  refreshShared();
  setInterval(refreshShared, 5000);

  // one chain operation at a time, so the player's access-key nonces stay in order
  const queue = [];
  let busy = false;
  const run = (label, fn) => new Promise(done => { queue.push([label, fn, done]); pump(); });
  async function pump() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const [label, fn, done] = queue.shift();
      status('pending', label);
      try {
        const r = await fn();
        const err = r?.ok === false ? (String(r.error).match(/panicked: ([^"\\]+)/)?.[1] || 'rejected') : null;
        status(err ? 'error' : 'ok', label, { error: err, txHash: r?.txHash, url: r?.txHash ? chain.explorerTx(r.txHash) : null, minted: r?.minted });
        done?.({ ...r, error: err || undefined, ok: !err });
      } catch (e) {
        status('error', label, { error: e.message });
        done?.({ ok: false, error: e.message });
      }
    }
    busy = false;
    await refreshBag();
    await refreshShared();
  }

  const local = { buy: market.buy, sell: market.sell, take: market.take, reward: market.reward, claimRice: market.claimRice, invest: market.invest };
  const name = item => ITEMS[item]?.name || item;
  const online = () => !!chain.accountId;

  market.buy = (id, item) => {
    const r = local.buy(id, item);
    if (r.ok && online()) run(`Bought ${name(item)}`, async () => { const q = await chain.quote(id, item, 'buy'); return chain.send('trade', { quote: q.quote, signature: q.signature }); });
    return r;
  };
  market.sell = (id, item) => {
    const r = local.sell(id, item);
    if (r.ok && online()) run(`Sold ${name(item)}`, async () => { const q = await chain.quote(id, item, 'sell'); return chain.send('trade', { quote: q.quote, signature: q.signature }); });
    return r;
  };
  market.take = (item, n = 1) => {
    const ok = local.take(item, n);
    if (ok && online()) run(`${name(item)} used`, () => chain.send('consume', { token_id: item, amount: String(n) }));
    return ok;
  };
  market.claimRice = () => {
    const ok = local.claimRice();
    if (ok && online()) run('Free rice ball', () => chain.reward('rice'));
    return ok;
  };
  market.reward = (kind, item, n) => {
    if (!online()) return local.reward(kind, item, n);
    // the server rolls the battle pearl, so show only the sure part now
    if (kind === 'battle') market.setBag({ scales: market.count('scales') + 30 });
    else local.reward(kind, item, n);
    const label = kind === 'walk' ? `Found ${name(item)}` : kind === 'game' ? `Won ${n} coins` : 'Battle loot';
    run(label, async () => {
      const r = await chain.reward(kind, item, n);
      if (r.minted?.pearl) status('ok', 'A Pearl dropped from the Shadow Wyrm!', { txHash: r.txHash, url: chain.explorerTx(r.txHash) });
      return r;
    });
    return { pearl: false };
  };
  market.invest = (id, amount) => {
    if (!online()) return local.invest(id, amount);
    if (market.count('scales') < amount) return { ok: false, reason: 'NO COINS' };
    market.setBag({ scales: market.count('scales') - amount });
    run(`Invested ${amount} coins in ${id}`, () => chain.send('mt_transfer', { receiver_id: chain.cfg.merchants[id], token_id: 'scales', amount: String(amount), memo: `invest:${id}` }, 1n));
    return { ok: true, reopened: false };
  };
  // LINK gift: the item really moves to the friend's account (NEP-245 mt_transfer)
  market.gift = (to, item, n = 1) => {
    if (!online() || !to) return local.take(item, n);
    if (market.count(item) < n) return false;
    market.setBag({ [item]: market.count(item) - n });
    run(`Gave ${n} ${name(item)} to ${to.split('.')[0]}`, () => chain.send('mt_transfer', { receiver_id: to, token_id: item, amount: String(n), memo: 'link gift' }, 1n));
    return true;
  };
  // LINK trades: offers go through escrow in the items contract
  const pairs = obj => Object.entries(obj).filter(([, n]) => n > 0).map(([t, n]) => [t, String(n)]);
  market.offer = (to, give, want) => run('Trade offer sent', () => chain.send('offer_create', { to, give: pairs(give), want: pairs(want) }));
  market.acceptOffer = id => run('Trade accepted', () => chain.send('offer_accept', { id }));
  market.cancelOffer = id => run('Trade declined', () => chain.send('offer_cancel', { id }));

  market.login = async displayName => {
    status('pending', 'Setting up your game account');
    try {
      const id = await chain.login(displayName);
      status('ok', 'Game account ready', { account: id, url: chain.explorerAccount(id) });
      await refreshBag();
      return id;
    } catch (e) { status('error', 'Could not create your game account', { error: e.message }); return null; }
  };
  if (online()) refreshBag();
  return chain;
}
