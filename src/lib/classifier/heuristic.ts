// Heuristic risk scoring.
//
// Score range: 0.0 (safe) → 1.0 (critical).
// Severity bands: <0.3 safe, 0.3-0.5 unknown, 0.5-0.7 warning, >0.7 critical.
//
// Weights tuned for EIP-7702 delegation drainer detection.
// Real-world tuning happens Day 7 attack simulation; numbers here are
// reasoned defaults from CrimeEnjoyor characteristics.

import type { ClassifyResult, ContractFeatures, Severity } from "./types";
import { findByAddress, findByHash } from "./known-drainers";

interface ScoreContribution {
  factor: string;
  weight: number;
  reason: string;
}

/**
 * CrimeEnjoyor signature: tiny bytecode, no selectors, fallback present.
 * Wintermute reversed it — typical size < 200 bytes.
 */
const CRIME_ENJOYOR_MAX_SIZE = 200;

/**
 * Threshold below which contract is "newly deployed" — suspicious for delegation.
 * 24h = 60*60*24 seconds.
 */
const FRESH_CONTRACT_AGE_SECONDS = 86400;

export function scoreContract(features: ContractFeatures): {
  riskScore: number;
  severity: Severity;
  matchedPattern: string | null;
  reasons: string[];
} {
  // === Hard rules first (short-circuit) ===

  if (features.isEOA) {
    return {
      riskScore: 0.05,
      severity: "safe",
      matchedPattern: null,
      reasons: [
        "Target is an EOA (no code). Cannot drain via delegation — but verify intent.",
      ],
    };
  }

  // EIP-7702 delegated EOA — threat surface is the delegation target, not this address
  if (features.is7702Delegated && features.delegationTarget) {
    return {
      riskScore: 0.3,
      severity: "unknown",
      matchedPattern: "eip7702_delegated_eoa",
      reasons: [
        `This is a smart EOA delegated via EIP-7702 to ${features.delegationTarget}.`,
        "To assess the actual threat, classify the delegation target directly.",
        "If the delegation target is malicious, this EOA's assets are at risk.",
      ],
    };
  }

  // Known drainer exact match — maximum risk
  if (features.bytecodeHash) {
    const hashMatch = findByHash(features.bytecodeHash);
    if (hashMatch) {
      return {
        riskScore: 1.0,
        severity: "critical",
        matchedPattern: hashMatch.name,
        reasons: [
          `Exact bytecode hash match: ${hashMatch.name}`,
          hashMatch.description,
          `Source: ${hashMatch.source}`,
        ],
      };
    }
  }

  const addrMatch = findByAddress(features.address);
  if (addrMatch) {
    return {
      riskScore: 0.98,
      severity: "critical",
      matchedPattern: addrMatch.name,
      reasons: [
        `Address is on known drainer list: ${addrMatch.name}`,
        addrMatch.description,
      ],
    };
  }

  // === Soft heuristic — accumulate signals ===

  const contributions: ScoreContribution[] = [];

  // Tiny bytecode + fallback + no selectors = CrimeEnjoyor signature
  if (
    features.bytecodeSize > 0 &&
    features.bytecodeSize < CRIME_ENJOYOR_MAX_SIZE &&
    features.functionSelectors.length === 0 &&
    features.hasFallback
  ) {
    contributions.push({
      factor: "crime_enjoyor_signature",
      weight: 0.7,
      reason: `Tiny bytecode (${features.bytecodeSize} bytes), no public functions, only fallback — classic CrimeEnjoyor shape`,
    });
  }

  // Fallback-only contract — strong drain risk regardless of size
  if (features.hasFallback && features.functionSelectors.length === 0) {
    contributions.push({
      factor: "fallback_only",
      weight: 0.25,
      reason:
        "Contract has only a fallback function and no public methods (atypical for legitimate dApps)",
    });
  }

  // Unverified source = unknown intent
  if (features.isVerified === false) {
    contributions.push({
      factor: "unverified_source",
      weight: 0.15,
      reason: "Contract source code not verified on Etherscan",
    });
  }

  // Very fresh contract (< 24h old)
  if (
    features.ageSeconds !== null &&
    features.ageSeconds < FRESH_CONTRACT_AGE_SECONDS
  ) {
    contributions.push({
      factor: "fresh_deployment",
      weight: 0.2,
      reason: `Deployed less than 24h ago (${Math.floor(features.ageSeconds / 60)} minutes old)`,
    });
  }

  // Suspicious small bytecode (sweeper-style)
  if (
    features.bytecodeSize > 0 &&
    features.bytecodeSize < CRIME_ENJOYOR_MAX_SIZE &&
    !features.isVerified
  ) {
    contributions.push({
      factor: "small_unverified",
      weight: 0.1,
      reason: `Small unverified contract (${features.bytecodeSize} bytes) — sweeper-style footprint`,
    });
  }

  // === Compute final score ===

  const rawScore = contributions.reduce((sum, c) => sum + c.weight, 0);
  // Cap between 0 and 1; we want the strongest single signal to anchor severity.
  const riskScore = Math.min(1.0, rawScore);

  const severity = scoreToSeverity(riskScore);
  const reasons =
    contributions.length > 0
      ? contributions.map((c) => c.reason)
      : [
          features.bytecodeSize > 0
            ? "Contract has no matching drainer signatures; appears to be a regular dApp."
            : "No bytecode found — verify target manually.",
        ];

  // Pick top contribution as matched pattern label
  const topContrib = contributions.sort((a, b) => b.weight - a.weight)[0];

  return {
    riskScore,
    severity,
    matchedPattern: topContrib?.factor ?? null,
    reasons,
  };
}

function scoreToSeverity(score: number): Severity {
  if (score >= 0.7) return "critical";
  if (score >= 0.5) return "warning";
  if (score >= 0.3) return "unknown";
  return "safe";
}
