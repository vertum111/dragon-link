# Dragon Link — ドラゴンリンク

A 1998-style Japanese pocket dragon, rebuilt as a 3D toy in the browser, with a real player economy on NEAR.
Built for the NEAR Hackathon, track **Games With Real Economies**.

![Dragon Link](outputs/dragon-link/assets/cover.jpg)

## What it is

- **Raise a dragon.** Pick one of four eggs, hatch it, feed it, play with it, take it on walks. When it needs you, a big `!` blinks.
- **A real market.** Walks find Embers. Two merchant agents, Kama (grill) and Gen (curio shop), compete to buy them. Prices come from each merchant's own stock, cash and rent, so they move every market hour. Kama turns Embers into Fish, Gen into Pearls, and a Pearl grows your dragon into an adult.
- **Merchants can go broke.** A merchant that can't pay rent closes. Players can invest to reopen it and earn a share of its sales.
- **LINK.** Two units dock and share one screen: fight the Shadow Wyrm together in a co-op rhythm battle, trade through on-chain escrow, or send a gift that is a real token transfer. Link with a friend by a four-letter room code, or with Robo, the club bot that has its own NEAR wallet.
- **For judges:** Settings → *Fast-forward a week* replays seven market days with 50 bot players in about 15 seconds.

## On NEAR

- `items.dragonlink.testnet` — a NEP-245 multi-token contract (Rust, `contracts/items`): coins, fish, embers and pearls.
- **Sign in with Google or email (Privy).** No seed phrase, no wallet pop-up, no gas prompt. Privy gives each player an embedded NEAR wallet; its key becomes the access key of the player's game account (`name-xxxx.dragonlink.testnet`), so the same Google or email opens the same dragon on any device. Guests get a key kept in their browser. Same pattern as [near-examples/hello-privy](https://github.com/near-examples/hello-privy).
- **Gas is on the game.** Players sign NEP-366 meta-transactions; the game server relays them to the items contract and pays the gas.
- Every trade with a merchant needs an ed25519-signed quote that the contract verifies before it settles, so the server can't move a player's tokens.
- Offers between players are held in escrow by the contract (`offer_create` / `offer_accept` / `offer_cancel`). Robo, the club bot, has its own wallet and answers offers by today's street prices.

## Play

**https://dragonlink.lol** — the full game on NEAR testnet: sign in with Google or email (or play as a guest), and every coin, fish, ember and pearl is on-chain.

The site is static plus one Netlify function, `netlify/functions/api.mjs` (`/api/*`): accounts, merchant quotes, rewards, the meta-transaction relay, Robo and LINK rooms. Market state lives in Netlify Blobs. It needs three secret environment variables: `ROOT_PRIVATE_KEY` (dragonlink.testnet), `MERCHANT_KEYS` (JSON of the merchants' quote-signing keys) and `BOT_PRIVATE_KEY`.

Run it yourself:

```bash
npm install
npm run build                  # esbuild → outputs/dragon-link/dragon-link-manual.html + privy.bundle.js
cd server && npm install
node setup.mjs                 # one time: testnet accounts + contract (needs a funded testnet key)
node index.mjs                 # the same server as a local process, on http://localhost:8787
```

Without any server (`python3 -m http.server` in `outputs/dragon-link`) the market runs in the browser and everything except on-chain settlement works.

Controls: ◀ ● ▶ on the console, or `A S D` / arrow keys + Enter. The friend's unit uses `J K L` while linked.

## Layout

| Path | What |
|---|---|
| `outputs/dragon-link/dragon-link-manual.html` | The built game (single page, everything bundled) |
| `work/dragon-duo.js` | 3D console, LCD game, battle, audio |
| `work/dragon-ui-manual.js`, `work/dragon-duo-alt.html` | Page UI: sign-in, market panel, LINK menu, trade, tour, settings |
| `work/economy/` | Market engine: merchants, pricing, events, investors, week simulation |
| `work/chain/bridge.js` | Mirrors the local market to the NEAR contract |
| `netlify/functions/api.mjs` | The game server on Netlify: accounts, quotes, rewards, relay, Robo, rooms |
| `work/privy.js` | Google / email sign-in with an embedded NEAR wallet (Privy) |
| `server/` | The same game server as a local Node process |
| `contracts/items/` | NEP-245 items contract with signed trades and escrow offers |
| `work/qa/playthrough.js` | In-browser end-to-end playthrough |

Build: `bash work/build-dragon-alt.sh` (esbuild bundle → `outputs/dragon-link/dragon-link-manual.html`).
