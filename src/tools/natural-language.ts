import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";
import type { QuoteIntent } from "../types/index.js";

/**
 * Schema for haiku_natural_language_intent tool parameters
 */
export const naturalLanguageIntentSchema = z.object({
  prompt: z
    .string()
    .describe(
      "Natural language instruction for the trade. Examples: \"swap all my WETH for USDC\", \"convert half my ETH to stablecoins split between USDC and USDT\", \"rebalance to 60% ETH and 40% USDC\""
    ),
  walletAddress: z
    .string()
    .describe(
      "Wallet address to check balances for context. Required so the API can interpret relative amounts like 'all my ETH' or 'half of my USDC'."
    ),
});

export type NaturalLanguageIntentParams = z.infer<typeof naturalLanguageIntentSchema>;

export interface NaturalLanguageIntentResponse {
  intent: QuoteIntent;
  walletContext: {
    address: string;
    relevantBalances: Array<{
      token: string;
      balance: string;
      priceUSD: string;
    }>;
  };
}

/**
 * Handle haiku_natural_language_intent tool call
 *
 * This tool automatically:
 * 1. Fetches wallet balances from /tokenBalances
 * 2. Passes balances to /buildIntentNaturalLanguage
 * 3. Returns the structured intent ready for haiku_get_quote
 */
export async function handleNaturalLanguageIntent(
  client: HaikuClient,
  params: NaturalLanguageIntentParams
): Promise<NaturalLanguageIntentResponse> {
  // Step 1: Fetch wallet balances for context
  const balances = await client.getTokenBalances(params.walletAddress);

  // Step 2: Build intent from natural language
  const response = await client.buildNaturalLanguageIntent({
    text_prompt: params.prompt,
    wallet_positions: balances.wallet_positions,
    prices: balances.prices,
  });

  // Step 3: Extract relevant balances (tokens mentioned in the intent)
  const relevantTokens = new Set([
    ...Object.keys(response.intent.inputPositions),
    ...Object.keys(response.intent.targetWeights),
  ]);

  const relevantBalances = Array.from(relevantTokens)
    .filter((token) => balances.wallet_positions[token])
    .map((token) => ({
      token,
      balance: balances.wallet_positions[token],
      priceUSD: balances.prices[token] || "0",
    }));

  return {
    intent: response.intent,
    walletContext: {
      address: params.walletAddress,
      relevantBalances,
    },
  };
}

/**
 * Format natural language intent response for human-readable output
 */
export function formatNaturalLanguageIntentResponse(
  response: NaturalLanguageIntentResponse
): string {
  const lines: string[] = [
    "=== Parsed Intent ===",
    "",
    "Input Positions (tokens to spend):",
  ];

  for (const [token, amount] of Object.entries(response.intent.inputPositions)) {
    lines.push(`  ${token}: ${amount}`);
  }

  lines.push("", "Target Weights (output allocation):");
  for (const [token, weight] of Object.entries(response.intent.targetWeights)) {
    lines.push(`  ${token}: ${(weight * 100).toFixed(1)}%`);
  }

  if (response.intent.slippage) {
    lines.push("", `Slippage: ${(response.intent.slippage * 100).toFixed(2)}%`);
  }

  if (response.intent.receiver) {
    lines.push(`Receiver: ${response.intent.receiver}`);
  }

  lines.push("", "=== Wallet Context ===", `Address: ${response.walletContext.address}`);

  if (response.walletContext.relevantBalances.length > 0) {
    lines.push("", "Relevant balances:");
    for (const balance of response.walletContext.relevantBalances) {
      const valueUSD = (
        parseFloat(balance.balance) * parseFloat(balance.priceUSD)
      ).toFixed(2);
      lines.push(`  ${balance.token}: ${balance.balance} (~$${valueUSD})`);
    }
  }

  lines.push(
    "",
    "Use this intent with haiku_get_quote to get a quote for the trade."
  );

  return lines.join("\n");
}
