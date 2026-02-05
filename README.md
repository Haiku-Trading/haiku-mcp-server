# Haiku MCP Server

An MCP (Model Context Protocol) server that enables AI agents to execute blockchain transactions via the [Haiku API](https://docs.haiku.trade).

## Features

- **Token Discovery**: List supported tokens across 18+ blockchain networks
- **Balance Checking**: Get wallet balances across all supported chains
- **Trading Quotes**: Get quotes for swaps and portfolio rebalancing
- **Transaction Building**: Convert quotes to unsigned EVM transactions
- **Natural Language**: Convert plain English to structured trading intents
- **Simple Swaps**: High-level convenience tool for straightforward token swaps

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

Get a list of supported tokens for trading.

**Parameters:**
- `chainId` (optional): Filter by chain ID (e.g., 42161 for Arbitrum)

**Example:**
```json
{
  "chainId": 42161
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

### `haiku_natural_language_intent`

Convert natural language to a structured trading intent.

**Parameters:**
- `prompt` (required): Natural language instruction
- `walletAddress` (required): Wallet address for balance context

**Example:**
```json
{
  "prompt": "swap all my WETH for USDC",
  "walletAddress": "0x..."
}
```
## Token IID Format

Tokens are identified using the IID format: `chainSlug:tokenAddress`

Examples:
- `arb:0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` - WETH on Arbitrum
- `eth:0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` - Native ETH
- `base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` - USDC on Base

## Supported Chains

| Chain | Chain ID | Slug |
|-------|----------|------|
| Arbitrum | 42161 | arb |
| Base | 8453 | base |
| Ethereum | 1 | eth |
| Polygon | 137 | polygon |
| Optimism | 10 | op |
| BSC | 56 | bsc |
| Avalanche | 43114 | avax |
| And 11 more... | | |

## Workflow Examples

### Simple Swap

```
1. Call haiku_execute_swap with input/output tokens
2. If no Permit2 required: Sign and broadcast the returned transaction
3. If Permit2 required: Sign permit2Datas, then call haiku_solve
```

### Portfolio Rebalance

```
1. Call haiku_get_balances to see current holdings
2. Call haiku_get_quote with multiple target weights
3. Handle any approvals or Permit2 signatures
4. Call haiku_solve to get unsigned transaction
5. Sign and broadcast
```

### Natural Language Trading

```
1. Call haiku_natural_language_intent with prompt like "swap half my ETH to USDC"
2. Use returned intent with haiku_get_quote
3. Complete the quote → solve → sign → broadcast flow
```

## Transaction Signing

This MCP server returns **unsigned transactions only**. The AI agent is responsible for:

1. Signing ERC-20 approval transactions (if needed)
2. Signing Permit2 EIP-712 typed data (if needed)
3. Signing the final transaction
4. Broadcasting to the network

This design keeps private keys secure and allows agents to use any signing method (hardware wallets, custodial services, MPC, etc.).

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
