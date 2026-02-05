import { z } from "zod";

/**
 * Schema for haiku_prepare_signatures tool parameters
 */
export const prepareSignaturesSchema = z.object({
  quoteResponse: z
    .any()
    .describe("The full quote response from haiku_get_quote"),
});

type PrepareSignaturesParams = z.infer<typeof prepareSignaturesSchema>;

/**
 * Standardized EIP-712 signing payload
 * Compatible with any wallet that supports signTypedData
 */
export interface SigningPayload {
  /** EIP-712 domain separator */
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
  };
  /** EIP-712 type definitions */
  types: Record<string, Array<{ name: string; type: string }>>;
  /** The primary type to sign */
  primaryType: string;
  /** The message/values to sign */
  message: Record<string, any>;
}

export interface PrepareSignaturesResult {
  /** Quote ID to pass to haiku_solve */
  quoteId: string;

  /** Source chain for the transaction */
  sourceChainId: number;

  /** Permit2 signature required? */
  requiresPermit2: boolean;

  /** Permit2 EIP-712 payload (if required) */
  permit2?: SigningPayload;

  /** Bridge intent signature required? (cross-chain) */
  requiresBridgeSignature: boolean;

  /** Bridge intent EIP-712 payload (if required) */
  bridgeIntent?: SigningPayload;

  /** Instructions for the wallet MCP */
  instructions: string;

  /** Raw data for debugging */
  raw?: {
    permit2Datas?: any[];
    typedData?: any;
  };
}

/**
 * Recursively convert BigInt-wrapped objects {hex: "0x..."} to hex strings
 * Wallets expect hex strings, not BigInt objects
 */
function normalizeBigInts(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  // Handle BigInt wrapper objects - convert to hex string
  if (typeof obj === "object" && obj.hex !== undefined) {
    return obj.hex;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(normalizeBigInts);
  }

  // Handle objects
  if (typeof obj === "object") {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = normalizeBigInts(obj[key]);
    }
    return result;
  }

  return obj;
}

/**
 * Extract and normalize EIP-712 signing payloads from quote response
 *
 * This tool prepares signing payloads in a standard format that ANY wallet
 * MCP can use - Coinbase Payments MCP, wallet-agent, Safe, etc.
 */
export function handlePrepareSignatures(
  params: PrepareSignaturesParams
): PrepareSignaturesResult {
  const { quoteResponse } = params;

  const quoteId = quoteResponse.quoteId;
  const intent = quoteResponse.intent;

  if (!quoteId) {
    throw new Error("quoteResponse must contain quoteId");
  }

  const sourceChainId = intent?.sourceChainId || 1;
  const requiresPermit2 = intent?.permit2Datas?.length > 0;
  const requiresBridgeSignature = !!intent?.typedData;

  const result: PrepareSignaturesResult = {
    quoteId,
    sourceChainId,
    requiresPermit2,
    requiresBridgeSignature,
    instructions: "",
    raw: {
      permit2Datas: intent?.permit2Datas,
      typedData: intent?.typedData,
    },
  };

  // Extract Permit2 signing payload
  if (requiresPermit2) {
    const permit2Data = normalizeBigInts(intent.permit2Datas[0]);
    result.permit2 = {
      domain: permit2Data.domain,
      types: permit2Data.types,
      primaryType: permit2Data.primaryType,
      message: permit2Data.values || permit2Data.message,
    };
  }

  // Extract bridge intent signing payload
  if (requiresBridgeSignature) {
    const bridgeData = normalizeBigInts(intent.typedData);
    result.bridgeIntent = {
      domain: bridgeData.domain,
      types: bridgeData.types,
      primaryType: bridgeData.primaryType,
      message: bridgeData.message || bridgeData.values,
    };
  }

  // Generate instructions for the wallet MCP
  result.instructions = generateInstructions(result);

  return result;
}

/**
 * Generate human/LLM-readable instructions for completing the flow
 */
function generateInstructions(result: PrepareSignaturesResult): string {
  const steps: string[] = [];

  if (result.requiresPermit2) {
    steps.push(
      `1. Sign the Permit2 typed data using your wallet's signTypedData function`
    );
  }

  if (result.requiresBridgeSignature) {
    steps.push(
      `${steps.length + 1}. Sign the bridge intent typed data using your wallet's signTypedData function`
    );
  }

  steps.push(
    `${steps.length + 1}. Call haiku_solve with:`,
    `   - quoteId: "${result.quoteId}"`,
    result.requiresPermit2 ? `   - permit2Signature: <signature from step 1>` : "",
    result.requiresBridgeSignature
      ? `   - userSignature: <signature from step ${result.requiresPermit2 ? 2 : 1}>`
      : ""
  );

  steps.push(
    `${steps.length + 1}. Broadcast the returned transaction using your wallet's sendTransaction function`
  );

  return steps.filter(Boolean).join("\n");
}

/**
 * Format response for human-readable output
 */
export function formatPrepareSignaturesResponse(
  result: PrepareSignaturesResult
): string {
  const lines = [
    "=== Signing Requirements ===",
    "",
    `Quote ID: ${result.quoteId}`,
    `Source Chain: ${result.sourceChainId}`,
    "",
    `Requires Permit2 Signature: ${result.requiresPermit2 ? "YES" : "NO"}`,
    `Requires Bridge Signature: ${result.requiresBridgeSignature ? "YES" : "NO"}`,
    "",
    "=== Instructions ===",
    "",
    result.instructions,
  ];

  if (result.permit2) {
    lines.push(
      "",
      "=== Permit2 Payload (for signTypedData) ===",
      "",
      JSON.stringify(result.permit2, null, 2)
    );
  }

  if (result.bridgeIntent) {
    lines.push(
      "",
      "=== Bridge Intent Payload (for signTypedData) ===",
      "",
      JSON.stringify(result.bridgeIntent, null, 2)
    );
  }

  return lines.join("\n");
}
