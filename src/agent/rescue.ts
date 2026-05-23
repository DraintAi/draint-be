// drain't reference agent — rescue execution path.
//
// When the monitor (loop.ts) detects a critical EIP-7702 delegation change
// on a watched address, the agent attempts to BROADCAST a pre-signed
// revoke authorization that resets the victim's bytecode to empty.
//
// The pre-signed authorization model:
//   1. At onboarding (or any moment of safety) the user signs a 7702
//      authorization with contractAddress = address(0), executor =
//      drain't agent's address (so drain't can broadcast, victim doesn't
//      need ETH to pay gas at rescue time).
//   2. drain't holds the signed auth via /api/agent/rescue/pre-sign.
//   3. When threat detected (loop.ts), executeRescue() broadcasts the
//      type-0x04 tx with the auth in authorizationList. Whoever's
//      delegation was just installed gets immediately reverted.
//
// Two execution modes:
//   - 'direct'   — drain't's own EOA broadcasts via viem (Sepolia/dev)
//   - 'oneshot'  — drain't forwards the bundle to 1Shot Permissionless
//                  Relayer (mainnet/production); 1Shot pays gas in stablecoin

import {
  createWalletClient,
  http,
  publicActions,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet, sepolia } from "viem/chains";

const RPC_URLS: Record<number, string> = {
  1: process.env.ETHEREUM_MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com",
  11155111:
    process.env.ETHEREUM_SEPOLIA_RPC_URL ||
    "https://ethereum-sepolia-rpc.publicnode.com",
};

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
};

// viem 2.50.4 SignAuthorizationReturnType shape:
//   { address, chainId, nonce, r, s, v: bigint, yParity?: undefined }
// Note: 'address' (not 'contractAddress') and v: bigint (not yParity).
type ViemAuthorization = {
  address: `0x${string}`;
  chainId: number;
  nonce: number;
  r: `0x${string}`;
  s: `0x${string}`;
  v: bigint;
};

const ONESHOT_BASE =
  process.env.ONESHOT_API_BASE || "https://relayer.1shotapi.com/relayers";
const ONESHOT_KEY = process.env.ONESHOT_API_KEY ?? "";

const AGENT_PK_RAW = process.env.DRAINT_AGENT_PRIVATE_KEY?.trim();
const AGENT_PK: Hex | null = AGENT_PK_RAW
  ? AGENT_PK_RAW.startsWith("0x")
    ? (AGENT_PK_RAW as Hex)
    : (`0x${AGENT_PK_RAW}` as Hex)
  : null;

export const agentAccount = AGENT_PK ? privateKeyToAccount(AGENT_PK) : null;
export const agentReady = agentAccount !== null;
export const oneShotReady = ONESHOT_KEY.length > 0;

// ─── Pre-signed revoke storage (in-memory MVP) ───────────────────────

export interface SerializedAuthorization {
  chainId: number;
  contractAddress: `0x${string}`;
  nonce: string; // bigint serialized
  yParity: number;
  r: Hex;
  s: Hex;
}

export interface StoredRevoke {
  victim: `0x${string}`;
  chainId: number;
  authorization: SerializedAuthorization;
  receivedAt: string;
}

const revokeStore = new Map<string, StoredRevoke>();

function revokeKey(victim: string, chainId: number): string {
  return `${chainId}:${victim.toLowerCase()}`;
}

export function storePreSignedRevoke(entry: StoredRevoke): void {
  revokeStore.set(revokeKey(entry.victim, entry.chainId), entry);
}

export function getPreSignedRevoke(
  victim: string,
  chainId: number,
): StoredRevoke | null {
  return revokeStore.get(revokeKey(victim, chainId)) ?? null;
}

export function listStoredRevokes(): StoredRevoke[] {
  return Array.from(revokeStore.values());
}

// ─── Rescue execution ────────────────────────────────────────────────

export type RescueMode = "direct" | "oneshot";

export interface RescueRequest {
  victim: `0x${string}`;
  chainId: number;
  /** Optional override. Default: 'direct' for Sepolia, 'oneshot' for mainnet. */
  mode?: RescueMode;
}

export interface RescueResult {
  attempted: boolean;
  txHash: `0x${string}` | null;
  mode: RescueMode | null;
  error: string | null;
}

