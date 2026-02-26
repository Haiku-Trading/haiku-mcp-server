import { z } from "zod";
import {
  createWalletClient,
  createPublicClient,
  http,
  type Chain,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as chains from "viem/chains";
import type { HaikuClient } from "../api/haiku-client.js";

/**
 * Schema for haiku_execute tool parameters
 *
 * Supports two modes:
 * 1. Self-contained: WALLET_PRIVATE_KEY env var set, tool signs everything internally
 * 2. External signatures: Pass pre-signed signatures from wallet MCP
 *
 * Note: Private key is ONLY read from env var for security (not accepted as parameter)
 */
export const executeSchema = z.object({
  quoteId: z
    .string()
    .describe("Quote ID from haiku_get_quote. Required to call /solve."),

  // For self-contained signing (WALLET_PRIVATE_KEY mode only)
  permit2SigningPayload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "permit2SigningPayload from haiku_get_quote. Required for self-contained signing " +
        "when WALLET_PRIVATE_KEY is set and the swap needs Permit2 approval."
    ),

  bridgeSigningPayload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "bridgeSigningPayload from haiku_get_quote. Required for self-contained signing " +
        "of cross-chain swaps with complex bridges."
    ),

  // External signatures (from wallet MCP)
  permit2Signature: z
    .string()
    .optional()
    .describe(
      "Pre-signed Permit2 signature from external wallet. " +
        "Use haiku_prepare_signatures to get the payload to sign."
    ),
  userSignature: z
    .string()
    .optional()
    .describe(
      "Pre-signed bridge intent signature from external wallet. " +
        "Required for cross-chain swaps with complex bridges."
    ),

  approvals: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      "approvals array from haiku_get_quote. In self-contained mode (WALLET_PRIVATE_KEY set), " +
      "these ERC-20 approval transactions are sent and confirmed before the main swap."
    ),

  sourceChainId: z
    .number()
    .optional()
    .describe(
      "sourceChainId from haiku_get_quote response. Used as chain fallback when permit2SigningPayload is absent."
    ),

  broadcast: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default), broadcasts tx. If false, returns unsigned tx without broadcasting."
    ),
});

type ExecuteParams = z.infer<typeof executeSchema>;

/**
 * Custom chain definitions for chains not in viem/chains
 */
const berachain = defineChain({
  id: 80094,
  name: "Berachain",
  nativeCurrency: { name: "BERA", symbol: "BERA", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.berachain.com"] } },
  blockExplorers: { default: { name: "Berascan", url: "https://berascan.com" } },
});

const bob = defineChain({
  id: 60808,
  name: "Bob",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.gobob.xyz"] } },
  blockExplorers: { default: { name: "Bob Explorer", url: "https://explorer.gobob.xyz" } },
});

const hyperliquid = defineChain({
  id: 999,
  name: "Hyperliquid",
  nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.hyperliquid.xyz"] } },
  blockExplorers: { default: { name: "Hyperliquid Explorer", url: "https://explorer.hyperliquid.xyz" } },
});

const katana = defineChain({
  id: 747474,
  name: "Katana",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.katana.network"] } },
  blockExplorers: { default: { name: "Katana Explorer", url: "https://explorer.katana.network" } },
});

const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "Monad Explorer", url: "https://explorer.monad.xyz" } },
});

const plasma = defineChain({
  id: 9745,
  name: "Plasma",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.plasma.network"] } },
  blockExplorers: { default: { name: "Plasma Explorer", url: "https://explorer.plasma.network" } },
});

const unichain = defineChain({
  id: 130,
  name: "Unichain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.unichain.org"] } },
  blockExplorers: { default: { name: "Unichain Explorer", url: "https://explorer.unichain.org" } },
});

const apeChain = defineChain({
  id: 33139,
  name: "ApeChain",
  nativeCurrency: { name: "APE", symbol: "APE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.apechain.com"] } },
  blockExplorers: { default: { name: "ApeScan", url: "https://apescan.io" } },
});

/**
 * Chain ID to viem chain mapping - all 21 supported chains
 */
