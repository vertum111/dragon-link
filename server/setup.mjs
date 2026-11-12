// One-time testnet setup for Dragon Link.
//   1. create the root account (once, by hand):
//        near account create-account sponsor-by-faucet-service <root>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
//   2. node server/setup.mjs <root>.testnet
// Creates items.<root> with the contract, the three merchant accounts and their quote-signing keys,
// registers the merchants in the contract and writes server/config.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Account, JsonRpcProvider, KeyPair, teraToGas, nearToYocto } from 'near-api-js';

const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node server/setup.mjs <root>.testnet'); process.exit(1); }
const HERE = import.meta.dirname;
const NETWORK = 'testnet', RPC = 'https://test.rpc.fastnear.com';
const KEYDIR = path.join(os.homedir(), '.near-credentials', NETWORK);
const WASM = path.resolve(HERE, '../contracts/items/target/near/dragonlink_items.wasm');
const STATE = path.join(HERE, 'state');
fs.mkdirSync(STATE, { recursive: true });

const provider = new JsonRpcProvider({ url: RPC });
const keyOf = id => JSON.parse(fs.readFileSync(path.join(KEYDIR, `${id}.json`), 'utf8')).private_key;
const saveKey = (id, kp) => fs.writeFileSync(path.join(KEYDIR, `${id}.json`),
  JSON.stringify({ account_id: id, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
const exists = async id => { try { await provider.viewAccount({ accountId: id }); return true; } catch { return false; } };

const root = new Account(ROOT, provider, keyOf(ROOT));
const ITEMS = `items.${ROOT}`;
const MERCHANTS = { kama: `kama.${ROOT}`, tsuki: `tsuki.${ROOT}`, gen: `gen.${ROOT}` };

// 1. the contract account
if (!await exists(ITEMS)) {
  const kp = KeyPair.fromRandom('ed25519'); saveKey(ITEMS, kp);
  await root.createSubAccount({ accountOrPrefix: 'items', publicKey: kp.getPublicKey(), nearToTransfer: nearToYocto('3') });
  console.log('created', ITEMS);
}
const items = new Account(ITEMS, provider, keyOf(ITEMS));
const code = await provider.viewContractCode?.({ accountId: ITEMS }).catch(() => null);
if (!code || !code.code_base64) {
  await items.deployContract(fs.readFileSync(WASM));
  await items.callFunction({ contractId: ITEMS, methodName: 'new', args: { owner_id: ROOT, operator_id: ROOT }, gas: teraToGas(30) });
  console.log('deployed and initialized the items contract on', ITEMS);
}

// 2. merchants: each NPC has its own account (its wallet) and a key that signs its price quotes
const keysFile = path.join(STATE, 'merchant-keys.json');
const keys = fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, 'utf8')) : {};
for (const [id, acc] of Object.entries(MERCHANTS)) {
  if (!keys[id]) { const kp = KeyPair.fromRandom('ed25519'); keys[id] = { accountId: acc, publicKey: kp.getPublicKey().toString(), secretKey: kp.toString() }; }
  fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
  if (!await exists(acc)) {
    await root.createSubAccount({ accountOrPrefix: id, publicKey: keys[id].publicKey, nearToTransfer: nearToYocto('0.05') });
    console.log('created merchant', acc);
  }
  const raw = KeyPair.fromString(keys[id].secretKey).getPublicKey().data;
  await root.callFunction({ contractId: ITEMS, methodName: 'register_merchant', args: { merchant_id: acc, public_key: Buffer.from(raw).toString('base64') }, gas: teraToGas(30) });
  console.log('registered', acc);
}

// 3. server config
fs.writeFileSync(path.join(HERE, 'config.json'), JSON.stringify({
  network: NETWORK, rpc: RPC, rootAccount: ROOT, itemsContract: ITEMS, merchants: MERCHANTS,
  explorer: 'https://testnet.nearblocks.io', port: 8787, staticDir: '../outputs/dragon-link',
}, null, 2));
console.log('wrote server/config.json — start the game with: node server/index.mjs');
