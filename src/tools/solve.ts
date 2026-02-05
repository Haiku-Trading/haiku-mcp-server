import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";
import type { UnsignedTransaction } from "../types/index.js";

/**
 * Schema for haiku_solve tool parameters
 */
export const solveSchema = z.object({
  quoteId: z
    .string()
    .describe("The quote ID received from haiku_get_quote"),
  permit2Signature: z
    .string()
    .optional()
    .describe(
      "Signature from signing the permit2Datas EIP-712 typed data. Required if the quote indicated requiresPermit2Signature: true"
    ),
  userSignature: z
    .string()
    .optional()
    .describe(
      "Signature from signing the destinationBridge EIP-712 typed data. Required for cross-chain swaps with complex bridge operations"
    ),
});

export type SolveParams = z.infer<typeof solveSchema>;

/**
 * Handle haiku_solve tool call
 */
export async function handleSolve(
  client: HaikuClient,
  params: SolveParams
): Promise<UnsignedTransaction> {
  return client.solve({
    quoteId: params.quoteId,
    permit2Signature: params.permit2Signature,
    userSignature: params.userSignature,
  });
}

/**
 * Format solve response for human-readable output
 */
export function formatSolveResponse(transaction: UnsignedTransaction): string {
  return [
    "=== Unsigned Transaction ===",
    "",
    `To: ${transaction.to}`,
    `Value: ${transaction.value}`,
    `Data: ${transaction.data.slice(0, 66)}...`,
    "",
    "Sign this transaction with your wallet and broadcast to the network.",
    "",
    "Transaction object:",
    JSON.stringify(transaction, null, 2),
  ].join("\n");
}
