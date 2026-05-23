// drain't reference agent — decision loop.
//
// Each tick:
//   1. Pull every watched address
//   2. For each: probe for bytecode change (especially 7702 delegation)
//   3. If delegation target changed, classify it via own SDK (dogfood)
//   4. If severity warrants, record an incident
//   5. If `autoRescue` is on for that watch AND severity == critical, queue
//      a rescue action (Day 11 wires the actual 1Shot relayer call)
//   6. Update watch state with the new observation
//
// This is the AI agent's heartbeat. Brain (Venice AI) lives inside
// `classifyContract` — the agent itself just orchestrates skills.

import { classifyContract } from "../lib/classifier/index.js";
import type { Severity } from "../lib/classifier/types.js";
import { probeAddress, type ChangeDetected } from "./monitor.js";
import { executeRescue, getPreSignedRevoke } from "./rescue.js";
import { stateStore } from "./state.js";
import type { Incident } from "./types.js";

export interface TickResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  watchedCount: number;
  changesDetected: number;
  incidentsRaised: number;
  errors: { address: string; chainId: number; error: string }[];
}

export async function runOneTick(): Promise<TickResult> {
  const started = new Date();
  const watched = await stateStore.listWatched();
  let changes = 0;
  let incidents = 0;
  const errors: TickResult["errors"] = [];

  for (const w of watched) {
    try {
      const change = await probeAddress({
        address: w.address,
        chainId: w.chainId,
        lastBytecodeHash: w.lastBytecodeHash,
        lastDelegationTarget: w.lastDelegationTarget,
      });

      // Always update our last-seen state, even on no-change ticks
      await stateStore.updateWatch(w.address, w.chainId, {
        lastCheckedAt: started.toISOString(),
      });

      if (!change) continue;
      changes += 1;

      // Persist new bytecode hash + delegation target for next tick
      await stateStore.updateWatch(w.address, w.chainId, {
        lastBytecodeHash: change.newBytecodeHash,
        lastDelegationTarget: change.delegationTarget,
      });

      // Only delegation-target changes are interesting for incident analysis.
      if (
        change.kind === "delegation-changed" ||
        (change.kind === "first-seen" && change.delegationTarget !== null)
      ) {
        const incident = await analyzeDelegationChange(change, w.autoRescue);
        if (incident) {
          await stateStore.pushIncident(incident);
          incidents += 1;
        }
      }
    } catch (err) {
      errors.push({
        address: w.address,
        chainId: w.chainId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const finished = new Date();
  return {
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    watchedCount: watched.length,
    changesDetected: changes,
    incidentsRaised: incidents,
    errors,
  };
}

/**
 * Run the AI classifier on a new delegation target and decide what to do.
 * The agent dogfoods its own skill — same code path as external consumers.
 */
async function analyzeDelegationChange(
  change: ChangeDetected,
  autoRescue: boolean,
): Promise<Incident | null> {
  // If delegation was revoked (target == null), that's good news — log but no incident.
  if (!change.delegationTarget) return null;

  const verdict = await classifyContract({
    chainId: change.chainId,
    target: change.delegationTarget,
  });

  // Below "unknown" — heuristic confident the target is fine. No alert.
  if (verdict.severity === "safe") return null;

  const incident: Incident = {
    id: incidentId(),
    at: new Date().toISOString(),
    kind: severityToKind(verdict.severity),
    address: change.address,
    chainId: change.chainId,
    delegationTarget: change.delegationTarget,
    severity: verdict.severity,
    riskScore: verdict.riskScore,
    matchedPattern: verdict.matchedPattern,
    reasoning: verdict.reasons,
    rescue: null,
  };

  // Critical + auto-rescue on → execute rescue immediately.
  // Redelegation chain: user pre-signed revoke (delegated rescue authority
  // to drain't), drain't broadcasts it either directly (Sepolia/dev) or
  // forwards to 1Shot relayer (mainnet, gas paid in stablecoin).
  if (verdict.severity === "critical" && autoRescue) {
    const stored = getPreSignedRevoke(change.address, change.chainId);
    if (!stored) {
      incident.rescue = {
        attempted: false,
        txHash: null,
        success: false,
        error: "No pre-signed revoke held. User must pre-sign at onboarding.",
      };
    } else {
      const r = await executeRescue({
        victim: change.address,
        chainId: change.chainId,
      });
      incident.rescue = {
        attempted: r.attempted,
        txHash: r.txHash,
        success: r.txHash !== null && r.error === null,
        error: r.error,
      };
    }
  }

  return incident;
}

function severityToKind(severity: Severity): Incident["kind"] {
  if (severity === "critical") return "delegation_critical";
  if (severity === "warning") return "delegation_malicious";
  return "delegation_changed";
}

function incidentId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return `inc_${Date.now().toString(36)}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
