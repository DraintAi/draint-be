// drain't reference agent — state store.
//
// In-memory implementation for MVP. Vercel Functions are stateless across
// invocations, so this is suitable only for local dev + demo recording.
// Production wiring: swap with Upstash Redis (Vercel Marketplace) — same
// interface, just persistent.

import type { AgentState, Incident, WatchedAddress } from "./types";

const MAX_INCIDENTS = 100;

const memory: AgentState = {
  lastSeenBlock: {},
  watch: {},
  incidents: [],
};

function watchKey(address: string, chainId: number): string {
  return `${chainId}:${address.toLowerCase()}`;
}

export const stateStore = {
  async getAll(): Promise<AgentState> {
    return memory;
  },

  async listWatched(): Promise<WatchedAddress[]> {
    return Object.values(memory.watch);
  },

  async addWatch(entry: WatchedAddress): Promise<void> {
    memory.watch[watchKey(entry.address, entry.chainId)] = entry;
  },

  async removeWatch(address: string, chainId: number): Promise<boolean> {
    const key = watchKey(address, chainId);
    if (!(key in memory.watch)) return false;
    delete memory.watch[key];
    return true;
  },

  async updateWatch(
    address: string,
    chainId: number,
    patch: Partial<WatchedAddress>,
  ): Promise<void> {
    const key = watchKey(address, chainId);
    const current = memory.watch[key];
    if (!current) return;
    memory.watch[key] = { ...current, ...patch };
  },

  async pushIncident(incident: Incident): Promise<void> {
    memory.incidents.unshift(incident);
    if (memory.incidents.length > MAX_INCIDENTS) {
      memory.incidents.length = MAX_INCIDENTS;
    }
  },

  async listIncidents(limit = 20): Promise<Incident[]> {
    return memory.incidents.slice(0, limit);
  },

  async clear(): Promise<void> {
    memory.watch = {};
    memory.incidents.length = 0;
    memory.lastSeenBlock = {};
  },
};
