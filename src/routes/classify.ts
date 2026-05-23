import { Hono } from "hono";
import { z } from "zod";
import { classifyContract } from "../lib/classifier/index.js";

export const classify = new Hono();

const ClassifyRequest = z.object({
  chainId: z.number().int().positive(),
  target: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid EVM address") as z.ZodType<`0x${string}`>,
  origin: z.string().url().optional(),
});

/**
 * POST /api/classify
 * Classify a contract address for EIP-7702 delegation drainer risk.
 *
 * Day 2: heuristic classifier (bytecode + features + Etherscan + dataset).
 * Day 3: Venice AI semantic layer on borderline cases.
 */
classify.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = ClassifyRequest.safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      400,
    );
  }

  const { chainId, target } = parsed.data;

  try {
    const result = await classifyContract({ chainId, target });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Classifier failed", message }, 500);
  }
});

/**
 * GET /api/classify/:chainId/:address — convenience for browser/curl testing
 */
classify.get("/:chainId/:address", async (c) => {
  const chainId = Number(c.req.param("chainId"));
  const address = c.req.param("address");

  const parsed = ClassifyRequest.safeParse({ chainId, target: address });
  if (!parsed.success) {
    return c.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      400,
    );
  }

  try {
    const result = await classifyContract(parsed.data);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "Classifier failed", message }, 500);
  }
});
