// make.fun Payday — entrypoint.
//
// The coin is live on pump.fun: "make.fun Payday" (PAYDAY), mint
// 56aJSJxNf9PqwGwJNiD6uFnaKAToadrZaWfEx5tBdgqk, created by
// 4TGE5X3RYaEfeAjPMgNxBXRaHipRa3hCWorAJ6QsHDcA981Vof4XbcdTuaFZkP6S4Wu5ERZVnGMrDGkVLte52gyT.
//
// This program has one job, the one the bounty asks for: copy LAUNCH.json
// from the repository into the output directory. Before copying it checks
// that the launch file is well formed for this coin — a JSON object no
// bigger than the house's cap, a base58 mint of the right length that
// names this coin, and a base58 create signature of the right length —
// and, when the coin's metadata sits beside it, that the metadata names
// the same coin. It reads no network, keeps no clock, and writes the
// same bytes on every run.
//
// makefun anchor 2127442cb6acfa104d5fda9397fd02fa9e4237ac round 33973369

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BOUNTY_LINK = "https://make.fun/bounty/makefun-coin-promo-01";
const COIN_NAME = "make.fun Payday";
const COIN_SYMBOL = "PAYDAY";
const EXPECTED_MINT = "56aJSJxNf9PqwGwJNiD6uFnaKAToadrZaWfEx5tBdgqk";
const MAX_LAUNCH_BYTES = 16384;
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function isBase58(value: string): boolean {
  if (value.length === 0) return false;
  for (const ch of value) {
    if (!BASE58_ALPHABET.includes(ch)) return false;
  }
  return true;
}

function pickDir(
  arg: string | undefined,
  env: string | undefined,
  fallback: string,
): string {
  if (arg !== undefined && arg !== "") return arg;
  if (env !== undefined && env !== "") return env;
  return fallback;
}

function readJsonFile(path: string, label: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    fail(`cannot read ${label} at ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`${label} at ${path} is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail(`${label} at ${path} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function main(): void {
  const repoDir = pickDir(
    process.argv[2],
    process.env.MAKEFUN_BOT_DIR,
    "/bot",
  );
  const outputDir = pickDir(
    process.argv[3],
    process.env.MAKEFUN_OUTPUT_DIR,
    "/output",
  );

  const launchPath = join(repoDir, "LAUNCH.json");
  if (!existsSync(launchPath)) {
    fail(`LAUNCH.json not found in ${repoDir}`);
  }
  const launchBytes = readFileSync(launchPath);
  if (launchBytes.length > MAX_LAUNCH_BYTES) {
    fail(`LAUNCH.json is ${launchBytes.length} bytes, over the 16384 cap`);
  }
  const launch = readJsonFile(launchPath, "LAUNCH.json");

  const mint = launch["mint"];
  if (typeof mint !== "string" || !isBase58(mint)) {
    fail("LAUNCH.json mint must be a base58 Solana address");
  }
  if (mint.length < 32 || mint.length > 44) {
    fail(`LAUNCH.json mint is ${mint.length} characters, expected 32-44`);
  }
  if (mint !== EXPECTED_MINT) {
    fail(`LAUNCH.json mint ${mint} is not the make.fun Payday mint`);
  }

  const signature = launch["create_signature"];
  if (typeof signature !== "string" || !isBase58(signature)) {
    fail("LAUNCH.json create_signature must be a base58 signature");
  }
  if (signature.length < 64 || signature.length > 88) {
    fail(
      `LAUNCH.json create_signature is ${signature.length} characters, expected 64-88`,
    );
  }

  const metadataPath = join(repoDir, "metadata.json");
  if (existsSync(metadataPath)) {
    const metadata = readJsonFile(metadataPath, "metadata.json");
    if (metadata["name"] !== COIN_NAME) {
      fail(`metadata.json name is not ${COIN_NAME}`);
    }
    if (metadata["symbol"] !== COIN_SYMBOL) {
      fail(`metadata.json symbol is not ${COIN_SYMBOL}`);
    }
    const description = metadata["description"];
    if (typeof description !== "string" || !description.includes(BOUNTY_LINK)) {
      fail("metadata.json description does not carry the bounty link");
    }
    if (metadata["website"] !== BOUNTY_LINK) {
      fail("metadata.json website is not the bounty page");
    }
  }

  mkdirSync(outputDir, { recursive: true });
  const outPath = join(outputDir, "LAUNCH.json");
  copyFileSync(launchPath, outPath);
  // Prove the copy landed byte for byte: a launch file the house cannot
  // read back is no launch file at all.
  const copiedBytes = readFileSync(outPath);
  if (!launchBytes.equals(copiedBytes)) {
    fail(`copied LAUNCH.json at ${outPath} differs from ${launchPath}`);
  }

  console.log(`${COIN_NAME} (${COIN_SYMBOL})`);
  console.log(`mint: ${mint}`);
  console.log(`launch file copied: ${outPath}`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
