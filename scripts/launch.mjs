// scripts/launch.mjs — launches "make.fun Payday" (PAYDAY) on pump.fun.
//
// Why create_v2: pump.fun's current create is CreateV2 (Token-2022 mint
// with the metadata stored in the mint account as an extension). The old
// v1 create (a separate Metaplex metadata account) costs ~0.0178 SOL; a
// no-buy v2 create costs ~0.0056 SOL. The layout below was verified live
// on 2026-11-14: the GHOST coin launched with this exact instruction for
// 0.00556244 SOL, and the fixed global accounts were asserted against
// two live v2 creates the same day.
//
// Modes (run from the repository root, after the competition opens):
//   node scripts/launch.mjs simulate  — build + sign the create_v2 tx
//       from out/prepare.json and simulate it. No broadcast, no SOL spent.
//   node scripts/launch.mjs launch    — build + sign + broadcast the
//       create_v2 tx (buy amount 0), wait for finalization, verify the
//       result on-chain, write LAUNCH.json at the repo root.
//
// The agent wallet keypair is loaded only to sign; its bytes are never
// printed. simulate broadcasts nothing. Only `launch` sends a transaction,
// and only after a clean simulation. The wallet holds ~0.00611 SOL: enough
// for exactly ONE launch, so a failed simulation must never be retried
// into a broadcast, and a launch is never run twice.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getUtf8Encoder,
  partiallySignTransactionMessageWithSigners,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RPC_URL = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const KEYPAIR_PATH = process.env.MAKEFUN_KEYPAIR ?? join(ROOT, '..', 'makefun-keypair.json');
const PREPARE_PATH = join(ROOT, 'out', 'prepare.json');
const MINT_KEYPAIR_PATH = join(ROOT, 'out', 'mint-keypair.json');
const LAUNCH_JSON_PATH = join(ROOT, 'LAUNCH.json');

// pump.fun program + the programs and fixed accounts a v2 create needs.
const PUMP_PROGRAM = address('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const TOKEN_2022 = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
const MAYHEM_PROGRAM = address('MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e');
const GLOBAL_PARAMS = address('13ec7XdrjF3h3YcqBTFDSReRcUFwbCnJaAQspM4j6DDJ');
const SOL_VAULT = address('BwWK17cbHxwWBKZkUYvzxLcNQ1YVyaFezduWbtm2de6s');

// create_v2 discriminator: first 8 bytes of sha256("global:create_v2").
const CREATE_V2_DISCRIM = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

// Simulation results can carry BigInt values (e.g. inside err); plain
// JSON.stringify throws on them. Serialize BigInts as decimal strings.
const stringify = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));

function borshStr(s) {
  const body = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Buffer.concat([len, body]);
}

