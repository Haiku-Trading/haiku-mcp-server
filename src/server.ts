import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { HaikuClient, createHaikuClientFromEnv } from "./api/haiku-client.js";
import {
  getTokensSchema,
  getBalancesSchema,
  handleGetTokens,
  handleGetBalances,
} from "./tools/tokens.js";
import {
  getQuoteSchema,
  handleGetQuote,
  formatQuoteResponse,
} from "./tools/quote.js";
import {
  solveSchema,
  handleSolve,
  formatSolveResponse,
} from "./tools/solve.js";
import {
  prepareSignaturesSchema,
  handlePrepareSignatures,
  formatPrepareSignaturesResponse,
} from "./tools/prepare-signatures.js";
import {
  executeSchema,
  handleExecute,
  formatExecuteResponse,
} from "./tools/execute.js";
import {
  discoverYieldsSchema,
  handleDiscoverYields,
} from "./tools/yields.js";
import {
  analyzePortfolioSchema,
  handleAnalyzePortfolio,
} from "./tools/portfolio-analysis.js";

/**
 * Tool definitions for the MCP server
 */
const TOOLS = [
  {
    name: "haiku_get_tokens",
    description:
      "Get supported tokens and DeFi positions for trading. " +
      "Includes vanilla tokens, Aave collateral/debt, yield vaults, and LP tokens. " +
      "Use category filter to narrow results (e.g., 'collateral' for Aave aTokens). " +
      "Returns token IIDs (unique identifiers), symbols, names, prices, and chain information. " +
      "Use the IID format (chainSlug:tokenAddress) when specifying tokens in other tools.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chainId: {
          type: "number",
          description:
            "Filter tokens by chain ID. Common chains: 42161 (Arbitrum), 8453 (Base), 1 (Ethereum), 137 (Polygon), 10 (Optimism), 56 (BSC)",
        },
        category: {
          type: "string",
          enum: [
            "token",
            "collateral",
            "varDebt",
            "vault",
            "weightedLiquidity",
            "concentratedLiquidity",
          ],
          description:
            "Filter by token category: 'token' (vanilla tokens), 'collateral' (Aave aTokens), " +
            "'varDebt' (Aave debt tokens), 'vault' (Yearn/Morpho vaults), " +
            "'weightedLiquidity' (Balancer LP), 'concentratedLiquidity' (Uniswap V3 LP). " +
            "Omit to return all categories.",
        },
      },
    },
  },
  {
    name: "haiku_get_balances",
    description:
      "Get token balances for a wallet address across all supported chains. " +
      "Returns balances, USD prices, total portfolio value, and categorized positions (tokens, collateral, debt, vaults). " +
      "walletAddress is optional when WALLET_PRIVATE_KEY is set in the environment.",
    inputSchema: {
      type: "object" as const,
      properties: {
        walletAddress: {
          type: "string",
          description: "Wallet address (0x...) or ENS name. Omit to auto-derive from WALLET_PRIVATE_KEY.",
        },
      },
      required: [],
    },
  },
  {
    name: "haiku_get_quote",
    description:
      "Get a quote for a token swap or portfolio rebalance. " +
      "Returns expected outputs, fees, gas estimates, and any required approvals. " +
      "When signatures are required (Permit2 or bridge), the full EIP-712 signing payloads are included directly in the response. " +
      "Sign the provided typed data and pass the signatures to haiku_solve.",
    inputSchema: {
      type: "object" as const,
      properties: {
        inputPositions: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            'Map of token IID to amount. Example: { "arb:0x82aF...": "1.5" }',
        },
        targetWeights: {
          type: "object",
          additionalProperties: { type: "number" },
          description:
            'Map of output token IID to weight (sum to 1). Example: { "arb:0xaf88...": 0.5, "arb:0xFd08...": 0.5 }',
        },
        slippage: {
          type: "number",
          description: "Max slippage as decimal (e.g., 0.003 for 0.3%). Default: 0.003",
        },
        receiver: {
          type: "string",
          description: "Receiving wallet address. Defaults to sender.",
        },
      },
      required: ["inputPositions", "targetWeights"],
    },
  },
  {
    name: "haiku_solve",
    description:
      "Convert a quote into an unsigned EVM transaction. " +
      "Requires quoteId from haiku_get_quote. " +
      "If the quote required Permit2 signature, include permit2Signature. " +
      "If it was a complex bridge, include userSignature. " +
      "Returns { to, data, value } - sign and broadcast this transaction.",
    inputSchema: {
      type: "object" as const,
      properties: {
        quoteId: {
          type: "string",
          description: "Quote ID from haiku_get_quote response",
        },
        permit2Signature: {
          type: "string",
          description: "Signature from signing permit2Datas (if required)",
        },
        userSignature: {
          type: "string",
          description: "Signature from signing destinationBridge (if required)",
        },
      },
      required: ["quoteId"],
    },
  },
  {
    name: "haiku_prepare_signatures",
    description:
      "Extract EIP-712 signing payloads from a quote for external wallet signing. " +
      "Use this when integrating with wallet MCPs (Coinbase Payments MCP, wallet-agent, etc). " +
      "Returns standardized typed data that any wallet's signTypedData can handle. " +
      "After signing externally, pass signatures to haiku_solve or haiku_execute.",
    inputSchema: {
      type: "object" as const,
      properties: {
        quoteResponse: {
          type: "object",
          description: "Full response from haiku_get_quote",
        },
      },
      required: ["quoteResponse"],
    },
  },
  {
    name: "haiku_discover_yields",
    description:
      "Discover yield-bearing opportunities across DeFi protocols. " +
      "Returns APY, TVL, risk parameters, and token IIDs ready for haiku_get_quote. " +
      "Use this to answer questions like 'best lending yields on Arbitrum', " +
      "'highest APY vaults with at least $1M TVL', or 'what can I do with USDC on BNB Chain'. " +
      "The iid field in results can be used directly as a targetWeight key in haiku_get_quote.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chainId: {
          type: "number",
          description:
            "Filter by chain ID. Common chains: 42161 (Arbitrum), 8453 (Base), 1 (Ethereum), 137 (Polygon), 10 (Optimism), 56 (BNB Chain)",
        },
        category: {
          type: "string",
          enum: ["lending", "vault", "lp", "all"],
          description:
            "lending=Aave collateral tokens, vault=Yearn/Morpho vaults, lp=Balancer/Uniswap LP, all=every yield-bearing category (default: all)",
        },
        minApy: {
          type: "number",
          description: "Minimum APY filter as a percentage, e.g. 5 means ≥5% APY",
        },
        minTvl: {
          type: "number",
          description:
            "Minimum TVL filter in USD, e.g. 1000000 means ≥$1M TVL. " +
            "Use this to filter to established mainstream vaults and exclude low-liquidity pools.",
        },
        sortBy: {
          type: "string",
          enum: ["apy", "tvl"],
          description: "Sort by APY (default) or TVL, descending",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default 20)",
        },
      },
    },
  },
  {
    name: "haiku_analyze_portfolio",
    description:
      "Analyze a wallet's DeFi portfolio and surface relevant yield opportunities. " +
      "Returns current positions enriched with available APY options, collateral health factors, " +
      "and context-specific opportunities based on what the wallet actually holds. " +
      "Use this when a user asks what they should do with their portfolio or wants yield optimization advice. " +
      "Pair the output with haiku_discover_yields for broader market context, then use haiku_get_quote to execute.",
    inputSchema: {
      type: "object" as const,
      properties: {
        walletAddress: {
          type: "string",
          description: "Wallet address (0x...) to analyze",
        },
      },
      required: ["walletAddress"],
    },
  },
  {
    name: "haiku_execute",
    description:
      "Step 2 of 2: Execute a quote. Call haiku_get_quote first to get a quoteId, " +
      "then pass it here.\n" +
      "Self-contained mode (WALLET_PRIVATE_KEY set): pass permit2SigningPayload and " +
      "bridgeSigningPayload from the quote response — the server signs and broadcasts automatically.\n" +
      "External signature mode: pass pre-signed permit2Signature/userSignature from a wallet MCP.\n" +
      "Set broadcast=false to get the unsigned tx for manual broadcasting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        quoteId: {
          type: "string",
          description: "Quote ID from haiku_get_quote",
        },
        permit2SigningPayload: {
          type: "object",
          description: "permit2SigningPayload from haiku_get_quote (for self-contained signing)",
        },
        bridgeSigningPayload: {
          type: "object",
          description: "bridgeSigningPayload from haiku_get_quote (cross-chain only, for self-contained signing)",
        },
        permit2Signature: {
          type: "string",
          description: "Pre-signed Permit2 signature (external wallet mode)",
        },
        userSignature: {
          type: "string",
          description: "Pre-signed bridge intent signature (external wallet mode)",
        },
        broadcast: {
          type: "boolean",
          description: "If true (default), broadcasts tx. If false, returns unsigned tx.",
        },
      },
      required: ["quoteId"],
    },
  },
];