const CHAIN_MAP: Record<number, Chain> = {
  // Standard viem chains
  1: chains.mainnet,
  10: chains.optimism,
  56: chains.bsc,
  100: chains.gnosis,
  137: chains.polygon,
  146: chains.sonic,
  480: chains.worldchain,
  534352: chains.scroll,
  1135: chains.lisk,
  1329: chains.sei,
  8453: chains.base,
  42161: chains.arbitrum,
  43114: chains.avalanche,
  // Custom chain definitions
  80094: berachain,
  60808: bob,
  999: hyperliquid,
  747474: katana,
  143: monad,
  9745: plasma,
  130: unichain,
  33139: apeChain,
};

/**
 * Get RPC URL for a chain
 */
function getRpcUrl(chainId: number): string {
  const envKey = `RPC_URL_${chainId}`;
  if (process.env[envKey]) {
    return process.env[envKey]!;
  }

  // Chain-specific public RPCs
  const publicRpcs: Record<number, string> = {
    1: "https://eth.llamarpc.com",
    10: "https://mainnet.optimism.io",
    56: "https://bsc-dataseed.binance.org",
    100: "https://rpc.gnosischain.com",
    137: "https://polygon-rpc.com",
    146: "https://rpc.soniclabs.com",
    480: "https://worldchain-mainnet.g.alchemy.com/public",
    534352: "https://rpc.scroll.io",
    1135: "https://rpc.api.lisk.com",
    1329: "https://evm-rpc.sei-apis.com",
    8453: "https://mainnet.base.org",
    42161: "https://arb1.arbitrum.io/rpc",
    43114: "https://api.avax.network/ext/bc/C/rpc",
    80094: "https://rpc.berachain.com",
    60808: "https://rpc.gobob.xyz",
    999: "https://rpc.hyperliquid.xyz",
    747474: "https://rpc.katana.network",
    143: "https://rpc.monad.xyz",
    9745: "https://rpc.plasma.network",
    130: "https://rpc.unichain.org",
    33139: "https://rpc.apechain.com",
  };

  return publicRpcs[chainId] || `https://rpc.ankr.com/${chainId}`;
}

/**
 * Recursively convert BigInt-wrapped objects to actual BigInts
 */
function fixBigInts(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "object" && obj.hex !== undefined) {
    return BigInt(obj.hex);
  }
  if (Array.isArray(obj)) {
    return obj.map(fixBigInts);
  }
  if (typeof obj === "object") {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = fixBigInts(obj[key]);
    }
    return result;
  }
  return obj;
}

/**
 * Get explorer URL for a transaction
 */
function getExplorerUrl(chainId: number, txHash: string): string {
  const explorers: Record<number, string> = {
    1: "https://etherscan.io",
    10: "https://optimistic.etherscan.io",
    56: "https://bscscan.com",
    100: "https://gnosisscan.io",
    137: "https://polygonscan.com",
    146: "https://sonicscan.org",
    480: "https://worldscan.org",
    534352: "https://scrollscan.com",
    1135: "https://blockscout.lisk.com",
    1329: "https://seitrace.com",
    8453: "https://basescan.org",
    42161: "https://arbiscan.io",
    43114: "https://snowtrace.io",
    80094: "https://berascan.com",
    60808: "https://explorer.gobob.xyz",
    999: "https://explorer.hyperliquid.xyz",
    747474: "https://explorer.katana.network",
    143: "https://explorer.monad.xyz",
    9745: "https://explorer.plasma.network",
    130: "https://explorer.unichain.org",
    33139: "https://apescan.io",
  };

  const base = explorers[chainId] || `https://blockscan.com`;
  return `${base}/tx/${txHash}`;
}

export interface ExecuteResult {
  success: boolean;
  mode: "self-contained" | "external-signatures" | "prepare-only";
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  signatures?: {
    permit2Signature?: string;
    userSignature?: string;
  };
  transaction?: {
    to: string;
    data: string;
    value: string;
    chainId: number;
  };
}

/**
 * Handle haiku_execute tool call
 *
 * Two modes:
 * 1. Self-contained: WALLET_PRIVATE_KEY env var set → signs internally → broadcasts
 * 2. External signatures: permit2Signature/userSignature provided → broadcasts
 *
 * Flow:
 * 1. Determine mode based on provided params
 * 2. Sign if in self-contained mode
 * 3. Call /solve with signatures
 * 4. Broadcast if broadcast=true
 */
