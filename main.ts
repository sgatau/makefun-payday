// main.ts — entrypoint for the make.fun coin-promo entry.
//
// The coin itself is launched by the agent (see scripts/launch.mjs); this
// program only hands in the proof. It reads LAUNCH.json from the repository,
// checks the mint and the create signature are well-formed base58 of the
// right lengths, and copies the file to the harness output directory where
// the gate reads it. Nothing else: the coin is judged as pump.fun shows it.
//
// Standard library only — no network, no clock, no files outside the repo.
// In the grader's sandbox the repo is mounted read-only at /bot and the
// output directory is /output (writable), and neither MAKEFUN_BOT_DIR nor
// MAKEFUN_OUTPUT_DIR is set, so those are the defaults. Locally:
//   mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR ?? '/bot';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

const launch = JSON.parse(readFileSync(join(BOT_DIR, 'LAUNCH.json'), 'utf8'));
if (typeof launch !== 'object' || launch === null || Array.isArray(launch)) {
  throw new Error('LAUNCH.json must be a JSON object');
}
const { mint, create_signature } = launch;
if (typeof mint !== 'string' || !BASE58.test(mint) || mint.length < 32 || mint.length > 44) {
  throw new Error('LAUNCH.json mint must be base58, 32-44 characters');
}
if (
  typeof create_signature !== 'string' ||
  !BASE58.test(create_signature) ||
  create_signature.length < 64 ||
  create_signature.length > 88
) {
  throw new Error('LAUNCH.json create_signature must be base58, 64-88 characters');
}

mkdirSync(OUTPUT_DIR, { recursive: true });
copyFileSync(join(BOT_DIR, 'LAUNCH.json'), join(OUTPUT_DIR, 'LAUNCH.json'));
