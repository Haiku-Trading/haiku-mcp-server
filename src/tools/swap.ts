import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";
import type { SwapToolResponse } from "../types/index.js";

/**
 * Schema for haiku_execute_swap tool parameters
 */
export const executeSwapSchema = z.object({
  inputToken: z
    .string()
    .describe(
      "Token IID to spend. Format: chainSlug:tokenAddress (e.g., \"arb:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1\" for WETH on Arbitrum)"
    ),
  inputAmount: z
    .string()
    .describe("Amount of input token to spend (e.g., \"1.5\" for 1.5 tokens)"),
  outputToken: z
    .string()
    .describe(
      "Token IID to receive. Format: chainSlug:tokenAddress (e.g., \"arb:0xaf88d065e77c8cC2239327C5EDb3A432268e5831\" for USDC on Arbitrum)"
    ),
  slippage: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.003)
    .describe("Maximum allowed slippage as a decimal (e.g., 0.003 for 0.3%). Default: 0.003"),
  receiver: z
    .string()
    .optional()
    .describe("Wallet address to receive the output tokens. Defaults to sender."),
});

export type ExecuteSwapParams = z.infer<typeof executeSwapSchema>;

/**
 * Handle haiku_execute_swap tool call
 *
 * This is a convenience tool that combines quote + solve for simple swaps.
 * If Permit2 signature is required, it returns the quote with permit2Datas
 * and instructs the agent to use the lower-level tools instead.
 */
export async function handleExecuteSwap(
  client: HaikuClient,
  params: ExecuteSwapParams
): Promise<SwapToolResponse> {
  // Build simplified intent for single-token swap
  const intent = {
    inputPositions: {
      [params.inputToken]: params.inputAmount,
    },
    targetWeights: {
      [params.outputToken]: 1,
    },
    slippage: params.slippage,
    receiver: params.receiver,
  };

  // Step 1: Get quote
  const quote = await client.getQuote(intent);

  // Step 2: Check if Permit2 signature is required
  if (quote.permit2Datas) {
    return {
      success: false,
      requiresPermit2Signature: true,
      quoteId: quote.quoteId,
      permit2Datas: quote.permit2Datas,
      quote,
      message:
        "This swap requires a Permit2 signature. Please:\n" +
        "1. Sign the permit2Datas EIP-712 typed data\n" +
        "2. Call haiku_solve with quoteId and permit2Signature\n" +
        "3. Sign and broadcast the resulting transaction",
    };
  }

  // Step 3: If no Permit2 needed, proceed to solve
  const transaction = await client.solve({
    quoteId: quote.quoteId,
  });

  return {
    success: true,
    requiresPermit2Signature: false,
    quoteId: quote.quoteId,
    quote,
    transaction,
  };
}

/**
 * Format swap response for human-readable output
 */
export function formatSwapResponse(response: SwapToolResponse): string {
  const lines: string[] = [`Quote ID: ${response.quoteId}`, ""];

  // Quote summary
  lines.push("=== Quote Summary ===");
  for (const fund of response.quote.funds) {
    lines.push(`Spending: ${fund.amount} ${fund.token}`);
  }
  for (const balance of response.quote.balances) {
    lines.push(`Receiving: ${balance.amount} ${balance.token}`);
  }
  lines.push(`Gas: ~$${response.quote.gas.amountUSD}`);

  if (!response.success) {
    // Permit2 required
    lines.push(
      "",
      "=== Action Required: Permit2 Signature ===",
      response.message,
      "",
      "permit2Datas (sign this):",
      JSON.stringify(response.permit2Datas, null, 2)
    );
  } else {
    // Transaction ready
    lines.push(
      "",
      "=== Unsigned Transaction Ready ===",
      "",
      `To: ${response.transaction.to}`,
      `Value: ${response.transaction.value}`,
      `Data: ${response.transaction.data.slice(0, 66)}...`,
      "",
      "Sign this transaction with your wallet and broadcast to execute the swap."
    );
  }

  return lines.join("\n");
}
