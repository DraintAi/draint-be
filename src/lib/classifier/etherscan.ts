// Etherscan API integration for verification status + contract metadata.
//
// V2 unified API: https://docs.etherscan.io/v2/etherscan-v2

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

export interface SourceMeta {
  isVerified: boolean;
  contractName: string | null;
}

/**
 * Check if a contract is verified on Etherscan, and get its name.
 * Returns { isVerified: false, contractName: null } on any error (best-effort).
 */
export async function fetchSourceMeta(
  chainId: number,
  address: string,
): Promise<SourceMeta> {
  if (!ETHERSCAN_API_KEY) {
    return { isVerified: false, contractName: null };
  }

  const url = new URL(ETHERSCAN_V2_BASE);
  url.searchParams.set("chainid", String(chainId));
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getsourcecode");
  url.searchParams.set("address", address);
  url.searchParams.set("apikey", ETHERSCAN_API_KEY);

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { isVerified: false, contractName: null };
    }
    const data = (await res.json()) as {
      status: string;
      result?: Array<{ SourceCode?: string; ContractName?: string }>;
    };
    const entry = data.result?.[0];
    if (!entry) return { isVerified: false, contractName: null };

    const isVerified = !!entry.SourceCode && entry.SourceCode.length > 0;
    const contractName =
      entry.ContractName && entry.ContractName.length > 0
        ? entry.ContractName
        : null;

    return { isVerified, contractName };
  } catch {
    return { isVerified: false, contractName: null };
  }
}
