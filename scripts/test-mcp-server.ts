/**
 * Test the MCP server via stdio transport
 *
 * This sends proper JSON-RPC messages to test the MCP tool interface
 */

import { spawn, ChildProcess } from "child_process";
import * as readline from "readline";

const TEST_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

class MCPTestClient {
  private server: ChildProcess;
  private requestId = 0;
  private pendingRequests = new Map<number, { resolve: (value: JsonRpcResponse) => void; reject: (error: Error) => void }>();
  private buffer = "";

  constructor() {
    this.server = spawn("node", ["dist/index.js"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.server.stdout!.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.server.stderr!.on("data", (data) => {
      console.error("Server stderr:", data.toString());
    });
  }

  private processBuffer() {
    // Split by newlines and process complete messages
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          pending.resolve(response);
        }
      } catch (e) {
        // Ignore non-JSON lines
      }
    }
  }

  async sendRequest(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = ++this.requestId;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.server.stdin!.write(JSON.stringify(request) + "\n");

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error("Request timeout"));
        }
      }, 30000);
    });
  }

  async initialize() {
    const response = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    return response;
  }

  async listTools() {
    return this.sendRequest("tools/list", {});
  }

  async callTool(name: string, args: Record<string, unknown>) {
    return this.sendRequest("tools/call", { name, arguments: args });
  }

  close() {
    this.server.kill();
  }
}

async function runTests() {
  console.log("=".repeat(60));
  console.log("MCP Server Integration Test");
  console.log("=".repeat(60));
  console.log();

  const client = new MCPTestClient();

  try {
    // Initialize
    console.log("Initializing MCP connection...");
    const initResponse = await client.initialize();
    if (initResponse.error) {
      console.error("Failed to initialize:", initResponse.error);
      return;
    }
    console.log("✓ Initialized successfully");
    console.log();

    // List tools
    console.log("Listing available tools...");
    const toolsResponse = await client.listTools();
    if (toolsResponse.error) {
      console.error("Failed to list tools:", toolsResponse.error);
      return;
    }
    const tools = (toolsResponse.result as any)?.tools || [];
    console.log(`✓ Found ${tools.length} tools:`);
    for (const tool of tools) {
      console.log(`  - ${tool.name}: ${tool.description?.substring(0, 60)}...`);
    }
    console.log();

    // Test 1: haiku_get_tokens
    console.log("1. Testing haiku_get_tokens (chainId: 42161)...");
    console.log("-".repeat(40));
    const tokensResponse = await client.callTool("haiku_get_tokens", { chainId: 42161 });
    if (tokensResponse.error) {
      console.error(`✗ Error: ${tokensResponse.error.message}`);
    } else {
      const content = (tokensResponse.result as any)?.content?.[0]?.text || "";
      try {
        const data = JSON.parse(content);
        const tokens = data.tokenList?.tokens || data.tokens || [];
        console.log(`✓ Returned ${tokens.length} Arbitrum tokens`);
      } catch {
        console.log(`✓ Response received (${content.length} chars)`);
      }
    }
    console.log();

    // Test 2: haiku_get_balances
    console.log("2. Testing haiku_get_balances...");
    console.log("-".repeat(40));
    const balancesResponse = await client.callTool("haiku_get_balances", {
      walletAddress: TEST_WALLET,
    });
    if (balancesResponse.error) {
      console.error(`✗ Error: ${balancesResponse.error.message}`);
    } else {
      const content = (balancesResponse.result as any)?.content?.[0]?.text || "";
      try {
        const data = JSON.parse(content);
        // Response format is { walletAddress, totalValueUSD, balances: [...] }
        const posCount = data.balances?.length || 0;
        console.log(`✓ Found ${posCount} token positions`);
        console.log(`  Total USD value: $${data.totalValueUSD}`);
        if (data.balances?.length > 0) {
          console.log(`  Top balance: ${data.balances[0].token} = ${data.balances[0].balance} (~$${data.balances[0].valueUSD})`);
        }
      } catch {
        console.log(`✓ Response received (${content.length} chars)`);
      }
    }
    console.log();

    // Test 3: haiku_get_quote
    console.log("4. Testing haiku_get_quote (native ETH -> USDC)...");
    console.log("-".repeat(40));
    const quoteResponse = await client.callTool("haiku_get_quote", {
      inputPositions: { [`arb:${NATIVE_ETH}`]: "0.0001" },
      targetWeights: { [`arb:${USDC_ARB}`]: 1 },
      slippage: 0.003,
      receiver: TEST_WALLET,
    });
    let quoteId: string | undefined;
    if (quoteResponse.error) {
      console.error(`✗ Error: ${quoteResponse.error.message}`);
    } else {
      const contents = (quoteResponse.result as any)?.content || [];
      const rawContent = contents.find((c: any) => c.text?.includes("Raw response"))?.text || "";
      try {
        const rawJson = rawContent.split("Raw response:\n")[1];
        const data = JSON.parse(rawJson);
        quoteId = data.quoteId;
        console.log(`✓ Quote received`);
        console.log(`  Quote ID: ${quoteId}`);
        console.log(`  Permit2 required: ${!!data.permit2Datas}`);
        console.log(`  Approvals: ${data.approvals?.length || 0}`);
      } catch {
        console.log(`✓ Response received`);
        console.log(`  Preview: ${contents[0]?.text?.substring(0, 200)}...`);
      }
    }
    console.log();

    // Test 5: haiku_solve (if we have a quote)
    console.log("5. Testing haiku_solve...");
    console.log("-".repeat(40));
    if (quoteId) {
      const solveResponse = await client.callTool("haiku_solve", {
        quoteId: quoteId,
      });
      if (solveResponse.error) {
        console.error(`✗ Error: ${solveResponse.error.message}`);
      } else {
        const content = (solveResponse.result as any)?.content?.[0]?.text || "";
        console.log(`✓ Transaction built`);
        console.log(`  Preview: ${content.substring(0, 300)}...`);
      }
    } else {
      console.log(`⚠ Skipping - no quote ID from previous steps`);
    }
    console.log();

    console.log("=".repeat(60));
    console.log("MCP Server Integration Test Complete!");
    console.log("=".repeat(60));

  } finally {
    client.close();
  }
}

runTests().catch(console.error);
