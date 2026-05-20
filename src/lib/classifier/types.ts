// Shared classifier types

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export type Severity = "safe" | "unknown" | "warning" | "critical";

export interface ContractFeatures {
  address: Address;
  chainId: number;
  bytecode: Hex | null;
  bytecodeHash: Hex | null;
  bytecodeSize: number;
  isEOA: boolean;
  /** True if address is an EOA that has been EIP-7702 delegated to a smart contract. */
  is7702Delegated: boolean;
  /** Target of the 7702 delegation, if applicable. Null otherwise. */
  delegationTarget: Address | null;
  hasFallback: boolean;
  hasReceive: boolean;
  functionSelectors: string[];
  isVerified: boolean | null;
  contractName: string | null;
  ageBlocks: number | null;
  ageSeconds: number | null;
}

export interface KnownDrainer {
  name: string;
  family: "CrimeEnjoyor" | "CrimeEnjoyor2" | "AdvancedCrimeEnjoyor" | "HardcodedCrimeEnjoyor" | "Other";
  bytecodeHash?: Hex;
  knownAddresses?: Address[];
  source: string;
  description: string;
}

export interface VeniceVerdict {
  riskScore: number;
  severity: Severity;
  reasoning: string;
  concerns: string[];
  modelUsed: string;
  latencyMs: number;
}

export interface ClassifyResult {
  chainId: number;
  target: Address;
  riskScore: number; // 0.0 - 1.0 (final, post-merge)
  severity: Severity; // final severity
  matchedPattern: string | null;
  reasons: string[];
  features: ContractFeatures;
  /** Heuristic-only result, before AI merge. */
  heuristic: {
    riskScore: number;
    severity: Severity;
  };
  /** Venice AI verdict, if borderline and Venice enabled. Null otherwise. */
  venice: VeniceVerdict | null;
  classifiedAt: string;
  classifierVersion: string;
}
