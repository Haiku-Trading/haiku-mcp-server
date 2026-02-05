/**
 * QA Test Script - Saves request/response payloads to JSON files for inspection
 */

import { createHaikuClientFromEnv } from "../src/api/haiku-client.js";
import { handleGetTokens } from "../src/tools/tokens.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const OUTPUT_DIR = "./qa-payloads";
const TEST_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

function savePayload(name: string, data: { request: any; response: any }) {
  const filename = join(OUTPUT_DIR, `${name}.json`);
  writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`  Saved: ${filename}`);
}

async function main() {
  const client = createHaikuClientFromEnv();

  // Create output directory
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("=".repeat(60));
  console.log("QA Payload Inspection - Saving to ./qa-payloads/");
  console.log("=".repeat(60));
  console.log();

  // 1. Get Tokens (vanilla tokens only)
  console.log("1. haiku_get_tokens (category: token, chainId: 42161)");
  try {
    const request = { chainId: 42161, category: "token" as const };
    const response = await handleGetTokens(client, request);
    savePayload("01-get-tokens-vanilla", { request, response });
    console.log(`   Token count: ${response.tokenCount}`);
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }
  console.log();

  // 2. Get Collateral Tokens (Aave aTokens)
  console.log("2. haiku_get_tokens (category: collateral, chainId: 42161)");
  try {
    const request = { chainId: 42161, category: "collateral" as const };
    const response = await handleGetTokens(client, request);
    savePayload("02-get-tokens-collateral", { request, response });
    console.log(`   Token count: ${response.tokenCount}`);
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }
  console.log();

  // 3. Get Variable Debt Tokens
  console.log("3. haiku_get_tokens (category: varDebt, chainId: 42161)");
  try {
    const request = { chainId: 42161, category: "varDebt" as const };
    const response = await handleGetTokens(client, request);
    savePayload("03-get-tokens-varDebt", { request, response });
    console.log(`   Token count: ${response.tokenCount}`);
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }
  console.log();

  // 4. Get Vault Tokens (Morpho/Yearn)
  console.log("4. haiku_get_tokens (category: vault, chainId: 42161)");
  try {
    const request = { chainId: 42161, category: "vault" as const };
    const response = await handleGetTokens(client, request);
    savePayload("04-get-tokens-vault", { request, response });
    console.log(`   Token count: ${response.tokenCount}`);
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }
  console.log();

  // 5. Get Weighted Liquidity Tokens (Balancer)
  console.log("5. haiku_get_tokens (category: weightedLiquidity, chainId: 42161)");
  try {
    const request = { chainId: 42161, category: "weightedLiquidity" as const };
    const response = await handleGetTokens(client, request);
    savePayload("05-get-tokens-weightedLiquidity", { request, response });
    console.log(`   Token count: ${response.tokenCount}`);
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }
  console.log();

  // 6. Get Concentrated Liquidity Tokens (Uniswap V3)
  console.log("6. haiku_get_tokens (category: concentratedLiquidity, chainId: 42161)");
  try {
    const request = { chainId: 42161, category: "concentratedLiquidity" as const };
    const response = await handleGetTokens(client, request);
    savePayload("06-get-tokens-concentratedLiquidity", { request, response });
    console.log(`   Token count: ${response.tokenCount}`);
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }
  console.log();

  // 7. Get Balances
  console.log("7. haiku_get_balances");
  let balances: any;
  try {
    const request = { walletAddress: TEST_WALLET };
    balances = await client.getTokenBalances(TEST_WALLET);
    savePayload("07-get-balances", { request, response: balances });
    console.log(`   Positions: ${Object.keys(balances.wallet_positions || {}).length}`);
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }
  console.log();

  // 8. Get Quote
  console.log("8. haiku_get_quote (ETH -> USDC)");
  let quoteId: string | undefined;
  try {
    const request = {
      inputPositions: { [`arb:${NATIVE_ETH}`]: "0.0001" },
      targetWeights: { [`arb:${USDC_ARB}`]: 1 },
      slippage: 0.003,
      receiver: TEST_WALLET,
    };
    const response = await client.getQuote(request);
    quoteId = response.quoteId;
    savePayload("08-get-quote", { request, response });
    console.log(`   Quote ID: ${quoteId}`);
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }
  console.log();

  // 9. Solve
  console.log("9. haiku_solve");
  if (quoteId) {
    try {
      const request = { quoteId };
      const response = await client.solve(request);
      savePayload("09-solve", { request, response });
      console.log(`   Transaction to: ${response.to}`);
    } catch (e: any) {
      console.error(`   Error: ${e.message}`);
    }
  } else {
    console.log("   Skipped - no quote ID");
  }
  console.log();

  // 10. Natural Language Intent (may fail)
  console.log("10. haiku_natural_language_intent");
  if (balances) {
    try {
      const request = {
        text_prompt: "swap 0.001 ETH for USDC on Arbitrum",
        wallet_positions: balances.wallet_positions,
        prices: balances.prices,
      };
      const response = await client.buildNaturalLanguageIntent(request);
      savePayload("10-natural-language-intent", { request, response });
      console.log(`   Intent parsed successfully`);
    } catch (e: any) {
      savePayload("10-natural-language-intent", {
        request: { text_prompt: "swap 0.001 ETH for USDC on Arbitrum" },
        response: { error: e.message }
      });
      console.error(`   Error: ${e.message}`);
    }
  }
  console.log();

  console.log("=".repeat(60));
  console.log("Done! Browse JSON files in ./qa-payloads/");
  console.log("=".repeat(60));
}

main().catch(console.error);
