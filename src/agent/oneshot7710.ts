// drain't gasless rescue via the 1Shot Permissionless Relayer (EIP-7710).
//
// This is the REAL 1Shot flow (replaces the simplified executeOneShot stub):
//
//   1. relayer_getCapabilities   → targetAddress, feeCollector, payment token
//   2. relayer_getFeeData        → minFee (floor, ~$0.015 on Arbitrum)
//   3. Build a MetaMask Stateless-7702 smart account for the at-risk EOA,
//      sign a 7702 authorization (EOA → delegator impl) and a delegation
//      scoped to an ERC-20 transfer amount, granted to the relayer's
//      targetAddress (so it can redeem fee + work).
//   4. relayer_estimate7710Transaction → exact requiredPaymentAmount + a
//      signed price-lock `context`. (FREE — no broadcast, no USDC spent.)
//   5. relayer_send7710Transaction     → broadcast; 1Shot pays gas, pulls
//      the fee from the EOA in USDC. (Only runs when `send: true`.)
//   6. relayer_getStatus               → poll to confirmation.
//
// The "work" execution is a rescue sweep: move the at-risk token balance to
// a safe recovery address. No ETH ever required — the whole point of 1Shot.

import {
  Implementation,
  ScopeType,
  createDelegation,
  toMetaMaskSmartAccount,
} from "@metamask/smart-accounts-kit";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseUnits,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, mainnet } from "viem/chains";

const RELAYER_BASE =
  process.env.ONESHOT_API_BASE || "https://relayer.1shotapi.com/relayers";

const CHAINS: Record<number, Chain> = {
  1: mainnet,
  42161: arbitrum,
};

const RPC_URLS: Record<number, string> = {
  1: process.env.ETHEREUM_MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com",
  42161:
    process.env.ARBITRUM_RPC_URL || "https://arbitrum-one-rpc.publicnode.com",
};

// ─── JSON-RPC helper ─────────────────────────────────────────────────

