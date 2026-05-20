// Classifier orchestrator.
// Combines bytecode fetch → feature extraction → Etherscan lookup → scoring.

import { fetchBytecode, fetchContractAge } from "./bytecode";
import { fetchSourceMeta } from "./etherscan";
import {
  extractFunctionSelectors,
  hasFallback,
  hasReceive,
} from "./features";
import { scoreContract } from "./heuristic";
import type { Address, ClassifyResult, ContractFeatures } from "./types";

export const CLASSIFIER_VERSION = "0.1.0-heuristic";

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

  const scoring = scoreContract(features);

  return {
    chainId,
    target,
    ...scoring,
    features,
    classifiedAt: new Date().toISOString(),
    classifierVersion: CLASSIFIER_VERSION,
  };
}
