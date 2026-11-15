// launch.mjs — creates the make.fun Payday coin on pump.fun.
//
// pump.fun create_v2 on 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P: a
// Token-2022 mint whose metadata lives in the mint itself. Two modes:
//
//   node scripts/launch.mjs simulate [keypair]   build + simulate only
//   node scripts/launch.mjs launch [keypair]     simulate, then broadcast ONCE
//
// [keypair] is the fee-payer / creator keypair — the wallet linked to the
// make.fun account. It defaults to the make.fun keypair. The mint keypair
// comes from out/mint-keypair.json, written by prepare.mjs.
//
// Exactly one launch: the moment a broadcast returns a signature it is
// saved to out/launch-state.json, and a later run refuses to broadcast
// again while that file holds a signature. If a broadcast succeeds but
// verification fails, recover the mint and signature from that file —
// never re-launch.
//
// Usage: node scripts/launch.mjs <simulate|launch> [keypair-path]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  signTransactionMessageWithSigners,
} from "@solana/kit";

const RPC_URL = "https://api.mainnet-beta.solana.com";
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const CREATE_V2_DISCRIMINATOR = [214, 144, 76, 236, 95, 139, 49, 180];
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN_PROGRAM =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MPL_TOKEN_METADATA = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const RENT_SYSVAR = "SysvarRent111111111111111111111111111111111";
// A create_v2 launch needs about 0.00642 SOL of rent + fees; refuse to
// start below 0.0065 SOL so a short wallet fails loudly instead of
// burning a simulation on InsufficientFundsForRent.
const MIN_BALANCE_LAMPORTS = 6_500_000n;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const outDir = join(repoRoot, "out");

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function fail(message) {
  throw new Error(message);
}

