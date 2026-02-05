import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";

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
  const response = await client.getTokenList(params.chainId);
  const tokens = response.tokenList.tokens;

  return {
    tokenCategories: response.tokenCategories,
    tokenCount: tokens.length,
    tokens: tokens.map((token) => ({
      iid: token.iid,
      symbol: token.symbol,
      name: token.name,
      chainId: token.chainId,
      decimals: token.decimals,
      priceUSD: token.priceUSD,
      category: token.tokenCategory,
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
