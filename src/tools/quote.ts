import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";
import type { QuoteToolResponse } from "../types/index.js";
import { sanitizeBigInts } from "../utils/sanitize.js";
import { normalizeBigInts } from "./prepare-signatures.js";

const SLUG_TO_CHAIN_ID: Record<string, number> = {
  arb: 42161, base: 8453,  bera: 80094, eth: 1,    poly: 137,
  opt: 10,    bsc: 56,     avax: 43114, gnosis: 100, sonic: 146,
  worldchain: 480, scroll: 534352, lisk: 1135, sei: 1329,
  bob: 60808, hype: 999,   katana: 747474, monad: 143,
  plasma: 9745, uni: 130,  ape: 33139, megaeth: 4326,
};

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

  // Derive sourceChainId: permit2 domain is most reliable; fallback to slug from first inputPositions key
  const firstInputSlug = Object.keys(params.inputPositions)[0]?.split(':')[0];
  const sourceChainId: number =
    (response.permit2Datas as any)?.domain?.chainId ||
    (firstInputSlug ? SLUG_TO_CHAIN_ID[firstInputSlug] : undefined) ||
    42161;

  // Sanitize BigInt hex objects to strings for JSON serialization
  const sanitized = sanitizeBigInts({
    ...response,
    requiresPermit2Signature,
    requiresBridgeSignature,
    sourceChainId,
  }) as QuoteToolResponse;

  // Extract normalized signing payloads for direct surfacing
  if (response.permit2Datas) {
    const permit2Data = normalizeBigInts(response.permit2Datas);
    sanitized.permit2SigningPayload = {
      domain: permit2Data.domain,
      types: permit2Data.types,
      primaryType: permit2Data.primaryType || (permit2Data.types?.PermitBatch ? "PermitBatch" : "PermitSingle"),
      message: permit2Data.values || permit2Data.message,
    };
  }

  const bridgeTypedData = response.destinationBridge?.unsignedTypeV4Digest;
  if (bridgeTypedData) {
    const bridgeData = normalizeBigInts(bridgeTypedData);
    sanitized.bridgeSigningPayload = {
      domain: bridgeData.domain,
      types: bridgeData.types,
      primaryType: bridgeData.primaryType || Object.keys(bridgeData.types)[0],
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
    `Gas Estimate: ${response.gas.amount} (~$${response.gas.usd})`
  );

  if (response.approvals.length > 0) {
    lines.push(
      "",
      `=== Required Approvals (${response.approvals.length}) ===`,
      "Pass the `approvals` array to haiku_execute — in self-contained mode (WALLET_PRIVATE_KEY set) " +
      "they are sent and confirmed on-chain automatically before the swap."
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
