import { Hono } from "hono";
import { z } from "zod";

export const classify = new Hono();

const ClassifyRequest = z.object({
  chainId: z.number().int().positive(),
  target: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address"),
  origin: z.string().url().optional(),
});

/**
 * POST /api/classify
 * Classify a contract address for EIP-7702 delegation drainer risk.
 *
 * TODO Day 2-3: implement actual classifier (heuristic + Venice AI)
 * For now: stub that returns deterministic placeholder.
 */
classify.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ClassifyRequest.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.flatten() }, 400);
  }

  const { chainId, target } = parsed.data;

  return c.json({
    chainId,
    target,
    riskScore: 0,
    severity: "unknown",
    matchedPattern: null,
    explanation: "Classifier not yet implemented (Day 2-3 task)",
    classifiedAt: new Date().toISOString(),
  });
});