export async function executeRescue(req: RescueRequest): Promise<RescueResult> {
  const stored = getPreSignedRevoke(req.victim, req.chainId);
  if (!stored) {
    return {
      attempted: false,
      txHash: null,
      mode: null,
      error: "No pre-signed revoke held for this address. User must pre-sign via /api/agent/rescue/pre-sign first.",
    };
  }

  const mode: RescueMode =
    req.mode ?? (req.chainId === 1 ? "oneshot" : "direct");

  // Reconstruct the viem-compatible authorization object from storage.
  // Viem's runtime shape uses `address` and `v: bigint` (not contractAddress/yParity).
  const auth: ViemAuthorization = {
    address: stored.authorization.contractAddress,
    chainId: stored.authorization.chainId,
    nonce: Number(stored.authorization.nonce),
    v: BigInt(27 + stored.authorization.yParity),
    r: stored.authorization.r,
    s: stored.authorization.s,
  };

  if (mode === "direct") {
    return executeDirect(req.victim, req.chainId, auth);
  }
  return executeOneShot(req.victim, req.chainId, auth);
}

async function executeDirect(
  victim: `0x${string}`,
  chainId: number,
  auth: ViemAuthorization,
): Promise<RescueResult> {
  if (!agentAccount) {
    return {
      attempted: false,
      txHash: null,
      mode: "direct",
      error: "DRAINT_AGENT_PRIVATE_KEY not configured — direct broadcast requires a funded agent wallet.",
    };
  }

  const chain = CHAINS[chainId];
  const rpc = RPC_URLS[chainId];
  if (!chain || !rpc) {
    return {
      attempted: false,
      txHash: null,
      mode: "direct",
      error: `Unsupported chainId ${chainId}`,
    };
  }

  const client = createWalletClient({
    account: agentAccount,
    chain,
    transport: http(rpc),
  }).extend(publicActions);

  try {
    // viem's sendTransaction signature is over-strict on `kzg` for tx
    // params (EIP-4844 blob field). 7702 SET_CODE doesn't use blobs, but
    // TypeScript demands the property. Cast through unknown to bypass.
    const txHash = await (client.sendTransaction as unknown as (
      params: Record<string, unknown>,
    ) => Promise<`0x${string}`>)({
      authorizationList: [auth],
      to: victim,
      data: "0x",
    });
    return { attempted: true, txHash, mode: "direct", error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      txHash: null,
      mode: "direct",
      error: msg.slice(0, 240),
    };
  }
}

async function executeOneShot(
  victim: `0x${string}`,
  chainId: number,
  auth: ViemAuthorization,
): Promise<RescueResult> {
  if (!oneShotReady) {
    return {
      attempted: false,
      txHash: null,
      mode: "oneshot",
      error: "ONESHOT_API_KEY not configured. Set it in .env and restart backend.",
    };
  }
  if (chainId !== 1) {
    return {
      attempted: false,
      txHash: null,
      mode: "oneshot",
      error: "1Shot Permissionless Relayer is mainnet-only per hackathon requirements.",
    };
  }

  // 1Shot JSON-RPC: relayer_send7710Transaction
  // Body shape per 1Shot docs:
  //   { jsonrpc: '2.0', id: ..., method: 'relayer_send7710Transaction',
  //     params: [{ chainId, to, data, authorizationList, payment: {...} }] }
  // For drain't's revoke rescue, payment is in USDC drawn from the
  // attacker/drain't account.
  try {
    const res = await fetch(ONESHOT_BASE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ONESHOT_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "relayer_send7710Transaction",
        params: [
          {
            chainId,
            to: victim,
            data: "0x",
            authorizationList: [
              {
                chainId: auth.chainId,
                address: auth.address,
                nonce: String(auth.nonce),
                v: String(auth.v),
                r: auth.r,
                s: auth.s,
              },
            ],
            payment: {
              token: "USDC",
              maxAmount: "5000000", // 5 USDC max
            },
          },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      return {
        attempted: true,
        txHash: null,
        mode: "oneshot",
        error: `1Shot HTTP ${res.status}: ${txt.slice(0, 200)}`,
      };
    }

    const body = (await res.json()) as {
      result?: { taskId: string; txHash?: `0x${string}` };
      error?: { message: string };
    };
    if (body.error) {
      return {
        attempted: true,
        txHash: null,
        mode: "oneshot",
        error: `1Shot error: ${body.error.message}`,
      };
    }
    return {
      attempted: true,
      txHash: body.result?.txHash ?? null,
      mode: "oneshot",
      error: null,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      txHash: null,
      mode: "oneshot",
      error: msg.slice(0, 240),
    };
  }
}