/**
 * Create and configure the MCP server
 */
export function createServer(): Server {
  const server = new Server(
    {
      name: "haiku-mcp-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  let client: HaikuClient;

  // Initialize client lazily on first tool call
  function getClient(): HaikuClient {
    if (!client) {
      client = createHaikuClientFromEnv();
    }
    return client;
  }

  // Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const haikuClient = getClient();

      switch (name) {
        case "haiku_get_tokens": {
          const params = getTokensSchema.parse(args);
          const result = await handleGetTokens(haikuClient, params);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "haiku_get_balances": {
          const params = getBalancesSchema.parse(args);
          const result = await handleGetBalances(haikuClient, params);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "haiku_get_quote": {
          const params = getQuoteSchema.parse(args);
          const result = await handleGetQuote(haikuClient, params);
          return {
            content: [
              { type: "text", text: formatQuoteResponse(result) },
              { type: "text", text: "\n\n---\nPass quoteId (and permit2SigningPayload/bridgeSigningPayload if WALLET_PRIVATE_KEY signing is needed) to haiku_execute:\n" + JSON.stringify(result, null, 2) },
            ],
          };
        }

        case "haiku_solve": {
          const params = solveSchema.parse(args);
          const result = await handleSolve(haikuClient, params);
          return {
            content: [
              { type: "text", text: formatSolveResponse(result) },
            ],
          };
        }

        case "haiku_prepare_signatures": {
          const params = prepareSignaturesSchema.parse(args);
          const result = handlePrepareSignatures(params);
          return {
            content: [
              { type: "text", text: formatPrepareSignaturesResponse(result) },
              { type: "text", text: "\n\nRaw payloads:\n" + JSON.stringify(result, null, 2) },
            ],
          };
        }

        case "haiku_discover_yields": {
          const params = discoverYieldsSchema.parse(args);
          const result = await handleDiscoverYields(haikuClient, params);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "haiku_analyze_portfolio": {
          const params = analyzePortfolioSchema.parse(args);
          const result = await handleAnalyzePortfolio(haikuClient, params);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "haiku_execute": {
          const params = executeSchema.parse(args);
          const result = await handleExecute(haikuClient, params);
          return {
            content: [
              { type: "text", text: formatExecuteResponse(result) },
              { type: "text", text: "\n\nRaw result:\n" + JSON.stringify(result, null, 2) },
            ],
            isError: !result.success,
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Run the MCP server with stdio transport
 */
export async function runServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle shutdown
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });
}
