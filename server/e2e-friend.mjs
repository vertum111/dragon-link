// A second player for testing online LINK: opens a room, waits for someone to join with the code,
// then offers them 2 Grilled Fish for 1 River Fish and waits for the answer.
//   node server/e2e-friend.mjs      (prints the room code; join it from the game's Link menu)
import fs from 'node:fs';
import { Account, JsonRpcProvider, KeyPair, actions, teraToGas, encodeSignedDelegate } from 'near-api-js';

const API = process.env.API || 'http://localhost:8787';
const post = (p, b) => fetch(API + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
const cfg = await fetch(API + '/api/config').then(r => r.json());
const P = new JsonRpcProvider({ url: cfg.rpc });
const kp = KeyPair.fromRandom('ed25519');
const { accountId } = await post('/api/account', { name: 'mika', publicKey: kp.getPublicKey().toString() });
const mika = new Account(accountId, P, kp.toString());
const send = async (m, a) => {
  const { signedDelegate } = await mika.createSignedMetaTransaction({ receiverId: cfg.items, actions: [actions.functionCall(m, a, teraToGas(80), 0n)] });
  return post('/api/relay', { signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64') });
};
const bal = async who => { const ids = ['grilled', 'fish']; const b = await P.callFunction({ contractId: cfg.items, method: 'mt_batch_balance_of', args: { account_id: who, token_ids: ids } }); return ids.map((k, i) => `${k}=${b[i]}`).join(' '); };

const { code } = await post('/api/room', { account: accountId, name: 'Mika', edition: 'nocturne' });
console.log('MIKA', accountId, 'ROOM', code);
if (process.env.CODE_FILE) fs.writeFileSync(process.env.CODE_FILE, code);
let friend = null;
for (let i = 0; i < 90 && !friend; i++) { await new Promise(r => setTimeout(r, 1000)); friend = (await post('/api/room/status', { code, account: accountId })).friend; }
if (!friend) { console.log('nobody joined'); process.exit(1); }
console.log('joined by', friend.name, friend.account);
const r = await send('offer_create', { to: friend.account, give: [['grilled', '2']], want: [['fish', '1']] });
console.log('offer sent', r.ok, r.error || '');
for (let i = 0; i < 90; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const open = await P.callFunction({ contractId: cfg.items, method: 'offers_for', args: { account_id: accountId } });
  if (!open.length) break;
}
console.log('answered. mika:', await bal(accountId), '| friend:', await bal(friend.account));
