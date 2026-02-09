import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";
import type { QuoteToolResponse } from "../types/index.js";
import { sanitizeBigInts } from "../utils/sanitize.js";
import { normalizeBigInts } from "./prepare-signatures.js";

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

  // Sanitize BigInt hex objects to strings for JSON serialization
  const sanitized = sanitizeBigInts({
    ...response,
    requiresPermit2Signature,
    requiresBridgeSignature,
  }) as QuoteToolResponse;

  // Extract normalized signing payloads from intent for direct surfacing
  const intent = response.intent;
  if (intent?.permit2Datas?.[0]) {
    const permit2Data = normalizeBigInts(intent.permit2Datas[0]);
    sanitized.permit2SigningPayload = {
      domain: permit2Data.domain,
      types: permit2Data.types,
      primaryType: permit2Data.primaryType,
      message: permit2Data.values || permit2Data.message,
    };
  }
  if (intent?.typedData) {
    const bridgeData = normalizeBigInts(intent.typedData);
    sanitized.bridgeSigningPayload = {
      domain: bridgeData.domain,
      types: bridgeData.types,
      primaryType: bridgeData.primaryType,
      message: bridgeData.message || bridgeData.values,
    };
  }

  return sanitized;
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
      "=== Permit2 Signature Required ==="
    );
    if (response.permit2SigningPayload) {
      lines.push(
        "Sign this EIP-712 typed data using signTypedData, then pass the resulting signature as `permit2Signature` to haiku_solve.",
        "",
        JSON.stringify(response.permit2SigningPayload, null, 2)
      );
    } else {
      lines.push(
        "Use haiku_prepare_signatures with the full quote response to extract the signing payload."
      );
    }
  }

  if (response.requiresBridgeSignature) {
    lines.push(
      "",
      "=== Bridge Signature Required ==="
    );
    if (response.bridgeSigningPayload) {
      lines.push(
        "Sign this EIP-712 typed data using signTypedData, then pass the resulting signature as `userSignature` to haiku_solve.",
        "",
        JSON.stringify(response.bridgeSigningPayload, null, 2)
      );
    } else {
      lines.push(
        "Use haiku_prepare_signatures with the full quote response to extract the signing payload."
      );
    }
  }

  return lines.join("\n");
}
