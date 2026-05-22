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
} from "../agent/rescue";

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
