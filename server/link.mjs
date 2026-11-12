// LINK on the server: rooms with a 4-letter code for two players online, and Robo, the Ember Club bot,
// an agent with its own NEAR wallet that trades with anyone who has no friend online.
import fs from 'node:fs';
import path from 'node:path';
import { Account, KeyPair, teraToGas, nearToYocto } from 'near-api-js';
import { ITEMS, sellPrice, buyPrice } from '../work/economy/market.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOM_TTL = 30 * 60_000;

export function createLink({ cfg, provider, root, market, stateDir, call }) {
  // ── rooms ──
  const rooms = new Map();
  const tidy = () => { const t = Date.now(); for (const [k, r] of rooms) if (t - r.touched > ROOM_TTL) rooms.delete(k); };
  const who = p => ({ account: String(p.account || ''), name: String(p.name || 'Friend').slice(0, 20), edition: ['kiln', 'ryu', 'fossil', 'nocturne'].includes(p.edition) ? p.edition : 'ryu' });

  // ── Robo, the club bot ──
  const BOT = `bot.${cfg.rootAccount}`;
  const botKeyFile = path.join(stateDir, 'bot-key.json');
  let bot = null;
  const STOCK = { scales: 120, ore: 10, grilled: 6 };

  async function ensureBot() {
    let secret;
    if (fs.existsSync(botKeyFile)) secret = JSON.parse(fs.readFileSync(botKeyFile, 'utf8')).secretKey;
    let exists = true;
    try { await provider.viewAccount({ accountId: BOT }); } catch { exists = false; }
    if (!exists) {
      const kp = KeyPair.fromRandom('ed25519'); secret = kp.toString();
      fs.writeFileSync(botKeyFile, JSON.stringify({ accountId: BOT, secretKey: secret }), { mode: 0o600 });
      await root.createSubAccount({ accountOrPrefix: 'bot', publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto('1') });
      console.log('created', BOT);
    }
    bot = new Account(BOT, provider, secret);
    await restock();
  }
  async function restock() {
    const ids = Object.keys(STOCK);
    const have = await provider.callFunction({ contractId: cfg.itemsContract, method: 'mt_batch_balance_of', args: { account_id: BOT, token_ids: ids } });
    const top = ids.map((t, i) => [t, STOCK[t] - Number(have[i])]).filter(([, n]) => n > 0);
    if (top.length) await call('mint', { owner_id: BOT, token_ids: top.map(x => x[0]), amounts: top.map(x => String(x[1])), memo: 'club bot restock' });
  }

  // what an item is worth on the street right now: what a merchant pays for materials, what it asks for goods
  function valueOf(item) {
    const ms = Object.values(market.state.merchants);
    const seller = ms.find(m => m.sells.includes(item)), buyer = ms.find(m => m.buys.includes(item));
    if (item === 'scales') return 1;
    if (seller) return sellPrice(seller, item);
    if (buyer) return buyPrice(buyer, item) || ITEMS[item]?.base || 5;
    return ITEMS[item]?.base || 5;
  }
  const worth = list => list.reduce((a, [t, n]) => a + valueOf(t) * Number(n), 0);

  // Robo's rule: take any trade where it gets at least 90% of what it gives, by today's street prices
  async function botReview() {
    const offers = await provider.callFunction({ contractId: cfg.itemsContract, method: 'offers_for', args: { account_id: BOT } });
    const out = [];
    for (const o of offers || []) {
      if (o.to !== BOT) continue;
      const get = worth(o.give), give = worth(o.want);
      const ids = o.want.map(([t]) => t);
      const have = ids.length ? await provider.callFunction({ contractId: cfg.itemsContract, method: 'mt_batch_balance_of', args: { account_id: BOT, token_ids: ids } }) : [];
      const short = o.want.find(([t, n], i) => Number(have[i]) < Number(n));
      const fair = get >= give * 0.9;
      const accept = !short && fair;
      const reason = short ? `I only have ${have[o.want.indexOf(short)]} ${ITEMS[short[0]]?.name || short[0]}.`
        : fair ? `You give about ${get} coins worth, I give about ${give} coins worth. Deal!`
        : `You give about ${get} coins worth, but you ask for about ${give} coins worth. Add a little more?`;
      try {
        await bot.callFunction({ contractId: cfg.itemsContract, methodName: accept ? 'offer_accept' : 'offer_cancel', args: { id: o.id }, gas: teraToGas(60) });
        out.push({ id: o.id, accepted: accept, reason, value: { get, give } });
      } catch (e) { out.push({ id: o.id, accepted: false, reason: `Robo could not finish: ${e.message}` }); }
    }
    if (out.some(x => x.accepted)) restock().catch(() => {});
    return out;
  }

  const routes = {
    'POST /api/room': async body => {
      tidy();
      let code;
      do code = Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join(''); while (rooms.has(code));
      rooms.set(code, { code, host: who(body), guest: null, touched: Date.now() });
      return { code };
    },
    'POST /api/room/join': async body => {
      const r = rooms.get(String(body.code || '').toUpperCase());
      if (!r) throw new Error('No room with that code. Check the letters with your friend.');
      if (r.guest && r.guest.account !== body.account) throw new Error('That room already has two players.');
      r.guest = who(body); r.touched = Date.now();
      return { code: r.code, friend: r.host };
    },
    'POST /api/room/status': async ({ code, account }) => {
      const r = rooms.get(String(code || '').toUpperCase());
      if (!r) return { open: false };
      r.touched = Date.now();
      const friend = r.host.account === account ? r.guest : r.host;
      return { open: true, friend };
    },
    'POST /api/room/leave': async ({ code, account }) => {
      const r = rooms.get(String(code || '').toUpperCase());
      if (r && (r.host.account === account || r.guest?.account === account)) rooms.delete(r.code);
      return { ok: true };
    },
    'GET /api/bot': async () => ({ account: BOT, name: 'Robo', edition: 'fossil', values: Object.fromEntries(Object.keys(STOCK).map(t => [t, valueOf(t)])) }),
  };

  return { routes, ensureBot, botReview, BOT, valueOf };
}
