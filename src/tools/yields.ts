import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";
import type { Token } from "../types/index.js";

export const discoverYieldsSchema = z.object({
  chainId: z
    .number()
    .optional()
    .describe(
      "Filter by chain ID. Common chains: 42161 (Arbitrum), 8453 (Base), 1 (Ethereum), 137 (Polygon), 10 (Optimism), 56 (BNB Chain)"
    ),
  category: z
    .enum(["lending", "vault", "lp", "all"])
    .optional()
    .default("all")
    .describe(
      "lending=Aave collateral tokens, vault=Yearn/Morpho vaults, lp=Balancer/Uniswap LP positions, all=every yield-bearing category"
    ),
  minApy: z
    .number()
    .optional()
    .describe("Minimum APY filter as a percentage, e.g. 5 means ≥5% APY"),
  minTvl: z
    .number()
    .optional()
    .describe("Minimum TVL filter in USD, e.g. 1000000 means ≥$1M TVL. Useful for filtering to established mainstream vaults."),
  sortBy: z
    .enum(["apy", "tvl"])
    .optional()
    .default("apy")
    .describe("Sort results by APY (default) or TVL, descending"),
  limit: z
    .number()
    .optional()
    .default(20)
    .describe("Maximum number of results to return (default 20)"),
});

export type DiscoverYieldsParams = z.infer<typeof discoverYieldsSchema>;

export interface YieldEntry {
  iid: string;
  symbol: string;
  name: string;
  protocol?: string;
  chainId: number;
  category: string;
  apy: number;
  tvl?: number;
  // Lending-specific (Aave collateral)
  max_ltv?: number;
  liquidation_threshold?: number;
  underlying_iid?: string;
  // LP-specific
  underlying_iids?: string[];
  feeTier?: number;
  poolId?: string;
  // Plain-English summary line
  summary: string;
}

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BNB Chain",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
  43114: "Avalanche",
  80084: "Berachain",
  146: "Sonic",
  252: "Fraxtal",
  999: "Hyperliquid",
};

const PROTOCOL_LABELS: Record<string, string> = {
  AAVE_V3: "Aave V3",
  AAVE_V2: "Aave V2",
  MORPHO: "Morpho",
  YEARN: "Yearn",
  BALANCER_V2: "Balancer V2",
  UNISWAP_V3: "Uniswap V3",
  COMPOUND: "Compound",
  EULER: "Euler",
  PENDLE: "Pendle",
};

/**
 * Extract effective APY as a percentage number from a token.
 * Precedence: apy → minApy → maxApy. minApy is preferred as the conservative
 * realistic yield estimate. Number() is used defensively for legacy cache hits.
 */
export function getEffectiveApy(token: Token): number {
  if (token.apy != null) {
    const v = Number(token.apy);
    if (!isNaN(v)) return v;
  }
  if (token.minApy != null) {
    const v = Number(token.minApy);
    if (!isNaN(v)) return v;
  }
  if (token.maxApy != null) {
    const v = Number(token.maxApy);
    if (!isNaN(v)) return v;
  }
  return 0;
}

/**
 * Extract TVL as a number from token metadata.
 */
export function getTvl(token: Token): number {
  if (token.metadata?.tvl === undefined) return 0;
  const raw = token.metadata.tvl;
  return typeof raw === "number" ? raw : parseFloat(raw as string) || 0;
}

function formatTvl(tvl: number): string {
  if (tvl >= 1e9) return `$${(tvl / 1e9).toFixed(1)}B TVL`;
  if (tvl >= 1e6) return `$${(tvl / 1e6).toFixed(0)}M TVL`;
  if (tvl >= 1e3) return `$${(tvl / 1e3).toFixed(0)}K TVL`;
  if (tvl > 0) return `$${tvl.toFixed(0)} TVL`;
  return "";
}

