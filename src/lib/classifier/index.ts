// Classifier orchestrator.
// Combines bytecode fetch → feature extraction → Etherscan lookup → heuristic
// scoring → Venice AI semantic refinement (borderline cases only).

import { fetchBytecode, fetchContractAge } from "./bytecode";
import { fetchSourceMeta } from "./etherscan";
import {
  extractFunctionSelectors,
  hasFallback,
  hasReceive,
} from "./features";
import { scoreContract } from "./heuristic";
import type {
  Address,
  ClassifyResult,
  ContractFeatures,
  Severity,
} from "./types";
import { veniceClassify, veniceEnabled } from "./venice";

export const CLASSIFIER_VERSION = "0.2.0-heuristic+venice";

/** Below this, no Venice call — already deemed safe. */
const BORDERLINE_LOW = 0.3;
/** Above this, no Venice call — already deemed critical. */
const BORDERLINE_HIGH = 0.7;

export interface ClassifyInput {
  chainId: number;
  target: Address;
}

export async function classifyContract(
  input: ClassifyInput,
): Promise<ClassifyResult> {
  const { chainId, target } = input;

  // Parallel: bytecode + age + source meta
  const [bc, age, source] = await Promise.all([
    fetchBytecode(chainId, target),
    fetchContractAge(chainId, target),
    fetchSourceMeta(chainId, target),
  ]);

  // Extract bytecode-derived features (only if bytecode exists)
  const selectors = bc.bytecode ? extractFunctionSelectors(bc.bytecode) : [];
  const fallback = bc.bytecode ? hasFallback(bc.bytecode, selectors) : false;
  const receive = bc.bytecode ? hasReceive(bc.bytecode) : false;

  const features: ContractFeatures = {
    address: target,
    chainId,
    bytecode: bc.bytecode,
    bytecodeHash: bc.bytecodeHash,
    bytecodeSize: bc.bytecodeSize,
    isEOA: bc.isEOA,
    is7702Delegated: bc.is7702Delegated,
    delegationTarget: bc.delegationTarget,
    hasFallback: fallback,
    hasReceive: receive,
    functionSelectors: selectors,
    isVerified: source.isVerified,
    contractName: source.contractName,
    ageBlocks: age.ageBlocks,
    ageSeconds: age.ageSeconds,
  };

  const heuristic = scoreContract(features);

  // Venice AI semantic refinement — only on borderline cases to save latency + cost
  const isBorderline =
    heuristic.riskScore >= BORDERLINE_LOW &&
    heuristic.riskScore < BORDERLINE_HIGH;

  const venice =
    veniceEnabled && isBorderline
      ? await veniceClassify(features, heuristic.riskScore, heuristic.reasons)
      : null;

  // Merge: conservative max to bias toward false-positive (safer for security)
  let finalScore = heuristic.riskScore;
  let finalSeverity = heuristic.severity;
  let mergedReasons = [...heuristic.reasons];

  if (venice) {
    finalScore = Math.max(heuristic.riskScore, venice.riskScore);
    finalSeverity = scoreToSeverity(finalScore);
    mergedReasons = [
      ...heuristic.reasons,
      `[Venice AI] ${venice.reasoning}`,
      ...venice.concerns.map((c) => `[Venice AI concern] ${c}`),
    ];
  }

  return {
    chainId,
    target,
    riskScore: finalScore,
    severity: finalSeverity,
    matchedPattern: heuristic.matchedPattern,
    reasons: mergedReasons,
    features,
    heuristic: {
      riskScore: heuristic.riskScore,
      severity: heuristic.severity,
    },
    venice,
    classifiedAt: new Date().toISOString(),
    classifierVersion: CLASSIFIER_VERSION,
  };
}

function scoreToSeverity(score: number): Severity {
  if (score >= 0.7) return "critical";
  if (score >= 0.5) return "warning";
  if (score >= 0.3) return "unknown";
  return "safe";
}
