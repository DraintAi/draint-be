// CLI: drain't gasless rescue via 1Shot (EIP-7710) on Arbitrum.
//
//   bun run scripts/oneshot-rescue.ts            # DRY-RUN (estimate only, free)
//   bun run scripts/oneshot-rescue.ts --send     # broadcast (spends ~minFee USDC)
//
// Env required:
//   DRAINT_DEMO_PRIVATE_KEY   private key of the funded demo wallet (at-risk EOA)
//   DRAINT_RECOVERY_ADDRESS   where rescued USDC is swept (defaults to personal wallet)
// Optional:
//   ONESHOT_CHAIN_ID          default 42161 (Arbitrum One)

import { oneShotGaslessRescue, oneShotStatus } from "../src/agent/oneshot7710.js";
import type { Hex, Address } from "viem";

const send = process.argv.includes("--send");
const chainId = Number(process.env.ONESHOT_CHAIN_ID ?? 42161);
const pk = process.env.DRAINT_DEMO_PRIVATE_KEY as Hex | undefined;
const recovery = process.env.DRAINT_RECOVERY_ADDRESS as Address | undefined;

if (!pk) {
  console.error("✗ Set DRAINT_DEMO_PRIVATE_KEY in .env (funded demo wallet).");
  process.exit(1);
}
if (!recovery) {
  console.error("✗ Set DRAINT_RECOVERY_ADDRESS in .env (safe sweep destination).");
  process.exit(1);
}

console.log(`\n🛟 drain't gasless rescue — ${send ? "LIVE SEND" : "DRY-RUN (estimate only)"}`);
console.log(`   chain=${chainId}\n`);

try {
  const r = await oneShotGaslessRescue({
    chainId,
    victimPrivateKey: pk,
    recoveryAddress: recovery,
    send,
  });

  console.log("── bundle accepted by 1Shot estimate ──");
  console.log(`   victim:         ${r.victim}`);
  console.log(`   relayer target: ${r.targetAddress}`);
  console.log(`   feeCollector:   ${r.feeCollector}`);
  console.log(`   token:          ${r.token}`);
  console.log(`   minFee:         ${r.minFee} atoms`);
  console.log(`   requiredFee:    ${r.requiredPaymentAmount} atoms`);
  console.log(`   sweepAmount:    ${r.sweepAmount} atoms`);
  console.log(`   gasUsed:        ${r.gasUsed}`);

  if (r.dryRun) {
    console.log("\n✅ DRY-RUN ok — bundle is valid, NO USDC spent.");
    console.log("   Re-run with --send to broadcast for real.\n");
  } else {
    console.log(`\n📡 Broadcast! taskId=${r.taskId}`);
    console.log("   Polling status…");
    for (let i = 0; i < 30; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const st = (await oneShotStatus(r.taskId!)) as {
        status?: number;
        hash?: string;
        message?: string;
      };
      console.log(`   [${i}] status=${st.status} ${st.hash ?? st.message ?? ""}`);
      if (st.status && st.status >= 200) break;
    }
    console.log("\n✅ Done.\n");
  }
} catch (err) {
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
