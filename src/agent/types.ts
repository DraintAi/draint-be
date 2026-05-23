// drain't reference agent — shared types.
//
// This module powers the autonomous monitoring loop demonstrated in the
// Best Agent + Best A2A tracks. The agent watches a set of addresses for
// EIP-7702 delegation changes and reacts when a malicious delegation is
// detected.

import type { Address, Severity } from "../lib/classifier/types.js";

export interface WatchedAddress {
  address: Address;
  chainId: number;
  /** Last bytecode hash seen at this address — used to detect change events. */
  lastBytecodeHash: string | null;
  /** Last 7702 delegation target observed. */
  lastDelegationTarget: Address | null;
  /** When did we last check this address? */
  lastCheckedAt: string;
  /** Optional: a recovery address for asset evacuation (Day 11 wiring). */
  recoveryAddress: Address | null;
  /** If true, agent auto-rescues critical incidents (Day 11). Otherwise just alerts. */
  autoRescue: boolean;
}

export type IncidentKind =
  | "delegation_changed"
  | "delegation_malicious"
  | "delegation_critical";

export interface Incident {
  id: string;
  at: string;
  kind: IncidentKind;
  address: Address;
  chainId: number;
  delegationTarget: Address | null;
  severity: Severity;
  riskScore: number;
  matchedPattern: string | null;
  reasoning: string[];
  /** Outcome of any rescue action attempted. Day 11 will populate this. */
  rescue: {
    attempted: boolean;
    txHash: string | null;
    success: boolean;
    error: string | null;
  } | null;
}

export interface AgentState {
  /** Last block scanned per chain — used for resumable polling (future). */
  lastSeenBlock: Record<number, string>;
  watch: Record<string, WatchedAddress>;
  incidents: Incident[];
}
