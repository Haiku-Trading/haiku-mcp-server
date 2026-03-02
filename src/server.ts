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
import type { QuoteToolResponse } from "./types/index.js";
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
        network: {
          type: "number",
          description:
            "Filter tokens by network. Common networks: 42161 (Arbitrum), 8453 (Base), 1 (Ethereum), 137 (Polygon), 10 (Optimism), 56 (BSC)",
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
      "When signatures are required (Permit2 or bridge), EIP-712 signing payloads are included in the response. " +
      "Two execution paths after getting a quote:\n" +
      "• Self-contained (WALLET_PRIVATE_KEY set): call haiku_execute directly — pass quoteId, sourceChainId, permit2SigningPayload + bridgeSigningPayload (if present), and approvals. The server signs and broadcasts automatically.\n" +
      "• External wallet (wallet MCP or no private key): call haiku_prepare_signatures with quoteId to get normalized EIP-712 payloads, sign them externally, then call haiku_execute with the signatures.\n" +
      "Use haiku_solve instead only when building unsigned transactions for external broadcast.",
    inputSchema: {
      type: "object" as const,
      properties: {
        inputPositions: {
          type: "object",
          additionalProperties: { type: "string" },
          description:
            'Map of token IID to amount. IID format: "<chain-slug>:<token-address>". ' +
            'Supported chain slugs: arb=Arbitrum(42161), base=Base(8453), eth=Ethereum(1), ' +
            'poly=Polygon(137), opt=Optimism(10), bsc=BNB Chain(56), avax=Avalanche(43114), ' +
            'gnosis=Gnosis(100), sonic=Sonic(146), worldchain=World Chain(480), ' +
            'scroll=Scroll(534352), lisk=Lisk(1135), sei=Sei(1329), bera=Berachain(80094), ' +
            'bob=BOB(60808), hype=Hyperliquid(999), katana=Katana(747474), monad=Monad(143), ' +
            'plasma=Plasma(9745), uni=Unichain(130), ape=ApeChain(33139), megaeth=MegaETH(4326). ' +
            'Example: { "arb:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1": "1.5" }',
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
      "External wallet signing path — use this instead of passing signing payloads directly to haiku_execute " +
      "when WALLET_PRIVATE_KEY is not set or when a wallet MCP (Coinbase Payments MCP, wallet-agent, etc.) handles signing. " +
      "Extracts and normalizes the EIP-712 payloads from a quote into a standard format any wallet's signTypedData can consume. " +
      "Pass quoteId (preferred) — the server resolves the full quote from session cache. " +
      "Alternatively pass the full quoteResponse object if quoteId is unavailable. " +
      "After signing externally, pass permit2Signature and/or userSignature to haiku_execute.",
    inputSchema: {
      type: "object" as const,
      properties: {
        quoteId: {
          type: "string",
          description: "Quote ID from haiku_get_quote (preferred — server resolves the full quote from session cache)",
        },
        quoteResponse: {
          type: "object",
          description: "Full response from haiku_get_quote (fallback when quoteId is unavailable)",
        },
      },
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
        network: {
          type: "number",
          description:
            "Filter by network. Common networks: 42161 (Arbitrum), 8453 (Base), 1 (Ethereum), 137 (Polygon), 10 (Optimism), 56 (BNB Chain)",
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
      "Step 2 of 2: Execute a quote. Call haiku_get_quote first, then use one of two signing paths:\n" +
      "• Self-contained (WALLET_PRIVATE_KEY set): pass quoteId, sourceChainId, permit2SigningPayload + bridgeSigningPayload (if present), and approvals — the server signs and broadcasts automatically.\n" +
      "• External wallet (wallet MCP): first call haiku_prepare_signatures with quoteId to get normalized EIP-712 payloads, sign them externally, then pass quoteId, sourceChainId, permit2Signature + userSignature, and approvals here.\n" +
      "Always pass sourceChainId from the quote response. Always pass approvals if present.\n" +
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
        approvals: {
          type: "array",
          items: { type: "object" },
          description: "approvals from haiku_get_quote — sent automatically in self-contained mode",
        },
        sourceChainId: {
          type: "number",
          description: "Chain ID of the source token (from haiku_get_quote). Recommended — if omitted, the server will attempt to recover it from the signing payloads or session cache, but passing it explicitly is safer.",
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
  const quoteCache = new Map<string, QuoteToolResponse>();

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
          quoteCache.set(result.quoteId, result);
          return {
            content: [
              { type: "text", text: formatQuoteResponse(result) },
              { type: "text", text: "\n\n---\nNext steps — choose one path:\n• Self-contained (WALLET_PRIVATE_KEY set): call haiku_execute with quoteId, sourceChainId, permit2SigningPayload + bridgeSigningPayload (if present in this response), and approvals (if present).\n• External wallet (wallet MCP): call haiku_prepare_signatures with quoteId to get normalized signing payloads, sign them externally, then call haiku_execute with quoteId, sourceChainId, the signatures, and approvals.\n\nFull quote data:\n" + JSON.stringify(result, null, 2) },
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
          const resolvedArgs = (args as any)?.quoteResponse
            ? args
            : { quoteResponse: quoteCache.get((args as any)?.quoteId as string), quoteId: (args as any)?.quoteId };
          const params = prepareSignaturesSchema.parse(resolvedArgs);
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
          const resolvedParams = {
            ...params,
            sourceChainId: params.sourceChainId ?? quoteCache.get(params.quoteId)?.sourceChainId,
          };
          const result = await handleExecute(haikuClient, resolvedParams);
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
