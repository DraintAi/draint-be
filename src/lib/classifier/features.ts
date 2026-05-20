// Feature extraction from raw bytecode.
//
// EVM opcode reference: https://www.evm.codes/

import type { Hex } from "./types";

/**
 * Extract 4-byte function selectors from compiled bytecode.
 *
 * Heuristic: scan for the pattern `PUSH4 <4 bytes> EQ JUMPI` which is
 * the canonical Solidity-generated function dispatch pattern.
 *
 * Opcodes:
 *   PUSH4 = 0x63
 *   EQ    = 0x14
 *   JUMPI = 0x57
 *
 * False positives possible but acceptable for our risk-score use.
 */
export function extractFunctionSelectors(bytecode: Hex): string[] {
  const code = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  const selectors = new Set<string>();

  // Scan byte-by-byte for PUSH4 (0x63) followed by 4 bytes then EQ (0x14)
  for (let i = 0; i + 12 <= code.length; i += 2) {
    const op = code.slice(i, i + 2);
    if (op === "63") {
      const selector = "0x" + code.slice(i + 2, i + 10);
      const after = code.slice(i + 10, i + 12);
      if (after === "14") {
        selectors.add(selector);
      }
    }
  }

  return Array.from(selectors);
}

/**
 * Detect whether bytecode declares a fallback function.
 *
 * Solidity dispatch pattern: if no function selector matches, control falls
 * through to the fallback. A bytecode with NO selectors but executable code
 * after the dispatcher is a strong fallback indicator.
 *
 * Refined heuristic: presence of CALLDATASIZE (0x36) checks early in code
 * combined with executable code after the dispatch table.
 */
export function hasFallback(bytecode: Hex, selectors: string[]): boolean {
  const code = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;

  // Sweeper drainers often have no selectors (just a fallback that drains)
  // This is the strongest signal for CrimeEnjoyor-class contracts.
  if (selectors.length === 0 && code.length > 20) {
    return true;
  }

  // Otherwise, check for CALLDATASIZE LT JUMPI early pattern (fallback gate)
  // 0x36 = CALLDATASIZE, 0x10 = LT, 0x57 = JUMPI
  const earlyChunk = code.slice(0, 200);
  return /36.{0,4}10.{0,8}57/.test(earlyChunk);
}

/**
 * Detect `receive()` (payable function for plain ETH transfers).
 * Pattern: CALLDATASIZE ISZERO ... JUMPI (no calldata = bare ETH send).
 *
 * Opcodes: CALLDATASIZE=0x36, ISZERO=0x15, JUMPI=0x57
 */
export function hasReceive(bytecode: Hex): boolean {
  const code = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  return /36.{0,4}15.{0,8}57/.test(code.slice(0, 300));
}
