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
- Every trade with a merchant needs an ed25519-signed quote that the contract verifies before it settles.
- Players never see a wallet: signing in creates a NEAR account behind the scenes, and every move is relayed as a NEP-366 meta-transaction by the game server (`server/`).
- Offers between players are held in escrow by the contract (`offer_create` / `offer_accept` / `offer_cancel`).

## Play

- **Hosted demo (static):** the Netlify link in the repo description. Without the game server the market runs locally in your browser, so everything except on-chain settlement works.
- **Full on-chain mode, locally:**

```bash
cd server && npm install
node setup.mjs     # one time: creates the testnet accounts and deploys the contract (needs a funded testnet key)
node index.mjs     # serves the game on http://localhost:8787 with the NEAR relay
```

Controls: ◀ ● ▶ on the console, or `A S D` / arrow keys + Enter. The friend's unit uses `J K L` while linked.

## Layout

| Path | What |
|---|---|
| `outputs/dragon-link/dragon-link-manual.html` | The built game (single page, everything bundled) |
| `work/dragon-duo.js` | 3D console, LCD game, battle, audio |
| `work/dragon-ui-manual.js`, `work/dragon-duo-alt.html` | Page UI: sign-in, market panel, LINK menu, trade, tour, settings |
| `work/economy/` | Market engine: merchants, pricing, events, investors, week simulation |
| `work/chain/bridge.js` | Mirrors the local market to the NEAR contract |
| `server/` | Game server: market authority, quote signing, meta-transaction relay, rooms, Robo |
| `contracts/items/` | NEP-245 items contract with signed trades and escrow offers |
| `work/qa/playthrough.js` | In-browser end-to-end playthrough |

Build: `bash work/build-dragon-alt.sh` (esbuild bundle → `outputs/dragon-link/dragon-link-manual.html`).
