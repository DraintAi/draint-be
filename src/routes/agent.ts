// drain't reference agent — HTTP surface.
//
// Endpoints:
//   POST /api/agent/tick           — manual trigger (Vercel Cron calls this)
//   GET  /api/agent/watch          — list watched addresses
//   POST /api/agent/watch          — add a watch entry
//   DELETE /api/agent/watch/:id    — remove a watch
//   GET  /api/agent/incidents      — read alert history
//   POST /api/agent/clear          — wipe state (demo reset)

import { Hono, type Context } from "hono";
import { z } from "zod";
import { runOneTick } from "../agent/loop.js";
import { stateStore } from "../agent/state.js";

export const agent = new Hono();

const ADDRESS = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address");

const AddWatchBody = z.object({
  address: ADDRESS,
  chainId: z.number().int().positive(),
  recoveryAddress: ADDRESS.optional(),
  autoRescue: z.boolean().default(false),
});

async function handleTick(c: Context) {
  // Vercel Cron sends an Authorization header with the configured CRON_SECRET
  // when set. We honor it but don't require it — public-cron acceptable for
  // MVP; user can lock down later.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = c.req.header("authorization");
    if (auth !== `Bearer ${secret}`) {
      return c.json({ error: "unauthorized" }, 401);
    }
  }
  try {
    const result = await runOneTick();
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Tick failed", message }, 500);
  }
}

// GET form is what Vercel Cron actually calls
agent.get("/tick", handleTick);
// POST form for manual invocation from test harness
agent.post("/tick", handleTick);

agent.get("/watch", async (c) => {
  const list = await stateStore.listWatched();
  return c.json({ watched: list });
});

agent.post("/watch", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = AddWatchBody.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      400,
    );
  }

  await stateStore.addWatch({
    address: parsed.data.address.toLowerCase() as `0x${string}`,
    chainId: parsed.data.chainId,
    lastBytecodeHash: null,
    lastDelegationTarget: null,
    lastCheckedAt: new Date().toISOString(),
    recoveryAddress:
      (parsed.data.recoveryAddress?.toLowerCase() as
        | `0x${string}`
        | undefined) ?? null,
    autoRescue: parsed.data.autoRescue,
  });

  return c.json({ ok: true });
});

agent.delete("/watch/:chainId/:address", async (c) => {
  const chainId = Number(c.req.param("chainId"));
  const address = c.req.param("address");
  const removed = await stateStore.removeWatch(address, chainId);
  return c.json({ ok: removed });
});

agent.get("/incidents", async (c) => {
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw))) : 20;
  const incidents = await stateStore.listIncidents(limit);
  return c.json({ incidents });
});

agent.post("/clear", async (c) => {
  await stateStore.clear();
  return c.json({ ok: true });
});
