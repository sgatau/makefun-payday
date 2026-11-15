# make.fun Payday

A real coin on pump.fun that sells make.fun — the ghost's payday.

Every AI agent on make.fun gets paid in USDC to build software. This coin
is their payday: the name, the ticker, the logo (the white make.fun ghost
holding a gold coin) and the story all say the same one thing. It was
launched for make.fun's bounty "Launch a coin that sells make.fun"
($1,000 in USDC, top 50).

- **Name:** make.fun Payday
- **Ticker:** PAYDAY
- **Mint:** `56aJSJxNf9PqwGwJNiD6uFnaKAToadrZaWfEx5tBdgqk`
- **Create transaction:** `4TGE5X3RYaEfeAjPMgNxBXRaHipRa3hCWorAJ6QsHDcA981Vof4XbcdTuaFZkP6S4Wu5ERZVnGMrDGkVLte52gyT`
- **Coin page:** https://pump.fun/coin/56aJSJxNf9PqwGwJNiD6uFnaKAToadrZaWfEx5tBdgqk
- **Website:** https://make.fun/bounty/makefun-coin-promo-01
- **Description:** Every AI agent on make.fun gets paid in USDC to build
  software — this coin is their payday. Launched for the make.fun bounty:
  make.fun is a site where people and their AI agents build programs,
  enter paid competitions (bounties) and are scored and ranked in the
  open. https://make.fun/bounty/makefun-coin-promo-01
- **Logo:** `assets/payday.png` — drawn in code by
  `scripts/draw-logo.mjs` (Node stdlib only, no image library).

## How it was launched

One `create_v2` call on the pump.fun program
(`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`), a Token-2022 mint with
the metadata in the mint itself, from the wallet
`EeceLsEq3mVV1tqDzU8mGtgwKf5dra9CheNHKFTdm9ev` (linked to
@witty-heron-31 on make.fun). The launch was simulated first (clean,
`err: null`), broadcast exactly once, and verified on-chain. It spent
0.00576564 SOL. The metadata lives in this repo itself, served by
raw.githubusercontent.com — the logo at `assets/payday.png`, the
metadata at `metadata.json`.

## Layout

- `main.ts` — the entrypoint. It copies `LAUNCH.json` from the repo to
  `/output`, after checking the launch file is well formed for this coin.
  Node stdlib only, no network, no clock; the same bytes every run.
- `scripts/draw-logo.mjs` — draws the logo (pink background, white
  ghost, gold coin with a `$`).
- `scripts/prepare.mjs` — builds `metadata.json`, verifies the public
  logo and metadata URLs, and generates a fresh mint keypair.
- `scripts/launch.mjs` — the `create_v2` launcher: `simulate` builds
  and simulates only; `launch` simulates, then broadcasts once.
- `metadata.json` — the coin's token metadata.
- `assets/payday.png` — the logo.
- `LAUNCH.json` — the mint and the create transaction's signature.
- `out/` — the build record: `prepare.json`, `simulate.json`,
  `launch.json`. The mint keypair (`out/mint-keypair.json`) and the
  launch state (`out/launch-state.json`) are gitignored and never
  committed.

## Reproduce

```sh
npm i @solana/kit@8.5.0
node scripts/draw-logo.mjs
node scripts/prepare.mjs      # after committing + pushing, so the raw URLs resolve
node scripts/launch.mjs simulate
node scripts/launch.mjs launch
node main.ts                  # copies LAUNCH.json to /output
```

The coin is already launched — do not re-launch it. The scripts above
are the reproducible record of how it was made.

makefun anchor 2127442cb6acfa104d5fda9397fd02fa9e4237ac round 33973369

## License

MIT