async function relayerRpc<T = unknown>(
  method: string,
  params: unknown,
): Promise<T> {
  const res = await fetch(RELAYER_BASE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = (await res.json()) as {
    result?: T;
    error?: { code?: number; message?: string };
  };
  if (body.error) {
    throw new Error(
      `${method} failed (${body.error.code ?? "?"}): ${body.error.message ?? "unknown"}`,
    );
  }
  return body.result as T;
}

// ─── Types ───────────────────────────────────────────────────────────

interface Capabilities {
  feeCollector: Address;
  targetAddress: Address;
  tokens: { address: Address; symbol: string; decimals: string }[];
}

interface FeeData {
  minFee: string;
  rate: number;
  gasPrice: string;
  feeCollector: Address;
  targetAddress: Address;
  context: string;
  token: { address: Address; symbol: string; decimals: number };
}

interface EstimateResult {
  success: boolean;
  error?: string;
  requiredPaymentAmount?: string;
  gasUsed?: unknown;
  context?: string;
}

export interface GaslessRescueParams {
  chainId: number;
  /** Private key of the at-risk EOA (the demo wallet). Signs auth + delegation. */
  victimPrivateKey: Hex;
  /** Token to rescue (defaults to the chain's native USDC). */
  tokenAddress?: Address;
  /** Amount of token (atoms) to sweep to safety. If omitted, sweeps full balance minus fee. */
  sweepAmount?: bigint;
  /** Where rescued funds go. */
  recoveryAddress: Address;
  /** When false (default), only estimate — never broadcast, never spend. */
  send?: boolean;
}

export interface GaslessRescueResult {
  dryRun: boolean;
  chainId: number;
  victim: Address;
  feeCollector: Address;
  targetAddress: Address;
  token: Address;
  minFee: string;
  requiredPaymentAmount: string | null;
  sweepAmount: string;
  gasUsed: string | null;
  taskId: string | null;
  error: string | null;
}

const USDC_BY_CHAIN: Record<number, Address> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

/**
 * Run the full 1Shot EIP-7710 gasless-rescue flow.
 * Always estimates first; only broadcasts when `params.send === true`.
 */
export async function oneShotGaslessRescue(
  params: GaslessRescueParams,
): Promise<GaslessRescueResult> {
  const { chainId, victimPrivateKey, recoveryAddress } = params;
  const chain = CHAINS[chainId];
  const rpcUrl = RPC_URLS[chainId];
  if (!chain || !rpcUrl) throw new Error(`Unsupported chainId ${chainId}`);

  const token = params.tokenAddress ?? USDC_BY_CHAIN[chainId];
  if (!token) throw new Error(`No default token for chainId ${chainId}`);

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const signer = privateKeyToAccount(victimPrivateKey);
  const victim = signer.address;

  // 1. Capabilities — relayer redemption address + fee collector + token.
  const caps = await relayerRpc<Record<string, Capabilities>>(
    "relayer_getCapabilities",
    [String(chainId)],
  );
  const cap = caps[String(chainId)];
  if (!cap) throw new Error(`1Shot has no capabilities for chain ${chainId}`);
  const { targetAddress, feeCollector } = cap;

  // 2. Fee floor.
  const fee = await relayerRpc<FeeData>("relayer_getFeeData", {
    chainId: String(chainId),
    token,
  });
  // relayer_getFeeData returns minFee as a DECIMAL token string (e.g. "0.0149"),
  // not atoms — convert with the token's decimals.
  const tokenDecimals = Number(fee.token?.decimals ?? 6);
  const minFee = parseUnits(fee.minFee, tokenDecimals);

  // Current token balance to know how much we can sweep.
  const balance = (await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [victim],
  })) as bigint;

  // Reserve the fee, sweep the rest (or the caller-specified amount).
  const sweepAmount =
    params.sweepAmount ?? (balance > minFee ? balance - minFee : 0n);
  if (sweepAmount <= 0n) {
    throw new Error(
      `Token balance ${balance} too low to cover fee ${minFee} + sweep.`,
    );
  }
  // Delegation must permit fee + sweep to be moved.
  const maxAmount = minFee + sweepAmount;

  // 3. Build smart account + delegation scoped to the ERC-20 transfer.
  const account = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Stateless7702,
    address: victim,
    signer: { account: signer },
  });

  const delegation = createDelegation({
    to: targetAddress,
    from: account.address,
    environment: account.environment,
    scope: {
      type: ScopeType.Erc20TransferAmount,
      tokenAddress: token,
      maxAmount,
    },
  });
  const signature = await account.signDelegation({ delegation });
  const signedDelegation = { ...delegation, signature };
  // The relayer wants the delegation chain as Delegation7710 OBJECTS, not encoded hex.
  const permissionContext = [signedDelegation];

  // 3b. EIP-7702 authorization: upgrade EOA → stateless delegator impl.
  const impl7702 = Object.entries(account.environment.implementations).find(
    ([k]) => /7702/i.test(k),
  )?.[1];
  if (!impl7702) {
    throw new Error("No EIP-7702 stateless delegator impl in environment.");
  }
  const nonce = await publicClient.getTransactionCount({ address: victim });
  const authorization = await signer.signAuthorization({
    chainId,
    address: impl7702,
    nonce,
  });
  const authorizationList = [
    {
      chainId,
      address: impl7702,
      nonce,
      r: authorization.r,
      s: authorization.s,
      yParity: authorization.yParity ?? 0,
    },
  ];

  // Executions: pay the fee, then sweep to safety.
  // Execution7710 uses `target` (not `to`).
  const feeExecution = {
    target: token,
    value: "0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [feeCollector, minFee],
    }),
  };
  const sweepExecution = {
    target: token,
    value: "0",
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recoveryAddress, sweepAmount],
    }),
  };

  const bundle = {
    chainId: String(chainId),
    transactions: [
      { permissionContext, executions: [feeExecution, sweepExecution] },
    ],
    authorizationList,
  };

  if (process.env.DRAINT_DEBUG) {
    console.error("─ DEBUG signedDelegation ─");
    console.error(JSON.stringify(signedDelegation, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    console.error("─ DEBUG authorization (raw) ─");
    console.error(JSON.stringify(authorization, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
    console.error("─ DEBUG bundle ─");
    console.error(JSON.stringify(bundle, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  }

  // 4. Estimate (free — validates bundle, returns price-lock context).
  const estimate = await relayerRpc<EstimateResult>(
    "relayer_estimate7710Transaction",
    bundle,
  );
  if (!estimate.success) {
    throw new Error(`estimate rejected bundle: ${estimate.error ?? "unknown"}`);
  }

  const base: GaslessRescueResult = {
    dryRun: !params.send,
    chainId,
    victim,
    feeCollector,
    targetAddress,
    token,
    minFee: minFee.toString(),
    requiredPaymentAmount: estimate.requiredPaymentAmount ?? null,
    sweepAmount: sweepAmount.toString(),
    gasUsed:
      estimate.gasUsed == null
        ? null
        : typeof estimate.gasUsed === "string"
          ? estimate.gasUsed
          : JSON.stringify(estimate.gasUsed),
    taskId: null,
    error: null,
  };

  if (!params.send) return base; // DRY-RUN: stop before spending.

  // 5. Broadcast with the signed price-lock context.
  const taskId = await relayerRpc<string>("relayer_send7710Transaction", {
    ...bundle,
    context: estimate.context,
  });
  return { ...base, taskId };
}

export async function oneShotStatus(taskId: string) {
  return relayerRpc("relayer_getStatus", { id: taskId, logs: true });
}
