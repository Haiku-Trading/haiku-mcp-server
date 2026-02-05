# Haiku MCP Server

An MCP (Model Context Protocol) server that enables AI agents to execute blockchain transactions via the [Haiku API](https://docs.haiku.trade).

[![npm version](https://badge.fury.io/js/haiku-mcp-server.svg)](https://www.npmjs.com/package/haiku-mcp-server)
[![GitHub](https://img.shields.io/badge/GitHub-Haiku--Trading%2Fhaiku--mcp--server-blue)](https://github.com/Haiku-Trading/haiku-mcp-server)

## Features

- **Token Discovery**: List supported tokens and DeFi assets across 21 blockchain networks
- **Balance Checking**: Get wallet balances across all supported chains
- **Trading Quotes**: Get quotes for swaps and portfolio rebalancing
- **Transaction Building**: Convert quotes to unsigned EVM transactions

## Installation

```bash
npm install haiku-mcp-server
```

Or run directly with npx:

```bash
npx haiku-mcp-server
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `HAIKU_API_KEY` | No | Your Haiku API key for higher rate limits. Contact contact@haiku.trade to request one. |
| `HAIKU_BASE_URL` | No | API base URL. Defaults to `https://api.haiku.trade/v1` |

> **Note:** The API works without a key, but providing one unlocks higher rate limits for production use.

### Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "haiku": {
      "command": "npx",
      "args": ["haiku-mcp-server"]
    }
  }
}
```

With API key for higher rate limits:

```json
{
  "mcpServers": {
    "haiku": {
      "command": "npx",
      "args": ["haiku-mcp-server"],
      "env": {
        "HAIKU_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Available Tools

### `haiku_get_tokens`

Get supported tokens and DeFi assets for trading.

**Parameters:**
- `chainId` (optional): Filter by chain ID (e.g., 42161 for Arbitrum)
- `category` (optional): Filter by token category:
  - `token` - Vanilla tokens (ETH, USDC, etc.)
  - `collateral` - eg. Aave aTokens (deposited collateral)
  - `varDebt` - eg. Aave variable debt tokens
  - `vault` - eg. Yearn/Morpho yield vaults
  - `weightedLiquidity` - eg. Balancer LP tokens
  - `concentratedLiquidity` - eg. Uniswap V3 LP positions

**Example:**
```json
{
  "chainId": 42161,
  "category": "token"
}
```

### `haiku_get_balances`

Get token balances for a wallet address across all chains.

**Parameters:**
- `walletAddress` (required): Wallet address or ENS name

**Example:**
```json
{
  "walletAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
}
```

### `haiku_get_quote`

Get a quote for a token swap or portfolio rebalance.

> **Note:** Quotes expire after ~30 seconds. If `haiku_solve` returns error 200000 (quote expired), request a fresh quote and retry the flow.

**Parameters:**
- `inputPositions` (required): Map of token IID to amount to spend
- `targetWeights` (required): Map of output token IID to weight (must sum to 1)
- `slippage` (optional): Max slippage as decimal (default: 0.003)
- `receiver` (optional): Receiving wallet address

**Example:**
```json
{
  "inputPositions": {
    "arb:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1": "1.0"
  },
  "targetWeights": {
    "arb:0xaf88d065e77c8cC2239327C5EDb3A432268e5831": 0.5,
    "arb:0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9": 0.5
  },
  "slippage": 0.005
}
```

### `haiku_solve`

Convert a quote into an unsigned EVM transaction.

**Parameters:**
- `quoteId` (required): Quote ID from `haiku_get_quote`
- `permit2Signature` (optional): Signature if Permit2 was required
- `userSignature` (optional): Signature if complex bridge was required

**Example:**
```json
{
  "quoteId": "abc123...",
  "permit2Signature": "0x..."
}
```

## Token IID Format

Tokens are identified using the IID format: `chainSlug:tokenAddress`

Examples:
- `arb:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` - WETH on Arbitrum
- `arb:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` - Native ETH on Arbitrum
- `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` - USDC on Base

## Supported Chains

| Chain | Chain ID | Slug |
|-------|----------|------|
| Arbitrum | 42161 | arb |
| Avalanche | 43114 | avax |
| Base | 8453 | base |
| Berachain | 80094 | bera |
| BNB Smart Chain | 56 | bsc |
| Bob | 60808 | bob |
| Ethereum | 1 | eth |
| Gnosis | 100 | gnosis |
| Hyperliquid | 999 | hype |
| Katana | 747474 | katana |
| Lisk | 1135 | lisk |
| Monad | 143 | monad |
| Optimism | 10 | opt |
| Plasma | 9745 | plasma |
| Polygon | 137 | poly |
| Scroll | 534352 | scroll |
| Sei | 1329 | sei |
| Sonic | 146 | sonic |
| Unichain | 130 | uni |
| World Chain | 480 | worldchain |
| ApeChain | 33139 | ape |

## Workflow Examples

### Simple Swap

```
1. Call haiku_get_quote with input tokens and target outputs
2. If permit2Datas returned: Sign the EIP-712 typed data
3. Call haiku_solve with quoteId (and permit2Signature if needed)
4. Sign and broadcast the returned transaction
```

### Portfolio Rebalance

```
1. Call haiku_get_balances to see current holdings
2. Call haiku_get_quote with multiple target weights
3. Handle any approvals or Permit2 signatures
4. Call haiku_solve to get unsigned transaction
5. Sign and broadcast
```

## Transaction Signing

This MCP server returns **unsigned transactions only**. The AI agent is responsible for:

1. Signing ERC-20 approval transactions (if needed)
2. Signing Permit2 EIP-712 typed data (if needed)
3. Signing the final transaction
4. Broadcasting to the network

This design keeps private keys secure and allows agents to use any signing method (hardware wallets, custodial services, MPC, etc.).

## Cross-Chain Bridge Signatures

For cross-chain swaps, the quote may return `isComplexBridge: true` with a `destinationBridge` object.

**When it's needed:** Check `quote.isComplexBridge === true`

**What to sign:** `quote.destinationBridge.unsignedTypeV4Digest` (EIP-712 typed data)

**Workflow:**
1. Get quote with `haiku_get_quote`
2. If `isComplexBridge` is true:
   - Sign the `destinationBridge.unsignedTypeV4Digest` typed data
   - Pass the signature as `userSignature` to `haiku_solve`
3. Sign and broadcast the returned transaction

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run locally (works without API key)
npm start

# Run with API key for higher rate limits
HAIKU_API_KEY=your-key npm start
```

## License

MIT