export async function handleExecute(
  client: HaikuClient,
  params: ExecuteParams
): Promise<ExecuteResult> {
  const { quoteId, permit2SigningPayload, bridgeSigningPayload, approvals, broadcast = true } = params;

  // Private key ONLY from env var (security: never accept as parameter)
  const hasPrivateKey = !!process.env.WALLET_PRIVATE_KEY;
  const hasExternalSignatures = !!(params.permit2Signature || params.userSignature);

  if (!hasPrivateKey && !hasExternalSignatures && broadcast) {
    return {
      success: false,
      mode: "prepare-only",
      error:
        "No signing method provided. Either:\n" +
        "1. Set WALLET_PRIVATE_KEY env var for self-contained signing\n" +
        "2. Pass permit2Signature/userSignature from external wallet (use haiku_prepare_signatures first)\n" +
        "3. Set broadcast=false to just get the unsigned transaction",
    };
  }

  const sourceChainId =
    (permit2SigningPayload as any)?.domain?.chainId ||
    params.sourceChainId ||
    42161;
  const chain = CHAIN_MAP[sourceChainId];
  if (!chain) {
    return {
      success: false,
      mode: "prepare-only",
      error: `Unsupported chain ID: ${sourceChainId}`,
    };
  }

  try {
    let permit2Signature: string | undefined = params.permit2Signature;
    let userSignature: string | undefined = params.userSignature;
    let walletClient: any;
    let mode: ExecuteResult["mode"];

    // Mode 1: Self-contained signing (env var only)
    if (hasPrivateKey && !hasExternalSignatures) {
      mode = "self-contained";
      const privateKey = process.env.WALLET_PRIVATE_KEY!;
      const normalizedKey = privateKey.startsWith("0x")
        ? (privateKey as `0x${string}`)
        : (`0x${privateKey}` as `0x${string}`);

      const account = privateKeyToAccount(normalizedKey);
      walletClient = createWalletClient({
        account,
        chain,
        transport: http(getRpcUrl(sourceChainId)),
      });

      // Send ERC20 approval transactions first (must confirm before swap)
      if (approvals && approvals.length > 0) {
        const approvalPublicClient = createPublicClient({
          chain,
          transport: http(getRpcUrl(sourceChainId)),
        });
        for (const approval of approvals) {
          const approvalTx = fixBigInts(approval) as any;
          const approvalTo = approvalTx.to as `0x${string}`;
          const approvalData = approvalTx.data as `0x${string}`;
          const approvalValue = BigInt(approvalTx.value || "0");

          let approvalGasParams: { gas?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};
          try {
            const [estimatedGas, feeData] = await Promise.all([
              approvalPublicClient.estimateGas({
                account: walletClient.account,
                to: approvalTo,
                data: approvalData,
                value: approvalValue,
              }),
              approvalPublicClient.estimateFeesPerGas(),
            ]);
            approvalGasParams = {
              gas: (estimatedGas * 6n) / 5n,
              maxFeePerGas: feeData.maxFeePerGas,
              maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
            };
          } catch {
            // Fall back to viem/RPC defaults
          }

          const approvalHash = await walletClient.sendTransaction({
            to: approvalTo,
            data: approvalData,
            value: approvalValue,
            ...approvalGasParams,
          });
          await approvalPublicClient.waitForTransactionReceipt({ hash: approvalHash });
        }
      }

      // Sign Permit2 if required
      if (permit2SigningPayload) {
        const p2 = fixBigInts(permit2SigningPayload);
        permit2Signature = await walletClient.signTypedData({
          domain: p2.domain,
          types: p2.types,
          primaryType: p2.primaryType,
          message: p2.message,
        });
      }

      // Sign bridge intent if required
      if (bridgeSigningPayload) {
        const bridge = fixBigInts(bridgeSigningPayload);
        userSignature = await walletClient.signTypedData({
          domain: bridge.domain,
          types: bridge.types,
          primaryType: bridge.primaryType,
          message: bridge.message,
        });
      }
    }
    // Mode 2: External signatures provided
    else if (hasExternalSignatures) {
      mode = "external-signatures";

      // For broadcasting with external signatures, we need the private key to sign the actual tx
      if (broadcast && !hasPrivateKey) {
        return {
          success: false,
          mode: "external-signatures",
          error:
            "To broadcast with external signatures, you still need WALLET_PRIVATE_KEY env var to sign the transaction itself. " +
            "The permit2Signature/userSignature are for token approvals, not tx signing. " +
            "Either:\n" +
            "1. Set WALLET_PRIVATE_KEY env var for broadcasting\n" +
            "2. Set broadcast=false and broadcast the returned tx via your wallet MCP",
        };
      }

      if (hasPrivateKey) {
        const privateKey = process.env.WALLET_PRIVATE_KEY!;
        const normalizedKey = privateKey.startsWith("0x")
          ? (privateKey as `0x${string}`)
          : (`0x${privateKey}` as `0x${string}`);

        const account = privateKeyToAccount(normalizedKey);
        walletClient = createWalletClient({
          account,
          chain,
          transport: http(getRpcUrl(sourceChainId)),
        });
      }
    }
    // Mode 3: Just prepare (broadcast=false)
    else {
      mode = "prepare-only";
    }

    // Call solve with signatures
    const solveResult = await client.solve({
      quoteId,
      permit2Signature,
      userSignature,
    });

    // Fix BigInts in solve response
    const tx = fixBigInts(solveResult);

    const transaction = {
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: BigInt(tx.value || "0"),
      chainId: sourceChainId,
    };

    // If not broadcasting, return the prepared transaction
    if (!broadcast) {
      return {
        success: true,
        mode,
        signatures: { permit2Signature, userSignature },
        transaction: {
          to: transaction.to,
          data: transaction.data,
          value: transaction.value.toString(),
          chainId: sourceChainId,
        },
      };
    }

    // Broadcast transaction
    let gasParams: {
      gas?: bigint;
      maxFeePerGas?: bigint;
      maxPriorityFeePerGas?: bigint;
    } = {};

    try {
      const publicClient = createPublicClient({
        chain,
        transport: http(getRpcUrl(sourceChainId)),
      });

      const [estimatedGas, feeData] = await Promise.all([
        publicClient.estimateGas({
          account: walletClient.account,
          to: transaction.to,
          data: transaction.data,
          value: transaction.value,
        }),
        publicClient.estimateFeesPerGas(),
      ]);

      // 20% buffer: (estimatedGas * 6) / 5
      gasParams = {
        gas: (estimatedGas * 6n) / 5n,
        maxFeePerGas: feeData.maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
      };
    } catch {
      // Estimation failed — fall back to viem/RPC defaults (current behaviour)
    }

    const txHash = await walletClient.sendTransaction({
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
      ...gasParams,
    });

    const explorerUrl = getExplorerUrl(sourceChainId, txHash);

    return {
      success: true,
      mode,
      txHash,
      explorerUrl,
      signatures: { permit2Signature, userSignature },
      transaction: {
        to: transaction.to,
        data: transaction.data,
        value: transaction.value.toString(),
        chainId: sourceChainId,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      mode: hasExternalSignatures ? "external-signatures" : "self-contained",
      error: message,
    };
  }
}

/**
 * Format execute response for human-readable output
 */
export function formatExecuteResponse(result: ExecuteResult): string {
  if (!result.success) {
    return `=== Execution Failed ===\n\nMode: ${result.mode}\nError: ${result.error}`;
  }

  const lines = [`=== Transaction ${result.txHash ? "Executed" : "Prepared"} ===`, ""];
  lines.push(`Mode: ${result.mode}`);

  if (result.txHash) {
    lines.push("");
    lines.push(`Transaction Hash: ${result.txHash}`);
    lines.push(`Explorer: ${result.explorerUrl}`);
  }

  if (result.transaction) {
    lines.push("");
    lines.push("Transaction Details:");
    lines.push(`  Chain ID: ${result.transaction.chainId}`);
    lines.push(`  To: ${result.transaction.to}`);
    lines.push(`  Value: ${result.transaction.value}`);
    lines.push(`  Data: ${result.transaction.data.slice(0, 66)}...`);
  }

  if (!result.txHash && result.transaction) {
    lines.push("");
    lines.push("Next step: Broadcast this transaction using your wallet.");
  }

  return lines.join("\n");
}
