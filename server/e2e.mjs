// End-to-end check against a running server (node server/index.mjs) on testnet:
// a new player buys with a signed quote, sells, eats, and earns a reward — all gasless.
//   node server/e2e.mjs
import { Account, JsonRpcProvider, KeyPair, actions, teraToGas, encodeSignedDelegate } from 'near-api-js';

const API = process.env.API || 'http://localhost:8787';
const post = (p, body) => fetch(API + p, { method: 'POST', body: JSON.stringify(body) }).then(r => r.json());
const cfg = await fetch(API + '/api/config').then(r => r.json());
const provider = new JsonRpcProvider({ url: 'https://test.rpc.fastnear.com' });
const bal = async (who, ids) => (await provider.callFunction({ contractId: cfg.items, method: 'mt_batch_balance_of', args: { account_id: who, token_ids: ids } }));
const show = async (who, label) => { const ids = ['scales', 'grilled', 'fish', 'rice']; const b = await bal(who, ids); console.log(label.padEnd(18), ids.map((k, i) => `${k}=${b[i]}`).join('  ')); return Object.fromEntries(ids.map((k, i) => [k, Number(b[i])])); };

const kp = KeyPair.fromRandom('ed25519');
const created = await post('/api/account', { name: 'e2e', publicKey: kp.getPublicKey().toString() });
if (!created.accountId) throw new Error(JSON.stringify(created));
const me = created.accountId;
console.log('player', me);
const player = new Account(me, provider, kp.toString());
const relay = async (methodName, args, deposit = 0n) => {
  const { signedDelegate } = await player.createSignedMetaTransaction({ receiverId: cfg.items, actions: [actions.functionCall(methodName, args, teraToGas(50), deposit)] });
  return post('/api/relay', { signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') });
};

const b0 = await show(me, 'starter kit');
// buy a Grilled Fish from Kama
const q = await post('/api/quote', { player: me, merchant: 'kama', item: 'grilled', side: 'buy' });
console.log('quote', q.price, 'scales');
const r1 = await relay('trade', { quote: q.quote, signature: q.signature });
console.log('trade', r1.ok, r1.txHash || r1.error);
const b1 = await show(me, 'after buying');
if (b1.grilled !== b0.grilled + 1 || b1.scales !== b0.scales - q.price) throw new Error('buy did not settle');
// a tampered quote must fail
const fake = { ...q.quote, give_amount: '1', nonce: q.quote.nonce + 1 };
const r2 = await relay('trade', { quote: fake, signature: q.signature });
console.log('tampered quote rejected:', r2.ok === false, (r2.error || '').slice(0, 80));
// walk reward + sell the fish
const w = await post('/api/reward', { player: me, kind: 'walk', item: 'fish', amount: 2 });
console.log('walk reward', JSON.stringify(w.minted));
const qs = await post('/api/quote', { player: me, merchant: 'kama', item: 'fish', side: 'sell' });
const r3 = await relay('trade', { quote: qs.quote, signature: qs.signature });
console.log('sold fish for', qs.price, r3.ok);
// eat
const r4 = await relay('consume', { token_id: 'grilled', amount: '1' });
console.log('ate grilled', r4.ok);
await show(me, 'final');
console.log('explorer', `${cfg.explorer}/address/${me}`);
