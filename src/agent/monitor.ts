// drain't reference agent — bytecode change monitor.
//
// Detection strategy: poll eth_getCode for each watched address. If the
// returned bytecode is the EIP-7702 delegation designator (`0xef0100<addr>`)
// AND the target changed since the last check, that's a delegation event.
//
// Why polling and not log subscription? EIP-7702 SET_CODE transactions do
// not emit an event — there is no canonical Transfer-style log to subscribe
// to. Scanning every block for type-0x04 txs is feasible but expensive on
// large chains. Per-address polling is cheap (1 RPC call per address per
// tick) and fits inside Vercel Cron's 60s minimum interval.

import { keccak256 } from "viem";
import { fetchBytecode } from "../lib/classifier/bytecode.js";
import type { Address } from "../lib/classifier/types.js";

export interface ChangeDetected {
  kind: "first-seen" | "bytecode-changed" | "delegation-changed";
  address: Address;
  chainId: number;
  newBytecodeHash: string;
  /** Non-null iff the address now points at an EIP-7702 delegation target. */
  delegationTarget: Address | null;
  /** Previous delegation target — null if address wasn't 7702 before. */
  previousDelegationTarget: Address | null;
}

export interface MonitorContext {
  address: Address;
  chainId: number;
  lastBytecodeHash: string | null;
  lastDelegationTarget: Address | null;
}

/**
 * Probe one address. Returns a change descriptor if something interesting
 * happened, or null if nothing changed.
 */
export async function probeAddress(
  ctx: MonitorContext,
): Promise<ChangeDetected | null> {
  const fetched = await fetchBytecode(ctx.chainId, ctx.address);

  // No code at all (EOA, no 7702) — only interesting if we previously saw
  // a delegation that has now been revoked.
  if (fetched.isEOA) {
    if (ctx.lastDelegationTarget) {
      return {
        kind: "delegation-changed",
        address: ctx.address,
        chainId: ctx.chainId,
        newBytecodeHash: "0x",
        delegationTarget: null,
        previousDelegationTarget: ctx.lastDelegationTarget,
      };
    }
    return null;
  }

  // Compute hash from raw bytecode for change detection.
  const newHash =
    fetched.bytecodeHash ?? keccak256((fetched.bytecode ?? "0x") as `0x${string}`);

  if (ctx.lastBytecodeHash === null) {
    return {
      kind: "first-seen",
      address: ctx.address,
      chainId: ctx.chainId,
      newBytecodeHash: newHash,
      delegationTarget: fetched.delegationTarget,
      previousDelegationTarget: null,
    };
  }

  if (newHash === ctx.lastBytecodeHash) {
    return null;
  }

  const isDelegationChange =
    fetched.is7702Delegated &&
    fetched.delegationTarget !== ctx.lastDelegationTarget;

  return {
    kind: isDelegationChange ? "delegation-changed" : "bytecode-changed",
    address: ctx.address,
    chainId: ctx.chainId,
    newBytecodeHash: newHash,
    delegationTarget: fetched.delegationTarget,
    previousDelegationTarget: ctx.lastDelegationTarget,
  };
}
