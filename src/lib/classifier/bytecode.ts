// Bytecode fetching via viem.

import {
  createPublicClient,
  http,
  keccak256,
  type Chain,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import type { Address, Hex } from "./types";

const RPC_URLS: Record<number, string> = {
  1:
    process.env.ETHEREUM_MAINNET_RPC_URL ||
    "https://ethereum-rpc.publicnode.com",
  11155111:
    process.env.ETHEREUM_SEPOLIA_RPC_URL ||
    "https://ethereum-sepolia-rpc.publicnode.com",
};

const CHAIN_MAP: Record<number, Chain> = {
  1: mainnet,
  11155111: sepolia,
};

const clientCache = new Map<number, PublicClient>();

function getClient(chainId: number): PublicClient {
  const cached = clientCache.get(chainId);
  if (cached) return cached;

  const chain = CHAIN_MAP[chainId];
  const rpcUrl = RPC_URLS[chainId];
  if (!chain || !rpcUrl) {
    throw new Error(`Unsupported chainId ${chainId}`);
  }

  const client = createPublicClient({ chain, transport: http(rpcUrl) });
  clientCache.set(chainId, client);
  return client;
}

export interface FetchedBytecode {
  bytecode: Hex | null;
  bytecodeHash: Hex | null;
  bytecodeSize: number;
  isEOA: boolean;
  /** True if bytecode is EIP-7702 delegation designator (starts with 0xef0100). */
  is7702Delegated: boolean;
  /** The address the EOA delegates to (if is7702Delegated). */
  delegationTarget: Address | null;
}

/**
 * EIP-7702 delegation designator magic prefix.
 * Bytecode format: 0xef0100 || 20-byte address (total 23 bytes / 46 hex chars).
 * Per EIP-7702 spec: https://eips.ethereum.org/EIPS/eip-7702
 */
const EIP7702_PREFIX = "0xef0100";
const EIP7702_BYTECODE_SIZE = 23; // 3-byte prefix + 20-byte address

function parse7702Delegation(bytecode: Hex):
  | { is7702: true; target: Address }
  | { is7702: false; target: null } {
  if (
    bytecode.length === EIP7702_BYTECODE_SIZE * 2 + 2 &&
    bytecode.toLowerCase().startsWith(EIP7702_PREFIX)
  ) {
    const target = ("0x" + bytecode.slice(8)) as Address;
    return { is7702: true, target };
  }
  return { is7702: false, target: null };
}

/**
 * Fetch contract bytecode via eth_getCode.
 * Returns null bytecode + isEOA=true if address has no code (= EOA).
 */
export async function fetchBytecode(
  chainId: number,
  address: Address,
): Promise<FetchedBytecode> {
  const client = getClient(chainId);
  const code = await client.getCode({ address });

  // viem returns undefined when address has no code (EOA)
  if (!code || code === "0x") {
    return {
      bytecode: null,
      bytecodeHash: null,
      bytecodeSize: 0,
      isEOA: true,
      is7702Delegated: false,
      delegationTarget: null,
    };
  }

  const delegation = parse7702Delegation(code);

  return {
    bytecode: code,
    bytecodeHash: keccak256(code),
    // -2 to exclude "0x" prefix, /2 because each byte is 2 hex chars
    bytecodeSize: (code.length - 2) / 2,
    isEOA: false,
    is7702Delegated: delegation.is7702,
    delegationTarget: delegation.target,
  };
}

/**
 * Fetch contract deployment age via tracing recent blocks.
 * Returns null if can't determine (e.g. mainnet too expensive to scan all blocks).
 * For MVP: best-effort via current block - first tx block (using transaction count proxy).
 */
export async function fetchContractAge(
  chainId: number,
  address: Address,
): Promise<{ ageBlocks: number | null; ageSeconds: number | null }> {
  const client = getClient(chainId);

  try {
    // Get current block
    const currentBlock = await client.getBlockNumber();
    // Check tx count at address — if 0, contract was just deployed
    const txCount = await client.getTransactionCount({ address });

    // For MVP, return rough estimate based on tx activity
    // A real impl would binary-search deployment block
    if (txCount === 0) {
      return { ageBlocks: 0, ageSeconds: 0 };
    }

    // Placeholder: we don't have exact deployment block lookup yet
    // Day 7: improve with Etherscan API or proper indexer
    return { ageBlocks: null, ageSeconds: null };
  } catch {
    return { ageBlocks: null, ageSeconds: null };
  }
}
