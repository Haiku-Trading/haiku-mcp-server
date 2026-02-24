import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";

/**
 * Valid token categories for filtering
 */
export const tokenCategories = [
  "token",
  "collateral",
  "varDebt",
  "vault",
  "weightedLiquidity",
  "concentratedLiquidity",
] as const;

export type TokenCategory = (typeof tokenCategories)[number];

/**
 * Schema for haiku_get_tokens tool parameters
 */
export const getTokensSchema = z.object({
  chainId: z
    .number()
    .optional()
    .describe(
      "Filter tokens by chain ID (e.g., 42161 for Arbitrum, 8453 for Base, 1 for Ethereum)"
    ),
  category: z
    .enum(tokenCategories)
    .optional()
    .describe(
      "Filter by token category: 'token' (vanilla tokens), 'collateral' (Aave aTokens), " +
        "'varDebt' (Aave debt tokens), 'vault' (Yearn/Morpho vaults), " +
        "'weightedLiquidity' (Balancer LP), 'concentratedLiquidity' (Uniswap V3 LP). " +
        "Omit to return all categories."
    ),
  protocol: z
    .string()
    .optional()
    .describe(
      "Filter by protocol name (case-insensitive). Use a single value (e.g. 'AAVE_V3') or " +
        "comma-separated list (e.g. 'MORPHO,CURVE') for multi-protocol filtering. " +
        "Common values: AAVE_V3, AAVE_V2, MORPHO, YEARN, BALANCER_V2, UNISWAP_V3, COMPOUND, EULER, PENDLE, CURVE."
    ),
  symbol: z
    .string()
    .optional()
    .describe(
      "Search by symbol or name (case-insensitive substring match). " +
        "Single value (e.g. 'USDC') or comma-separated list (e.g. 'USDC,USDT'). " +
        "Matches any token whose symbol or name contains the search term."
    ),
});

export type GetTokensParams = z.infer<typeof getTokensSchema>;

/**
 * Schema for haiku_get_balances tool parameters
 */
export const getBalancesSchema = z.object({
  walletAddress: z
    .string()
    .describe("Wallet address (0x...) or ENS name to get token balances for"),
});

export type GetBalancesParams = z.infer<typeof getBalancesSchema>;

/**
 * Handle haiku_get_tokens tool call
 */
export async function handleGetTokens(
  client: HaikuClient,
  params: GetTokensParams
) {
  const response = await client.getTokenList({
    ...(params.chainId !== undefined && { chainId: params.chainId }),
    ...(params.protocol !== undefined && { protocol: params.protocol }),
    ...(params.symbol !== undefined && { symbol: params.symbol }),
  });
  const { tokenList } = response;

  // Map category parameter to token list array key
  const categoryMap: Record<TokenCategory, typeof tokenList.tokens> = {
    token: tokenList.tokens || [],
    collateral: tokenList.collateralTokens || [],
    varDebt: tokenList.varDebtTokens || [],
    vault: tokenList.vaultTokens || [],
    weightedLiquidity: tokenList.weightedLiquidityTokens || [],
    concentratedLiquidity: tokenList.concentratedLiquidityTokens || [],
  };

  // Filter by category or merge all
  const tokens = params.category
    ? categoryMap[params.category]
    : Object.values(categoryMap).flat();

  return {
    tokenCategories: response.tokenCategories,
    tokenCount: tokens.length,
    tokens: tokens.map((token) => ({
      // Core fields
      iid: token.iid,
      symbol: token.symbol,
      name: token.name,
      chainId: token.chainId,
      decimals: token.decimals,
      priceUSD: token.priceUSD,
      category: token.tokenCategory,

      // DeFi fields (conditionally included)
      ...(token.protocol && { protocol: token.protocol }),
      ...(token.underlying_iid && { underlying_iid: token.underlying_iid }),
      ...(token.underlying_iids && { underlying_iids: token.underlying_iids }),

      // Collateral fields
      ...(token.max_ltv !== undefined && { max_ltv: token.max_ltv }),
      ...(token.liquidation_threshold !== undefined && {
        liquidation_threshold: token.liquidation_threshold,
      }),
      ...(token.liquidation_penalty !== undefined && {
        liquidation_penalty: token.liquidation_penalty,
      }),

      // Debt fields
      ...(token.reserve_factor !== undefined && {
        reserve_factor: token.reserve_factor,
      }),

      // Yield fields
      ...(token.apy && { apy: token.apy }),
      ...(token.minApy !== undefined && { minApy: token.minApy }),
      ...(token.maxApy !== undefined && { maxApy: token.maxApy }),

      // LP fields
      ...(token.weights && { weights: token.weights }),
      ...(token.feeTier !== undefined && { feeTier: token.feeTier }),
      ...(token.poolId && { poolId: token.poolId }),

      // TVL from metadata
      ...(token.metadata?.tvl !== undefined && { tvl: token.metadata.tvl }),
    })),
  };
}

/**
 * Handle haiku_get_balances tool call
 */
export async function handleGetBalances(
  client: HaikuClient,
  params: GetBalancesParams
) {
  const response = await client.getTokenBalances(params.walletAddress);

  // Calculate total USD value
  let totalValueUSD = 0;
  const balancesWithUSD: Array<{
    token: string;
    balance: string;
    priceUSD: string;
    valueUSD: string;
  }> = [];

  for (const [token, balance] of Object.entries(response.wallet_positions)) {
    const price = response.prices[token];
    if (price && parseFloat(balance) > 0) {
      const valueUSD = parseFloat(balance) * parseFloat(price);
      totalValueUSD += valueUSD;
      balancesWithUSD.push({
        token,
        balance,
        priceUSD: price,
        valueUSD: valueUSD.toFixed(2),
      });
    }
  }

  // Sort by USD value descending
  balancesWithUSD.sort(
    (a, b) => parseFloat(b.valueUSD) - parseFloat(a.valueUSD)
  );

  return {
    walletAddress: params.walletAddress,
    totalValueUSD: totalValueUSD.toFixed(2),
    balances: balancesWithUSD,
    categorizedPositions: response.categorised_wallet_positions,
  };
}
