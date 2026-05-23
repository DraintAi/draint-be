// Known EIP-7702 delegation drainer dataset.
//
// Curated from:
// - Wintermute "CrimeEnjoyor" research (https://x.com/wintermute_t)
// - Wintermute Dune dashboard: https://dune.com/wintermute_research/eip-7702
// - On-chain forensics (incidents per news 2025-2026)
//
// Update strategy: hashes get populated as we run attack simulations on Day 7+.
// The classifier is designed to work with empty dataset (heuristic fallback)
// and improve as the dataset grows.

import type { KnownDrainer } from "./types.js";

export const KNOWN_DRAINERS: KnownDrainer[] = [
  {
    name: "CrimeEnjoyor (canonical)",
    family: "CrimeEnjoyor",
    // Hash placeholder — populate from Wintermute verified bytecode after fetching
    // bytecodeHash: "0x...",
    knownAddresses: [
      // Populate from etherscan search "CrimeEnjoyor" verified contracts
    ],
    source: "https://x.com/wintermute_t/status/1932101433916305743",
    description:
      "Original copy-paste sweeper. Simple fallback() that forwards incoming assets out same-block. Auto-drains wallet on next deposit.",
  },
  {
    name: "CrimeEnjoyorMock (drain't test fixture)",
    family: "CrimeEnjoyor",
    // Captured from `forge test --match-contract AttackSimulation`
    // Solc 0.8.28, evm_version=prague, optimizer 200 runs.
    // See DraintAi/draint-sc/src/CrimeEnjoyorMock.sol
    bytecodeHash:
      "0x65daf5c275ec5799e9203ca6b76f44b315a87c786210fc868615fa4d5afd2d6e",
    knownAddresses: [
      // Live deploy on Sepolia, attacker sink = 0xdEaD. Used by drain't honeypot.
      "0xae5d26e8bdfe3bfeed4c9a27c2394dbb2f70fd73",
    ],
    source: "DraintAi/draint-sc test fixture",
    description:
      "drain't internal CrimeEnjoyor reproduction. Used in Day 7 attack simulation. Tiny bytecode (345 bytes), fallback + receive only, immutable attacker address, auto-forwards all incoming ETH.",
  },
  {
    name: "CrimeEnjoyor2",
    family: "CrimeEnjoyor2",
    source: "Wintermute Dune dashboard",
    description:
      "Second-generation variant. Slight bytecode modifications to evade hash-based detection.",
  },
  {
    name: "AdvancedCrimeEnjoyor",
    family: "AdvancedCrimeEnjoyor",
    source: "Wintermute Dune dashboard",
    description:
      "More sophisticated variant with conditional execution. Larger bytecode footprint, branching logic.",
  },
  {
    name: "HardcodedCrimeEnjoyor",
    family: "HardcodedCrimeEnjoyor",
    source: "Wintermute Dune dashboard",
    description:
      "Variant with hardcoded attacker address as drain destination. Most common in mass-distribution drainer kits.",
  },
];

/**
 * Lookup a drainer by bytecode hash.
 * Returns the matching family or null.
 */
export function findByHash(hash: string): KnownDrainer | null {
  const needle = hash.toLowerCase();
  return (
    KNOWN_DRAINERS.find((d) => d.bytecodeHash?.toLowerCase() === needle) ?? null
  );
}

/**
 * Lookup a drainer by address (across all chains — addresses are unique by deploy).
 */
export function findByAddress(address: string): KnownDrainer | null {
  const needle = address.toLowerCase();
  return (
    KNOWN_DRAINERS.find((d) =>
      d.knownAddresses?.some((a) => a.toLowerCase() === needle),
    ) ?? null
  );
}
