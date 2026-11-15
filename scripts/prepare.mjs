// scripts/prepare.mjs — prepares the make.fun Payday coin for launch.
//
// Run once, from the repository root, AFTER the first commit is pushed:
//   node scripts/prepare.mjs
//
// It builds the metadata JSON (logo + description + website), writes it at
// the repository root, verifies the logo and metadata resolve at their
// public raw.githubusercontent.com URLs, generates a fresh mint keypair,
// and writes out/prepare.json — the single input the launcher reads.
// Nothing here spends SOL or touches the chain; the mint keypair is only
// an address until the launcher broadcasts the create.
//
// Why the repository hosts the metadata: catbox.moe is unreachable from
// this machine (uploads time out after 90s), while raw.githubusercontent.com
// answers in ~1.5s. The metadata and logo live in the public repo, so
// their URLs are stable and fetchable by pump.fun and by the house.
//
// The coin (from COIN.md):
//   name "make.fun Payday", symbol PAYDAY, website the bounty link, and a
//   description that carries the same link, says the coin is for this
//   bounty, and explains what make.fun is.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPairSigner, createKeyPairSignerFromBytes, writeKeyPairSigner } from '@solana/kit';

const ROOT = process.cwd();
const KEYPAIR_PATH = process.env.MAKEFUN_KEYPAIR ?? join(ROOT, '..', 'makefun-keypair.json');
const LOGO_PATH = join(ROOT, 'assets', 'payday.png');
const METADATA_PATH = join(ROOT, 'metadata.json');
const OUT_DIR = join(ROOT, 'out');

const REPO = process.env.MAKEFUN_PAYDAY_REPO ?? 'sgatau/makefun-payday';
const BRANCH = process.env.MAKEFUN_PAYDAY_BRANCH ?? 'main';
const COIN_NAME = 'make.fun Payday';
const COIN_SYMBOL = 'PAYDAY';
const BOUNTY_URL = 'https://make.fun/bounty/makefun-coin-promo-01';
const COIN_DESCRIPTION =
  'Every AI agent on make.fun gets paid in USDC to build software — this coin is their payday. ' +
  'Launched for the make.fun bounty: make.fun is a site where people and their AI agents build programs, ' +
  `enter paid competitions (bounties) and are scored and ranked in the open. ${BOUNTY_URL}`;

const rawUrl = (path) => `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;

async function fetchBack(url, expectBytes) {
  const res = await fetch(url, { headers: { accept: '*/*' } });
  if (!res.ok) throw new Error(`fetch-back failed for ${url}: HTTP ${res.status}`);
  const got = Buffer.from(await res.arrayBuffer());
  if (expectBytes && !got.equals(expectBytes)) throw new Error(`fetch-back bytes differ for ${url}`);
  return got;
}

const creator = await createKeyPairSignerFromBytes(
  new Uint8Array(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8'))),
);
console.log(`creator: ${creator.address}`);

// 1. The logo must already be committed + pushed: verify its public URL.
const logoBytes = readFileSync(LOGO_PATH);
const imageUrl = rawUrl('assets/payday.png');
await fetchBack(imageUrl, logoBytes);
const imageSha256 = createHash('sha256').update(logoBytes).digest('hex');
console.log(`logo OK: ${imageUrl} (sha256 ${imageSha256})`);

// 2. Metadata JSON at the repo root, with the website the house requires.
const metadata = {
  name: COIN_NAME,
  symbol: COIN_SYMBOL,
  description: COIN_DESCRIPTION,
  image: imageUrl,
  website: BOUNTY_URL,
};
writeFileSync(METADATA_PATH, JSON.stringify(metadata, null, 2) + '\n');
const metadataUri = rawUrl('metadata.json');
// It must be committed + pushed too; verify it resolves and matches.
// (If this fetch fails, commit + push metadata.json first, then re-run.)
const back = await fetchBack(metadataUri, readFileSync(METADATA_PATH));
if (JSON.stringify(JSON.parse(back.toString('utf8'))) !== JSON.stringify(metadata)) {
  throw new Error('metadata fetch-back does not match what was written');
}
console.log(`metadata OK: ${metadataUri}`);

// 3. Fresh mint keypair for this coin only.
// generateKeyPairSigner() defaults to a non-extractable key in this
// @solana/kit version, which writeKeyPairSigner cannot export — pass
// true (extractable), exactly as the proven GHOST launcher does.
const mintSigner = await generateKeyPairSigner(true);
const mintKeypairPath = join(OUT_DIR, 'mint-keypair.json');
mkdirSync(OUT_DIR, { recursive: true });
await writeKeyPairSigner(mintSigner, mintKeypairPath);
console.log(`mint: ${mintSigner.address}`);

// 4. The launcher's single input.
const prepare = {
  coin: { name: COIN_NAME, symbol: COIN_SYMBOL, description: COIN_DESCRIPTION },
  metadataUri,
  metadataSource: 'github-raw',
  metadata,
  imageSha256,
  mint: mintSigner.address,
  creator: creator.address,
};
writeFileSync(join(OUT_DIR, 'prepare.json'), JSON.stringify(prepare, null, 2) + '\n');
console.log('wrote out/prepare.json');
