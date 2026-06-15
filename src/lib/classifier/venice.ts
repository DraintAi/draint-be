// Venice AI integration — semantic classifier for borderline cases.
//
// Venice is OpenAI-compatible (https://docs.venice.ai). We point the OpenAI
// SDK at api.venice.ai/api/v1 and use GLM 5.1 (reasoning model) for nuanced
// classification of contracts that the heuristic flagged as borderline.
//
// Privacy: Venice claims no data retention. We do NOT send user wallet info —
// only the target contract address + extracted features. Per drain't ethos.

import OpenAI from "openai";
import type { ContractFeatures, Severity } from "./types.js";

const VENICE_API_KEY = process.env.VENICE_API_KEY;
const VENICE_API_BASE =
  process.env.VENICE_API_BASE || "https://api.venice.ai/api/v1";
// Default: openai-gpt-oss-120b — Venice's cheapest reasoning model with
// function calling ($0.07/M tokens, 128k context). drain't requests are
// ~500 tokens each, so a $1 credit balance funds ~28k classifications.
// Premium tier (zai-org-glm-5-1) is $1.75/M — only switch if your
// Venice account has the balance.
const VENICE_MODEL = process.env.VENICE_MODEL || "openai-gpt-oss-120b";

const client = VENICE_API_KEY
  ? new OpenAI({ apiKey: VENICE_API_KEY, baseURL: VENICE_API_BASE })
  : null;

export const veniceEnabled = client !== null;

export interface VeniceVerdict {
  riskScore: number;
  severity: Severity;
  reasoning: string;
  concerns: string[];
  modelUsed: string;
  latencyMs: number;
}

const SYSTEM_PROMPT = `You are a security analyst evaluating an Ethereum smart contract for EIP-7702 delegation drainer risk.

Context:
- The contract under analysis is being considered as a delegation target via an EIP-7702 authorization that a user is about to sign.
- If malicious, the signer's wallet will be controllable by the contract's code and assets can be drained.
- "CrimeEnjoyor" family contracts (Wintermute terminology) are the canonical drainer class: tiny bytecode, fallback-only dispatch, auto-forward incoming assets in the same block. ~97% of 7702 delegations in the wild are malicious.
- Legitimate delegation targets include: MetaMask Hybrid Delegator, Safe singleton, Argent, Biconomy, ZeroDev smart account implementations.

Respond ONLY with a single JSON object matching this schema (no markdown fences, no commentary):
{
  "riskScore": <number 0.0-1.0, where 1.0 = definitely a drainer>,
  "severity": "safe" | "unknown" | "warning" | "critical",
  "reasoning": "<2-3 plain-English sentences explaining the verdict>",
  "concerns": ["<concrete concern 1>", "<concrete concern 2>", ...]
}

Be conservative: false positive is better than false negative for security tooling.
Severity mapping: <0.3 safe, 0.3-0.5 unknown, 0.5-0.7 warning, >=0.7 critical.`;

function buildUserPrompt(
  features: ContractFeatures,
  heuristicScore: number,
  heuristicReasons: string[],
): string {
  const bytecodePreview = features.bytecode
    ? features.bytecode.slice(0, 500) +
      (features.bytecode.length > 500 ? "..." : "")
    : "(no bytecode — EOA)";

  return `EXTRACTED FEATURES:
- Address: ${features.address}
- Chain ID: ${features.chainId}
- Bytecode size: ${features.bytecodeSize} bytes
- Is EOA: ${features.isEOA}
- Is EIP-7702 delegated: ${features.is7702Delegated}${features.delegationTarget ? ` → ${features.delegationTarget}` : ""}
- Function selectors (${features.functionSelectors.length}): ${features.functionSelectors.slice(0, 10).join(", ") || "(none)"}
- Has fallback: ${features.hasFallback}
- Has receive: ${features.hasReceive}
- Verified on Etherscan: ${features.isVerified}
- Contract name: ${features.contractName ?? "(unknown / unverified)"}

HEURISTIC PRIOR:
- Score: ${heuristicScore.toFixed(2)}
- Reasons: ${heuristicReasons.length > 0 ? heuristicReasons.join(" | ") : "(none)"}

BYTECODE PREVIEW (first 500 hex chars):
${bytecodePreview}

Classify this target. Return JSON only.`;
}

/**
 * Run Venice AI semantic classification on borderline contracts.
 * Returns null if Venice is disabled, errors, or returns malformed output.
 */
export async function veniceClassify(
  features: ContractFeatures,
  heuristicScore: number,
  heuristicReasons: string[],
): Promise<VeniceVerdict | null> {
  if (!client) return null;

  const startTime = Date.now();

  try {
    const response = await client.chat.completions.create({
      model: VENICE_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: buildUserPrompt(features, heuristicScore, heuristicReasons),
        },
      ],
      temperature: 0.1,
      // Headroom for reasoning models (e.g. GLM 5.1): chain-of-thought tokens
      // count toward the completion budget, so 600 can leave no room for the
      // JSON body. 1024 keeps the final object intact.
      max_tokens: 1024,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = parseVeniceResponse(content);
    if (!parsed) return null;

    return {
      riskScore: normalizeRiskScore(parsed.riskScore),
      severity: normalizeSeverity(parsed.severity),
      reasoning: String(parsed.reasoning ?? "").slice(0, 1000),
      concerns: Array.isArray(parsed.concerns)
        ? parsed.concerns.slice(0, 10).map((s) => String(s).slice(0, 200))
        : [],
      modelUsed: VENICE_MODEL,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    // Graceful degrade — log, return null, heuristic score remains
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[venice] classify failed: ${msg}`);
    return null;
  }
}

function parseVeniceResponse(content: string): Record<string, unknown> | null {
  // Strip potential markdown fences if model violated instructions
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeSeverity(s: unknown): Severity {
  const v = String(s ?? "").toLowerCase();
  if (v === "critical" || v === "warning" || v === "safe" || v === "unknown")
    return v;
  return "unknown";
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Normalize a model-returned risk score to 0.0–1.0.
 * Reasoning models (e.g. GLM 5.1) often ignore the "0.0-1.0" instruction and
 * return a 0–100 integer (e.g. 95). Treat anything >1 as a percentage so a
 * borderline "45" doesn't get clamped straight to 1.0 (false critical).
 */
function normalizeRiskScore(raw: unknown): number {
  let n = Number(raw);
  if (Number.isNaN(n)) return 0;
  if (n > 1) n = n / 100;
  return clamp(n, 0, 1);
}