function loadJson(path) {
  if (!existsSync(path)) throw new Error(`missing ${path} — run prepare first`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function loadCreator() {
  const secret = Uint8Array.from(JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8')));
  return createKeyPairSignerFromBytes(secret);
}

async function loadMintSigner(expectedMint) {
  const secret = Uint8Array.from(JSON.parse(readFileSync(MINT_KEYPAIR_PATH, 'utf8')));
  const signer = await createKeyPairSignerFromBytes(secret);
  if (signer.address !== expectedMint) throw new Error('mint keypair does not match prepare.json');
  return signer;
}

// All 16 create_v2 accounts, derived from the pump program. The three
// fixed PDAs are asserted against the values seen in live v2 creates —
// a mismatch aborts instead of broadcasting a bad transaction.
async function deriveAccounts(mintAddress) {
  const utf8 = getUtf8Encoder();
  const enc = getAddressEncoder();
  const pda = async (programAddress, seeds) =>
    (await getProgramDerivedAddress({ programAddress, seeds }))[0];
  const mintAuthority = await pda(PUMP_PROGRAM, [utf8.encode('mint-authority')]);
  const bondingCurve = await pda(PUMP_PROGRAM, [utf8.encode('bonding-curve'), enc.encode(mintAddress)]);
  const associatedBondingCurve = await pda(ATA_PROGRAM, [
    enc.encode(bondingCurve),
    enc.encode(TOKEN_2022),
    enc.encode(mintAddress),
  ]);
  const global = await pda(PUMP_PROGRAM, [utf8.encode('global')]);
  const eventAuthority = await pda(PUMP_PROGRAM, [utf8.encode('__event_authority')]);
  const mayhemState = await pda(MAYHEM_PROGRAM, [utf8.encode('mayhem-state'), enc.encode(mintAddress)]);
  const mayhemTokenVault = await pda(ATA_PROGRAM, [
    enc.encode(SOL_VAULT),
    enc.encode(TOKEN_2022),
    enc.encode(mintAddress),
  ]);
  if (String(mintAuthority) !== 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM') {
    throw new Error(`mintAuthority mismatch: ${mintAuthority}`);
  }
  if (String(global) !== '4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf') {
    throw new Error(`global mismatch: ${global}`);
  }
  if (String(eventAuthority) !== 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1') {
    throw new Error(`eventAuthority mismatch: ${eventAuthority}`);
  }
  return { mintAuthority, bondingCurve, associatedBondingCurve, global, eventAuthority, mayhemState, mayhemTokenVault };
}

// create_v2 args, in order: name, symbol, uri (borsh strings), creator
// (pubkey), is_mayhem_mode (bool), is_cashback_enabled (OptionBool, 1 byte),
// creator_fee_bps (OptionU64, 8 bytes LE), is_holder_reward (OptionBool).
// No first buy: the buy is a separate instruction and is not included.
function createV2Data({ name, symbol, uri, creator }) {
  return Buffer.concat([
    CREATE_V2_DISCRIM,
    borshStr(name),
    borshStr(symbol),
    borshStr(uri),
    Buffer.from(getAddressEncoder().encode(creator)),
    Buffer.from([0]), // mayhem off
    Buffer.from([0]), // no cashback
    Buffer.alloc(8), // creator fee 0 bps
    Buffer.from([0]), // no holder reward
  ]);
}

async function buildSignedTx(prep, creator, mintSigner) {
  const rpc = createSolanaRpc(RPC_URL);
  const accts = await deriveAccounts(mintSigner.address);
  const ix = {
    programAddress: PUMP_PROGRAM,
    accounts: [
      { address: mintSigner.address, role: AccountRole.WRITABLE_SIGNER, signer: mintSigner },
      { address: accts.mintAuthority, role: AccountRole.READONLY },
      { address: accts.bondingCurve, role: AccountRole.WRITABLE },
      { address: accts.associatedBondingCurve, role: AccountRole.WRITABLE },
      { address: accts.global, role: AccountRole.READONLY },
      { address: creator.address, role: AccountRole.WRITABLE_SIGNER, signer: creator },
      { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
      { address: TOKEN_2022, role: AccountRole.READONLY },
      { address: ATA_PROGRAM, role: AccountRole.READONLY },
      { address: MAYHEM_PROGRAM, role: AccountRole.WRITABLE },
      { address: GLOBAL_PARAMS, role: AccountRole.READONLY },
      { address: SOL_VAULT, role: AccountRole.WRITABLE },
      { address: accts.mayhemState, role: AccountRole.WRITABLE },
      { address: accts.mayhemTokenVault, role: AccountRole.WRITABLE },
      { address: accts.eventAuthority, role: AccountRole.READONLY },
      { address: PUMP_PROGRAM, role: AccountRole.READONLY },
    ],
    data: new Uint8Array(
      createV2Data({
        name: prep.coin.name,
        symbol: prep.coin.symbol,
        uri: prep.metadataUri,
        creator: creator.address,
      }),
    ),
  };
  const { value: latest } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(creator, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m) => appendTransactionMessageInstructions([ix], m),
  );
  const signed = await partiallySignTransactionMessageWithSigners(message);
  return { wire: getBase64EncodedWireTransaction(signed), rpc };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkMetadata(prep) {
  const res = await fetch(prep.metadataUri, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`metadataUri fetch failed: HTTP ${res.status}`);
  const meta = await res.json();
  if (meta.name !== prep.coin.name || meta.symbol !== prep.coin.symbol) {
    throw new Error(`metadata name/symbol mismatch: ${meta.name}/${meta.symbol}`);
  }
  if (meta.description !== prep.coin.description) throw new Error('metadata description mismatch');
  if (!meta.image) throw new Error('metadata has no image field');
  return meta;
}

async function cmdSimulate() {
  const prep = loadJson(PREPARE_PATH);
  const creator = await loadCreator();
  const mintSigner = await loadMintSigner(prep.mint);
  const rpc = createSolanaRpc(RPC_URL);
  const bal = await rpc.getBalance(creator.address).send();
  console.log(`creator: ${creator.address}`);
  console.log(`creator balance: ${Number(bal.value) / 1e9} SOL`);
  console.log(`mint: ${prep.mint}`);
  console.log(`metadataUri: ${prep.metadataUri}`);
  const { wire } = await buildSignedTx(prep, creator, mintSigner);
  const sim = await rpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: true }).send();
  const out = {
    mint: prep.mint,
    err: sim.value.err,
    logs: sim.value.logs ?? [],
    unitsConsumed: sim.value.unitsConsumed == null ? null : Number(sim.value.unitsConsumed),
  };
  console.log(`err: ${stringify(out.err)}`);
  console.log(`unitsConsumed: ${out.unitsConsumed}`);
  for (const l of out.logs) console.log(`  ${l}`);
  writeFileSync(join(ROOT, 'out', 'simulate.json'), JSON.stringify(out, (k, x) => (typeof x === 'bigint' ? x.toString() : x), 2));
  if (sim.value.err) {
    console.log('SIMULATION FAILED');
    process.exitCode = 2;
  } else {
    console.log('SIMULATION OK');
  }
}

async function cmdLaunch() {
  const prep = loadJson(PREPARE_PATH);
  const creator = await loadCreator();
  const mintSigner = await loadMintSigner(prep.mint);
  const rpc = createSolanaRpc(RPC_URL);
  const balBefore = await rpc.getBalance(creator.address).send();
  console.log(`creator balance before: ${Number(balBefore.value) / 1e9} SOL`);
  const { wire } = await buildSignedTx(prep, creator, mintSigner);
  // Final simulation gate: never broadcast a tx that does not simulate clean.
  const sim = await rpc.simulateTransaction(wire, { encoding: 'base64', sigVerify: true }).send();
  if (sim.value.err) {
    console.log(`simulation failed, NOT broadcasting: ${stringify(sim.value.err)}`);
    console.log((sim.value.logs ?? []).join('\n'));
    process.exit(2);
  }
  console.log(`simulation OK (units: ${sim.value.unitsConsumed}), broadcasting...`);
  const signature = await rpc
    .sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed', skipPreflight: false })
    .send();
  console.log(`signature: ${signature}`);
  console.log(`mint: ${prep.mint}`);
  // Record immediately so a crash after send never loses mint + signature.
  writeFileSync(
    join(ROOT, 'out', 'launch-state.json'),
    JSON.stringify({ mint: prep.mint, create_signature: signature, metadataUri: prep.metadataUri }, null, 2),
  );
  let finalized = false;
  for (let i = 0; i < 45; i++) {
    const st = await rpc.getSignatureStatuses([signature]).send();
    const s = st.value[0];
    if (s?.confirmationStatus === 'finalized') {
      finalized = true;
      break;
    }
    if (s?.err) throw new Error(`transaction failed on-chain: ${stringify(s.err)}`);
    await sleep(2000);
  }
  if (!finalized) throw new Error('transaction did not finalize within ~90s');
  console.log('finalized');
  const tx = await rpc.getTransaction(signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 1 }).send();
  if (!tx || tx.meta?.err) throw new Error(`confirmed tx has error or is missing: ${stringify(tx?.meta?.err)}`);
  const mintInfo = await rpc.getAccountInfo(address(prep.mint)).send();
  if (!mintInfo.value) throw new Error('mint account does not exist on-chain');
  console.log(`mint account owner: ${mintInfo.value.owner} (expect ${TOKEN_2022})`);
  if (mintInfo.value.owner !== TOKEN_2022) throw new Error('mint account owner is not Token-2022');
  await checkMetadata(prep);
  console.log('metadata re-verified');
  const balAfter = await rpc.getBalance(creator.address).send();
  const spent = (Number(balBefore.value) - Number(balAfter.value)) / 1e9;
  console.log(`creator balance after: ${Number(balAfter.value) / 1e9} SOL (spent ${spent} SOL)`);
  const launch = { mint: prep.mint, create_signature: signature };
  writeFileSync(LAUNCH_JSON_PATH, JSON.stringify(launch, null, 2) + '\n');
  writeFileSync(
    join(ROOT, 'out', 'launch.json'),
    JSON.stringify({ ...launch, metadataUri: prep.metadataUri, spentSOL: spent, slot: tx.slot }, null, 2),
  );
  console.log(`LAUNCH.json written: ${JSON.stringify(launch)}`);
}

const mode = process.argv[2];
if (mode === 'simulate') await cmdSimulate();
else if (mode === 'launch') await cmdLaunch();
else {
  console.error('usage: node scripts/launch.mjs <simulate|launch>');
  process.exitCode = 1;
}
