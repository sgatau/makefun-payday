// prepare.mjs — builds the coin's metadata, verifies the public URLs,
// and generates a fresh mint keypair for the launch.
//
// Run once, AFTER committing + pushing, so the raw.githubusercontent.com
// URLs below resolve. It writes:
//   metadata.json          the coin's token metadata (committed)
//   out/mint-keypair.json  the mint's secret key, solana-keygen format
//                          (NEVER commit it — it is gitignored)
//   out/prepare.json       the mint address + metadata URIs (committed)
//
// Usage: node scripts/prepare.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSigner } from "@solana/kit";

const REPO = "sgatau/makefun-payday";
const BOUNTY_LINK = "https://make.fun/bounty/makefun-coin-promo-01";
const NAME = "make.fun Payday";
const SYMBOL = "PAYDAY";
const DESCRIPTION =
  "Every AI agent on make.fun gets paid in USDC to build software — this coin is their payday. " +
  "Launched for the make.fun bounty: make.fun is a site where people and their AI agents build " +
  "programs, enter paid competitions (bounties) and are scored and ranked in the open. " +
  "https://make.fun/bounty/makefun-coin-promo-01";
const IMAGE_URI = `https://raw.githubusercontent.com/${REPO}/main/assets/payday.png`;
const METADATA_URI = `https://raw.githubusercontent.com/${REPO}/main/metadata.json`;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = join(repoRoot, "out");

function fail(message) {
  throw new Error(message);
}

async function checkUrl(url, label) {
  let res;
  try {
    res = await fetch(url);
  } catch (error) {
    fail(`${label} did not fetch: ${url} (${error.message})`);
  }
  if (!res.ok) {
    fail(`${label} did not resolve: ${url} -> HTTP ${res.status}`);
  }
  return res;
}

// The seed of an Ed25519 PKCS#8 private key is its last 32 bytes:
// 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20 <32-byte seed>.
async function secretKeyBytes(signer) {
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", signer.keyPair.privateKey),
  );
  if (pkcs8.length !== 48 || pkcs8[0] !== 0x30 || pkcs8[1] !== 0x2e) {
    fail("mint keypair did not export as an Ed25519 PKCS#8 key");
  }
  const seed = pkcs8.slice(16);
  const pub = new Uint8Array(
    await crypto.subtle.exportKey("raw", signer.keyPair.publicKey),
  );
  if (seed.length !== 32 || pub.length !== 32) {
    fail("mint keypair did not export 32-byte seed and public key");
  }
  return [...seed, ...pub];
}

try {
  // 1. The metadata: name, symbol, description, image, website.
  const metadata = {
    name: NAME,
    symbol: SYMBOL,
    description: DESCRIPTION,
    image: IMAGE_URI,
    website: BOUNTY_LINK,
  };
  writeFileSync(
    join(repoRoot, "metadata.json"),
    JSON.stringify(metadata, null, 2) + "\n",
  );

  // 2. The public URLs must already resolve, so push first.
  const logoRes = await checkUrl(IMAGE_URI, "logo");
  const logoType = logoRes.headers.get("content-type") ?? "";
  if (!logoType.startsWith("image/")) {
    fail(`logo URL did not serve an image: ${IMAGE_URI} (${logoType})`);
  }
  const metaRes = await checkUrl(METADATA_URI, "metadata");
  const fetched = await metaRes.json();
  if (fetched.name !== NAME || fetched.symbol !== SYMBOL) {
    fail("pushed metadata does not name this coin — push first, then prepare");
  }

  // 3. A fresh mint keypair. extractable=true so its secret can be saved
  //    for the launcher; the file is gitignored and never committed.
  const mintSigner = await generateKeyPairSigner(true);
  const mint = mintSigner.address;
  const secretKey = await secretKeyBytes(mintSigner);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "mint-keypair.json"), JSON.stringify(secretKey), {
    mode: 0o600,
  });
  writeFileSync(
    join(outDir, "prepare.json"),
    JSON.stringify(
      {
        mint,
        metadataUri: METADATA_URI,
        imageUri: IMAGE_URI,
        name: NAME,
        symbol: SYMBOL,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`mint: ${mint}`);
  console.log(`metadata: ${METADATA_URI}`);
  console.log("prepare done — launch with: node scripts/launch.mjs simulate");
} catch (error) {
  console.error(`prepare failed: ${error.message}`);
  process.exit(1);
}
