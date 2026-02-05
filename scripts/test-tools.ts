/**
 * Test script for Haiku MCP Server tools
 *
 * Tests each tool to verify data shapes without signing/executing transactions
 */

import { createHaikuClientFromEnv, HaikuClient } from "../src/api/haiku-client.js";

const TEST_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const NATIVE_ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const USDC_ARB = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

async function main() {
  const client = createHaikuClientFromEnv();

  console.log("=".repeat(60));
  console.log("Haiku MCP Server - Tool Testing");
  console.log("=".repeat(60));
  console.log();

  // Test 1a: Get Tokens (all chains)
  console.log("1a. Testing haiku_get_tokens (all chains)...");
  console.log("-".repeat(40));
  try {
    const response = await client.getTokenList();
    // API returns tokenList.tokens, not just tokens
    const tokens = (response as any).tokenList?.tokens || (response as any).tokens || [];
    console.log(`✓ Returned ${tokens.length} tokens`);
    if (tokens.length > 0) {
      const sample = tokens[0];
      console.log(`  Sample token: ${sample.symbol} (${sample.name})`);
      console.log(`    Chain ID: ${sample.chainId}`);
      console.log(`    Address: ${sample.address}`);
      console.log(`    IID: ${sample.iid}`);
      console.log(`    Price: $${sample.priceUSD}`);
    }
    console.log();
  } catch (e) {
    console.error(`✗ Error: ${e}`);
    console.log();
  }

  // Test 1b: Get Tokens (Arbitrum only)
  console.log("1b. Testing haiku_get_tokens (chainId: 42161 - Arbitrum)...");
  console.log("-".repeat(40));
  try {
    const response = await client.getTokenList(42161);
    const tokens = (response as any).tokenList?.tokens || (response as any).tokens || [];
    console.log(`✓ Returned ${tokens.length} Arbitrum tokens`);
    // Find USDC
    const usdc = tokens.find((t: any) => t.symbol === "USDC");
    if (usdc) {
      console.log(`  Found USDC: ${usdc.iid}`);
    }
    // Find native ETH
    const eth = tokens.find((t: any) => t.address.toLowerCase() === NATIVE_ETH);
    if (eth) {
      console.log(`  Found native ETH: ${eth.iid}`);
    }
    console.log();
  } catch (e) {
    console.error(`✗ Error: ${e}`);
    console.log();
  }

  // Test 2: Get Balances
  console.log("2. Testing haiku_get_balances...");
  console.log("-".repeat(40));
  let balances: any;
  try {
    balances = await client.getTokenBalances(TEST_WALLET);
    console.log(`✓ Wallet: ${TEST_WALLET}`);

    const positionCount = Object.keys(balances.wallet_positions || {}).length;
    const priceCount = Object.keys(balances.prices || {}).length;

    console.log(`  Positions: ${positionCount}`);
    console.log(`  Prices: ${priceCount}`);

    // Calculate total USD value
    let totalUSD = 0;
    for (const [token, amount] of Object.entries(balances.wallet_positions || {})) {
      const price = parseFloat(balances.prices?.[token] || "0");
      const bal = parseFloat(amount as string);
      totalUSD += bal * price;
    }
    console.log(`  Estimated Total: ~$${totalUSD.toFixed(2)}`);

    // Show a few positions
    const positions = Object.entries(balances.wallet_positions || {}).slice(0, 3);
    console.log(`  Sample positions:`);
    for (const [token, amount] of positions) {
      const price = balances.prices?.[token] || "0";
      console.log(`    ${token}: ${amount} @ $${price}`);
    }
    console.log();
  } catch (e) {
    console.error(`✗ Error: ${e}`);
    console.log();
  }

  // Test 3: Get Quote (using native ETH to avoid Permit2)
  console.log("3. Testing haiku_get_quote (native ETH -> USDC on Arbitrum)...");
  console.log("-".repeat(40));
  let quoteId: string | undefined;
  let requiresPermit2 = false;
  try {
    const quote = await client.getQuote({
      inputPositions: {
        [`arb:${NATIVE_ETH}`]: "0.0001"
      },
      targetWeights: {
        [`arb:${USDC_ARB}`]: 1
      },
      slippage: 0.003,
      receiver: TEST_WALLET,
    });

    quoteId = quote.quoteId;
    requiresPermit2 = !!(quote as any).permit2Datas;

    console.log(`✓ Quote received`);
    console.log(`  Quote ID: ${quote.quoteId}`);
    console.log(`  Requires Permit2: ${requiresPermit2}`);
    console.log(`  Approvals needed: ${quote.approvals?.length || 0}`);
    console.log(`  Is complex bridge: ${quote.isComplexBridge}`);
    console.log(`  Gas estimate: ${quote.gas?.amount} (~$${quote.gas?.usd || quote.gas?.amountUSD})`);

    // Show funds/balances
    if ((quote as any).funds) {
      console.log(`  Input funds:`);
      for (const fund of (quote as any).funds) {
        console.log(`    ${fund.token?.symbol || fund.token}: ${fund.amount} (~$${fund.amountUSD})`);
      }
    }
    if ((quote as any).balances) {
      console.log(`  Expected output:`);
      for (const bal of (quote as any).balances) {
        console.log(`    ${bal.token?.symbol || bal.token}: ${bal.amount} (min: ${bal.amountMin})`);
      }
    }
    console.log();
  } catch (e) {
    console.error(`✗ Error: ${e}`);
    console.log();
  }

  // Test 4: Solve (build unsigned transaction)
  console.log("4. Testing haiku_solve...");
  console.log("-".repeat(40));
  if (quoteId && !requiresPermit2) {
    try {
      const tx = await client.solve({ quoteId: quoteId });
      console.log(`✓ Unsigned transaction received`);
      console.log(`  To: ${tx.to}`);
      console.log(`  Value: ${tx.value} wei`);
      console.log(`  Data length: ${tx.data?.length || 0} chars`);
      console.log(`  Data preview: ${tx.data?.substring(0, 66)}...`);
      console.log();
      console.log(`  This transaction is ready to be signed and broadcast!`);
    } catch (e) {
      console.error(`✗ Error: ${e}`);
    }
  } else if (requiresPermit2) {
    console.log(`⚠ Skipping solve - would require Permit2 signature first`);
  } else {
    console.log(`⚠ Skipping solve - no quote ID available from previous steps`);
  }

  console.log();
  console.log("=".repeat(60));
  console.log("Testing complete!");
  console.log("=".repeat(60));
  console.log();
  console.log("Summary:");
  console.log("- Token list: Returns tokens with chainId, address, iid, price, etc.");
  console.log("- Balances: Returns wallet_positions and prices maps");
  console.log("- Quote: Returns quoteId, funds, balances, approvals, gas");
  console.log("- Solve: Returns unsigned tx {to, data, value}");
  console.log();
  console.log("Native ETH input avoids Permit2 requirement - ideal for simple swaps.");
}

main().catch(console.error);
