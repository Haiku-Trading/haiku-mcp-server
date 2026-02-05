import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";
import type { QuoteToolResponse } from "../types/index.js";

/**
 * Schema for haiku_get_quote tool parameters
 */
export const getQuoteSchema = z.object({
  inputPositions: z
    .record(z.string(), z.string())
    .describe(
      "Map of token IID to amount to spend. Example: { \"arb:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1\": \"1.5\" } for 1.5 WETH on Arbitrum"
    ),
  targetWeights: z
    .record(z.string(), z.number())
    .describe(
      "Map of output token IID to weight (must sum to 1). Example: { \"arb:0xaf88d065e77c8cC2239327C5EDb3A432268e5831\": 0.5, \"arb:0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9\": 0.5 } for 50% USDC, 50% USDT"
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

export type GetQuoteParams = z.infer<typeof getQuoteSchema>;

/**
 * Handle haiku_get_quote tool call
 */
export async function handleGetQuote(
  client: HaikuClient,
  params: GetQuoteParams
): Promise<QuoteToolResponse> {
  const response = await client.getQuote({
    inputPositions: params.inputPositions,
    targetWeights: params.targetWeights,
    slippage: params.slippage,
    receiver: params.receiver,
  });

  const requiresPermit2Signature = !!response.permit2Datas;
  const requiresBridgeSignature = response.isComplexBridge && !!response.destinationBridge;

  return {
    ...response,
    requiresPermit2Signature,
    requiresBridgeSignature,
  };
}

/**
 * Format quote response for human-readable output
 */
export function formatQuoteResponse(response: QuoteToolResponse): string {
  const lines: string[] = [
    `Quote ID: ${response.quoteId}`,
    "",
    "=== Input (What you're spending) ===",
  ];

  for (const fund of response.funds) {
    lines.push(`  ${fund.token}: ${fund.amount}`);
  }

  lines.push("", "=== Output (What you'll receive) ===");
  for (const balance of response.balances) {
    lines.push(`  ${balance.token}: ${balance.amount}`);
  }

  lines.push("", "=== Fees ===");
  for (const fee of response.fees) {
    lines.push(`  ${fee.token}: ${fee.amount}`);
  }

  lines.push(
    "",
    `Gas Estimate: ${response.gas.amount} (~$${response.gas.amountUSD})`
  );

  if (response.approvals.length > 0) {
    lines.push(
      "",
      `=== Required Approvals (${response.approvals.length}) ===`,
      "You must execute these ERC-20 approval transactions first."
    );
  }

  if (response.requiresPermit2Signature) {
    lines.push(
      "",
      "=== Permit2 Signature Required ===",
      "Sign the permit2Datas EIP-712 typed data and pass to haiku_solve."
    );
  }

  if (response.requiresBridgeSignature) {
    lines.push(
      "",
      "=== Bridge Signature Required ===",
      "Sign the destinationBridge EIP-712 typed data and pass to haiku_solve."
    );
  }

  return lines.join("\n");
}