function loadJson(path, label) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${label} at ${path}: ${error.message}`);
  }
  return parsed;
}

async function loadSigner(path, label) {
  const secret = loadJson(path, label);
  if (!Array.isArray(secret) || secret.length !== 64) {
    fail(`${label} at ${path} is not a 64-number secret-key file`);
  }
  return createKeyPairSignerFromBytes(new Uint8Array(secret));
}

async function pda(programAddress, seeds) {
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds });
  return derived;
}

// create_v2 instruction data: 8-byte discriminator, then name, symbol and
// uri each as a u32 little-endian length + UTF-8 bytes, then the 32-byte
// creator address.
function encodeCreateV2Data(name, symbol, uri, creatorAddress) {
  const nameBytes = Buffer.from(name, "utf8");
  const symbolBytes = Buffer.from(symbol, "utf8");
  const uriBytes = Buffer.from(uri, "utf8");
  const creatorBytes = Buffer.from(
    getAddressEncoder().encode(creatorAddress),
  );
  const out = Buffer.alloc(
    8 +
      4 +
      nameBytes.length +
      4 +
      symbolBytes.length +
      4 +
      uriBytes.length +
      32,
  );
  let o = 0;
  out.set(CREATE_V2_DISCRIMINATOR, o);
  o += 8;
  out.writeUInt32LE(nameBytes.length, o);
  o += 4;
  out.set(nameBytes, o);
  o += nameBytes.length;
  out.writeUInt32LE(symbolBytes.length, o);
  o += 4;
  out.set(symbolBytes, o);
  o += symbolBytes.length;
  out.writeUInt32LE(uriBytes.length, o);
  o += 4;
  out.set(uriBytes, o);
  o += uriBytes.length;
  out.set(creatorBytes, o);
  return new Uint8Array(out);
}

async function buildCreateInstruction({ mintSigner, feePayerSigner, name, symbol, uri }) {
  const utf8 = new TextEncoder();
  const encoder = getAddressEncoder();
  const pump = address(PUMP_PROGRAM);
  const mint = mintSigner.address;
  const creator = feePayerSigner.address;

  const bondingCurve = await pda(pump, [
    utf8.encode("bonding-curve"),
    encoder.encode(mint),
  ]);
  const mintAuthority = await pda(pump, [
    utf8.encode("mint-authority"),
    encoder.encode(bondingCurve),
  ]);
  const global = await pda(pump, [utf8.encode("global")]);
  const metadata = await pda(address(MPL_TOKEN_METADATA), [
    utf8.encode("metadata"),
    encoder.encode(address(MPL_TOKEN_METADATA)),
    encoder.encode(mint),
  ]);
  const eventAuthority = await pda(pump, [utf8.encode("__event_authority")]);
  const creatorVault = await pda(pump, [
    utf8.encode("creator-vault"),
    encoder.encode(creator),
  ]);
  const globalVolumeAccumulator = await pda(pump, [
    utf8.encode("global_volume_accumulator"),
  ]);
  const userVolumeAccumulator = await pda(pump, [
    utf8.encode("user_volume_accumulator"),
    encoder.encode(creator),
  ]);
  const associatedBondingCurve = await pda(address(ASSOCIATED_TOKEN_PROGRAM), [
    encoder.encode(bondingCurve),
    encoder.encode(address(TOKEN_2022_PROGRAM)),
    encoder.encode(mint),
  ]);

  // create_v2's accounts: the mint and its authorities, the bonding curve
  // and its associated account, the global state, the metadata account,
  // the creator as fee payer, the system programs, and create_v2's extras
  // — the creator vault and the two volume accumulators.
  return {
    programAddress: pump,
    accounts: [
      { address: mintSigner, role: AccountRole.WRITABLE_SIGNER },
      { address: mintAuthority, role: AccountRole.WRITABLE },
      { address: bondingCurve, role: AccountRole.WRITABLE },
      { address: associatedBondingCurve, role: AccountRole.WRITABLE },
      { address: global, role: AccountRole.WRITABLE },
      { address: address(MPL_TOKEN_METADATA), role: AccountRole.READONLY },
      { address: metadata, role: AccountRole.WRITABLE },
      { address: feePayerSigner, role: AccountRole.WRITABLE_SIGNER },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(TOKEN_2022_PROGRAM), role: AccountRole.READONLY },
      {
        address: address(ASSOCIATED_TOKEN_PROGRAM),
        role: AccountRole.READONLY,
      },
      { address: address(RENT_SYSVAR), role: AccountRole.READONLY },
      { address: eventAuthority, role: AccountRole.READONLY },
      { address: pump, role: AccountRole.READONLY },
      { address: creatorVault, role: AccountRole.WRITABLE },
      { address: globalVolumeAccumulator, role: AccountRole.WRITABLE },
      { address: userVolumeAccumulator, role: AccountRole.WRITABLE },
    ],
    data: encodeCreateV2Data(name, symbol, uri, creator),
  };
}

async function buildTransaction(rpc, instruction, feePayerSigner) {
  const { value: latest } = await rpc.getLatestBlockhash().send();
  let tx = createTransactionMessage({ version: 0 });
  tx = setTransactionMessageFeePayerSigner(feePayerSigner, tx);
  tx = setTransactionMessageLifetimeUsingBlockhash(
    {
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    tx,
  );
  tx = appendTransactionMessageInstruction(instruction, tx);
  return tx;
}

async function simulate(rpc, tx) {
  const signed = await signTransactionMessageWithSigners(tx);
  const wire = getBase64EncodedWireTransaction(signed);
  const { value } = await rpc
    .simulateTransaction(wire, {
      commitment: "confirmed",
      encoding: "base64",
      sigVerify: false,
    })
    .send();
  return value;
}

async function waitFinalized(rpc, signature) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { value } = await rpc
      .getSignatureStatuses([signature], { searchTransactionHistory: true })
      .send();
    const status = value[0];
    if (status !== null) {
      if (status.err !== null) {
        fail(`create transaction failed on-chain: ${JSON.stringify(status.err)}`);
      }
      if (status.confirmationStatus === "finalized") return;
    }
    await sleep(2000);
  }
  fail(`create transaction ${signature} did not finalize in 60s`);
}

async function verifyMint(rpc, mint) {
  const { value } = await rpc
    .getAccountInfo(address(mint), { encoding: "base64" })
    .send();
  if (value === null) fail(`mint ${mint} has no account on-chain`);
  if (value.owner !== TOKEN_2022_PROGRAM) {
    fail(`mint ${mint} is not owned by the Token-2022 program`);
  }
}

try {
  const mode = process.argv[2];
  if (mode !== "simulate" && mode !== "launch") {
    console.error("usage: node scripts/launch.mjs <simulate|launch> [keypair-path]");
    process.exit(1);
  }
  const keypairPath =
    process.argv[3] ??
    process.env.MAKEFUN_KEYPAIR ??
    join(process.env.HOME, "workspace", "makefun", "makefun-keypair.json");

  if (mode === "launch") {
    const statePath = join(outDir, "launch-state.json");
    if (existsSync(statePath)) {
      const state = loadJson(statePath, "launch state");
      if (typeof state.create_signature === "string") {
        fail(
          `a launch already broadcast (signature ${state.create_signature}) — ` +
            `recover it from ${statePath}, never re-launch`,
        );
      }
    }
  }

  const prepare = loadJson(join(outDir, "prepare.json"), "prepare record");
  const metadata = loadJson(join(repoRoot, "metadata.json"), "metadata");
  if (metadata.name !== prepare.name || metadata.symbol !== prepare.symbol) {
    fail("metadata.json does not match out/prepare.json — re-run prepare.mjs");
  }
  const mintSigner = await loadSigner(
    join(outDir, "mint-keypair.json"),
    "mint keypair",
  );
  if (mintSigner.address !== prepare.mint) {
    fail("out/mint-keypair.json does not match out/prepare.json — re-run prepare.mjs");
  }
  const feePayerSigner = await loadSigner(keypairPath, "fee-payer keypair");

  const rpc = createSolanaRpc(RPC_URL);
  const { value: balance } = await rpc
    .getBalance(feePayerSigner.address)
    .send();
  console.log(
    `fee payer ${feePayerSigner.address}: ${Number(balance) / 1e9} SOL`,
  );
  if (balance < MIN_BALANCE_LAMPORTS) {
    fail(
      `fee payer holds ${Number(balance) / 1e9} SOL, below the 0.0065 SOL a launch needs`,
    );
  }

  const instruction = await buildCreateInstruction({
    mintSigner,
    feePayerSigner,
    name: prepare.name,
    symbol: prepare.symbol,
    uri: prepare.metadataUri,
  });

  // Simulate first, on a fresh blockhash. A non-null err stops everything.
  const simTx = await buildTransaction(rpc, instruction, feePayerSigner);
  const sim = await simulate(rpc, simTx);
  console.log(`SIMULATION ${sim.err === null ? "OK" : "FAILED"} (err: ${JSON.stringify(sim.err)})`);
  if (sim.err !== null) {
    fail(`simulation failed: ${JSON.stringify(sim.err)}`);
  }
  console.log(`compute units: ${sim.unitsConsumed}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "simulate.json"),
    JSON.stringify(
      { mint: prepare.mint, err: sim.err, unitsConsumed: sim.unitsConsumed },
      null,
      2,
    ) + "\n",
  );
  if (mode === "simulate") {
    console.log("simulation passed — nothing broadcast");
    process.exit(0);
  }

  // Launch: re-build on a fresh blockhash, broadcast once, then verify.
  const launchTx = await buildTransaction(rpc, instruction, feePayerSigner);
  const signature = await signAndSendTransactionMessageWithSigners(launchTx);
  console.log(`broadcast: ${signature}`);
  writeFileSync(
    join(outDir, "launch-state.json"),
    JSON.stringify(
      { mint: prepare.mint, create_signature: signature, status: "broadcast" },
      null,
      2,
    ) + "\n",
  );
  await waitFinalized(rpc, signature);
  await verifyMint(rpc, prepare.mint);
  const metaRes = await fetch(prepare.metadataUri);
  if (!metaRes.ok) {
    fail(`metadata URL did not resolve after launch: ${prepare.metadataUri}`);
  }

  const launchRecord = {
    mint: prepare.mint,
    create_signature: signature,
    name: prepare.name,
    symbol: prepare.symbol,
    metadataUri: prepare.metadataUri,
  };
  writeFileSync(
    join(repoRoot, "LAUNCH.json"),
    JSON.stringify(
      { mint: prepare.mint, create_signature: signature },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(
    join(outDir, "launch.json"),
    JSON.stringify(launchRecord, null, 2) + "\n",
  );
  writeFileSync(
    join(outDir, "launch-state.json"),
    JSON.stringify({ ...launchRecord, status: "finalized" }, null, 2) + "\n",
  );
  console.log(`LAUNCHED mint ${prepare.mint}`);
  console.log(`https://pump.fun/coin/${prepare.mint}`);
} catch (error) {
  console.error(`launch failed: ${error.message}`);
  process.exit(1);
}
