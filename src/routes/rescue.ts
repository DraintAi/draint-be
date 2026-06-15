// drain't reference agent — rescue HTTP surface.
//
// Endpoints:
//   POST   /api/agent/rescue/pre-sign      accept a pre-signed revoke auth
//   GET    /api/agent/rescue/status/:c/:a  check if drain't holds a revoke
//   GET    /api/agent/rescue/list          list all stored revokes (debug)
//   POST   /api/agent/rescue/execute       manual rescue trigger (demo)

import { Hono } from "hono";
import { z } from "zod";
import {
  agentAccount,
  agentReady,
  executeRescue,
  getPreSignedRevoke,
  listStoredRevokes,
  oneShotReady,
  storePreSignedRevoke,
  type RescueMode,
  type StoredRevoke,
} from "../agent/rescue.js";
import { oneShotGaslessRescue, oneShotStatus } from "../agent/oneshot7710.js";
import type { Hex, Address } from "viem";

export const rescue = new Hono();

const ADDRESS = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const HEX = z.string().regex(/^0x[a-fA-F0-9]+$/);

const PreSignBody = z.object({
  victim: ADDRESS,
  chainId: z.number().int().positive(),
  authorization: z.object({
    chainId: z.number().int().positive(),
    contractAddress: ADDRESS,
    nonce: z.union([z.string(), z.number()]).transform(String),
    yParity: z.number().int().min(0).max(1),
    r: HEX,
    s: HEX,
  }),
});

rescue.get("/", (c) =>
  c.json({
    agentReady,
    agentAddress: agentAccount?.address ?? null,
    oneShotReady,
    storedRevokes: listStoredRevokes().length,
  }),
);

rescue.post("/pre-sign", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = PreSignBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      400,
    );
  }

  const stored: StoredRevoke = {
    victim: parsed.data.victim.toLowerCase() as `0x${string}`,
    chainId: parsed.data.chainId,
    authorization: {
      chainId: parsed.data.authorization.chainId,
      contractAddress: parsed.data.authorization.contractAddress as `0x${string}`,
      nonce: parsed.data.authorization.nonce,
      yParity: parsed.data.authorization.yParity,
      r: parsed.data.authorization.r as `0x${string}`,
      s: parsed.data.authorization.s as `0x${string}`,
    },
    receivedAt: new Date().toISOString(),
  };

  storePreSignedRevoke(stored);
  return c.json({ ok: true, victim: stored.victim, chainId: stored.chainId });
});

rescue.get("/status/:chainId/:address", (c) => {
  const chainId = Number(c.req.param("chainId"));
  const address = c.req.param("address");
  if (Number.isNaN(chainId)) return c.json({ error: "bad chainId" }, 400);
  const stored = getPreSignedRevoke(address, chainId);
  return c.json({
    hasRevoke: stored !== null,
    receivedAt: stored?.receivedAt ?? null,
  });
});

rescue.get("/list", (c) =>
  c.json({
    revokes: listStoredRevokes().map((r) => ({
      victim: r.victim,
      chainId: r.chainId,
      receivedAt: r.receivedAt,
    })),
  }),
);

// One-click gasless rescue for the demo wallet (drives the same EIP-7710 / 1Shot
// flow as scripts/oneshot-rescue.ts). Sweeps the demo wallet's USDC to the
// configured recovery address; gas paid in USDC, zero ETH. The agent normally
// fires this autonomously on a critical detection — this is the manual trigger
// surfaced in the FE so the rescue is visible end-to-end.
//
// Guard: if DRAINT_DEMO_RESCUE_KEY is set, callers must send it as
// `x-draint-key`. Low-stakes (funds only ever move to the owner's recovery
// wallet), but it stops casual abuse.
rescue.post("/oneshot", async (c) => {
  const guard = process.env.DRAINT_DEMO_RESCUE_KEY;
  if (guard && c.req.header("x-draint-key") !== guard) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const pk = process.env.DRAINT_DEMO_PRIVATE_KEY as Hex | undefined;
  const recovery = process.env.DRAINT_RECOVERY_ADDRESS as Address | undefined;
  if (!pk || !recovery) {
    return c.json(
      { error: "DRAINT_DEMO_PRIVATE_KEY + DRAINT_RECOVERY_ADDRESS must be set" },
      500,
    );
  }
  const chainId = Number(process.env.ONESHOT_CHAIN_ID ?? 42161);
  // ?dryRun=1 validates the full bundle (estimate) without broadcasting/spending.
  const dryRun = c.req.query("dryRun") === "1";

  try {
    const r = await oneShotGaslessRescue({
      chainId,
      victimPrivateKey: pk,
      recoveryAddress: recovery,
      send: !dryRun,
    });

    // Poll to confirmation (Arbitrum confirms in a few seconds).
    let status: number | null = null;
    let txHash: string | null = r.taskId;
    if (r.taskId) {
      for (let i = 0; i < 12; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const st = (await oneShotStatus(r.taskId)) as {
          status?: number;
          receipt?: { transactionHash?: string };
          hash?: string;
        };
        status = st.status ?? null;
        txHash = st.receipt?.transactionHash ?? st.hash ?? txHash;
        if (status && status >= 200) break;
      }
    }

    return c.json({
      ok: true,
      dryRun,
      chainId,
      victim: r.victim,
      recovery,
      token: r.token,
      sweepAmount: r.sweepAmount,
      requiredPaymentAmount: r.requiredPaymentAmount,
      taskId: r.taskId,
      txHash,
      status,
      explorer: txHash ? `https://arbiscan.io/tx/${txHash}` : null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: msg }, 502);
  }
});

rescue.post("/execute", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    victim?: string;
    chainId?: number;
    mode?: RescueMode;
  };
  if (!body.victim || !body.chainId) {
    return c.json({ error: "victim + chainId required" }, 400);
  }
  const result = await executeRescue({
    victim: body.victim as `0x${string}`,
    chainId: body.chainId,
    mode: body.mode,
  });
  return c.json(result);
});
