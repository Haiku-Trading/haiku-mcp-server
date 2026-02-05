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
  naturalLanguageIntentSchema,
  handleNaturalLanguageIntent,
  formatNaturalLanguageIntentResponse,
} from "./tools/natural-language.js";

/**
 * Tool definitions for the MCP server
 */
const TOOLS = [
  {
    name: "haiku_get_tokens",
    description:
      "Get a list of supported tokens for trading on the Haiku platform. " +
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
      },
    },
  },
  {
    name: "haiku_get_balances",
    description:
      "Get token balances for a wallet address across all supported chains. " +
      "Returns balances, USD prices, total portfolio value, and categorized positions (tokens, collateral, debt, vaults).",
    inputSchema: {
      type: "object" as const,
      properties: {
        walletAddress: {
          type: "string",
          description: "Wallet address (0x...) or ENS name",
        },
      },
      required: ["walletAddress"],
    },
  },
  {
    name: "haiku_get_quote",
    description:
      "Get a quote for a token swap or portfolio rebalance. " +
      "Returns expected outputs, fees, gas estimates, and any required approvals. " +
      "If permit2Datas is returned, you must sign it before calling haiku_solve. " +
      "Use the quoteId from this response when calling haiku_solve.",
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
    name: "haiku_natural_language_intent",
    description:
      "Convert a natural language trading instruction into a structured intent. " +
      'Examples: "swap all my WETH for USDC", "convert half my ETH to stablecoins". ' +
      "Automatically fetches wallet balances for context. " +
      "Returns an intent object ready to use with haiku_get_quote.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Natural language trade instruction",
        },
        walletAddress: {
          type: "string",
          description: "Wallet address for balance context",
        },
      },
      required: ["prompt", "walletAddress"],
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
              { type: "text", text: "\n\nRaw response:\n" + JSON.stringify(result, null, 2) },
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

        case "haiku_natural_language_intent": {
          const params = naturalLanguageIntentSchema.parse(args);
          const result = await handleNaturalLanguageIntent(haikuClient, params);
          return {
            content: [
              { type: "text", text: formatNaturalLanguageIntentResponse(result) },
              { type: "text", text: "\n\nRaw intent:\n" + JSON.stringify(result.intent, null, 2) },
            ],
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