function buildSummary(
  symbol: string,
  protocol: string | undefined,
  chainId: number,
  apy: number,
  tvl: number | undefined
): string {
  const chain = CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
  const protocolLabel = protocol
    ? (PROTOCOL_LABELS[protocol] ?? protocol) + " "
    : "";
  const tvlStr = tvl ? `, ${formatTvl(tvl)}` : "";
  return `${protocolLabel}${symbol} on ${chain}: ${apy.toFixed(2)}% APY${tvlStr}`;
}

/**
 * Handle haiku_discover_yields tool call.
 * Delegates filtering, sorting, and limiting to the backend via getTokenList.
 */
export async function handleDiscoverYields(
  client: HaikuClient,
  params: DiscoverYieldsParams
) {
  const categoryMap: Record<string, string[]> = {
    lending: ["collateral"],
    vault: ["vault"],
    lp: ["weightedLiquidity", "concentratedLiquidity"],
    all: ["collateral", "vault", "weightedLiquidity", "concentratedLiquidity"],
  };

  const category = params.category ?? "all";
  const backendCategories = categoryMap[category];

  const response = await client.getTokenList({
    chainId: params.chainId,
    category: backendCategories,
    sortBy: params.sortBy ?? "apy",
    minApy: params.minApy,
    minTvl: params.minTvl,
    limit: params.limit ?? 20,
  });

  const { tokenList } = response;

  // Collect tokens with their MCP category label.
  // Note: the backend sorts globally then redistributes into category arrays, so
  // iterating category-by-category loses the cross-category order. We re-sort below.
  const tokensToProcess: Array<{ token: Token; cat: string }> = [];

  if (category === "lending" || category === "all") {
    for (const t of tokenList.collateralTokens ?? []) {
      tokensToProcess.push({ token: t, cat: "lending" });
    }
  }
  if (category === "vault" || category === "all") {
    for (const t of tokenList.vaultTokens ?? []) {
      tokensToProcess.push({ token: t, cat: "vault" });
    }
  }
  if (category === "lp" || category === "all") {
    for (const t of tokenList.weightedLiquidityTokens ?? []) {
      tokensToProcess.push({ token: t, cat: "lp" });
    }
    for (const t of tokenList.concentratedLiquidityTokens ?? []) {
      tokensToProcess.push({ token: t, cat: "lp" });
    }
  }

  // Format tokens into YieldEntry shape
  const entries: YieldEntry[] = tokensToProcess.map(({ token, cat }): YieldEntry => {
    const apy = getEffectiveApy(token);
    const tvlVal = getTvl(token);
    return {
      iid: token.iid,
      symbol: token.symbol,
      name: token.name,
      ...(token.protocol && { protocol: token.protocol }),
      chainId: token.chainId,
      category: cat,
      apy,
      ...(tvlVal > 0 && { tvl: tvlVal }),
      // Lending-specific
      ...(token.max_ltv !== undefined && { max_ltv: token.max_ltv }),
      ...(token.liquidation_threshold !== undefined && {
        liquidation_threshold: token.liquidation_threshold,
      }),
      ...(token.underlying_iid && { underlying_iid: token.underlying_iid }),
      // LP-specific
      ...(token.underlying_iids && { underlying_iids: token.underlying_iids }),
      ...(token.feeTier !== undefined && { feeTier: token.feeTier }),
      ...(token.poolId && { poolId: token.poolId }),
      summary: buildSummary(token.symbol, token.protocol, token.chainId, apy, tvlVal > 0 ? tvlVal : undefined),
    };
  });

  // Re-sort after merging — the backend redistributes sorted tokens back into
  // separate category arrays, so concatenating them category-by-category loses
  // the cross-category order.
  const sortBy = params.sortBy ?? "apy";
  entries.sort((a, b) =>
    sortBy === "tvl" ? (b.tvl ?? 0) - (a.tvl ?? 0) : b.apy - a.apy
  );

  return {
    total: entries.length,
    shown: entries.length,
    sortedBy: sortBy,
    filters: {
      chainId: params.chainId,
      category,
      minApy: params.minApy,
    },
    yields: entries,
  };
}
