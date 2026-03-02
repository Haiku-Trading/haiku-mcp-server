# Haiku MCP Server

An MCP (Model Context Protocol) server that enables AI agents to execute blockchain transactions via the [Haiku API](https://docs.haiku.trade).

[![npm version](https://badge.fury.io/js/haiku-mcp-server.svg)](https://www.npmjs.com/package/haiku-mcp-server)
[![GitHub](https://img.shields.io/badge/GitHub-Haiku--Trading%2Fhaiku--mcp--server-blue)](https://github.com/Haiku-Trading/haiku-mcp-server)

## Features

- **Token Discovery**: List supported tokens and DeFi assets across 21 blockchain networks
- **Balance Checking**: Get wallet balances across all supported chains
- **Trading Quotes**: Get quotes for swaps and portfolio rebalancing
- **Transaction Building**: Convert quotes to unsigned EVM transactions
- **Wallet Integration**: Extract EIP-712 payloads for external wallet signing (Coinbase, AgentKit, Safe, etc.)
- **Self-Contained Execution**: Optional end-to-end execution with WALLET_PRIVATE_KEY env var
- **Yield Discovery**: Find the highest-yielding DeFi opportunities across protocols and chains, filtered by APY, TVL, and category
- **Portfolio Analysis**: Analyze a wallet's holdings and surface context-specific yield opportunities based on what it actually holds

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
| `WALLET_PRIVATE_KEY` | No | Private key (0x hex) for self-contained execution via `haiku_execute`. |
| `RPC_URL_{chainId}` | No | Override RPC URL for a specific chain (e.g., `RPC_URL_42161` for Arbitrum). |

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

> **Note:** Quotes expire after ~30 seconds. If `haiku_execute` returns a quote-expired error, request a fresh quote and retry the flow.

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

### `haiku_prepare_signatures`

Extract and normalize EIP-712 signing payloads from a quote for external wallet signing (Path B only).

Use this when a wallet MCP handles signing (Coinbase Payments MCP, wallet-agent, AgentKit, Safe, etc.). Returns standardized typed data that any wallet's `signTypedData` can consume, plus step-by-step instructions.

**Parameters:**
- `quoteId` (preferred): Quote ID from `haiku_get_quote` — server resolves the full quote from session cache
- `quoteResponse` (fallback): Full response object from `haiku_get_quote`, if quoteId is unavailable

**Returns:**
- `requiresPermit2`: Whether Permit2 signature is needed
- `permit2`: EIP-712 payload to pass to `signTypedData` (if required)
- `requiresBridgeSignature`: Whether bridge signature is needed
- `bridgeIntent`: EIP-712 payload to pass to `signTypedData` (if required)
- `sourceChainId`: Chain ID for the transaction
- `instructions`: Step-by-step instructions for completing the flow

**Example:**
```json
{
  "quoteId": "abc123..."
}
```

### `haiku_discover_yields`

Discover yield-bearing opportunities across DeFi protocols, ranked by APY or TVL.

Use this to answer questions like "best lending yields on Arbitrum", "highest APY vaults
with at least $1M TVL", or "what can I do with USDC on Base". The `iid` field in results
can be used directly as a `targetWeight` key in `haiku_get_quote`.

**Parameters:**
- `chainId` (optional): Filter by chain ID (e.g., 42161 for Arbitrum)
- `category` (optional): `lending` (Aave collateral), `vault` (Yearn/Morpho), `lp` (Balancer/Uniswap), `all` (default)
- `minApy` (optional): Minimum APY as a percentage (e.g., `5` means ≥5% APY)
- `minTvl` (optional): Minimum TVL in USD (e.g., `1000000` means ≥$1M). Filters to established mainstream vaults.
- `sortBy` (optional): `apy` (default) or `tvl`, descending
- `limit` (optional): Max results (default 20)

**Example:**
```json
{
  "chainId": 42161,
  "category": "lending",
  "minTvl": 1000000,
  "sortBy": "apy",
  "limit": 10
}
```

### `haiku_analyze_portfolio`

Analyze a wallet's DeFi portfolio and surface relevant yield opportunities.

Returns current positions enriched with available APY options, collateral health factors,
and context-specific opportunities based on what the wallet actually holds. Pair with
`haiku_discover_yields` for broader market context, then use `haiku_get_quote` to execute.

**Parameters:**
- `walletAddress` (required): Wallet address (0x...) to analyze

**Example:**
```json
{
  "walletAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
}
```

### `haiku_execute`

Execute a quote. Two distinct paths depending on who holds the private key.

**Path A — Self-contained** (`WALLET_PRIVATE_KEY` set in env): Haiku signs Permit2/bridge payloads internally and broadcasts. Returns a tx hash.

**Parameters:**
- `quoteId` (required): Quote ID from `haiku_get_quote`
- `sourceChainId` (required): Chain ID from the quote response
- `permit2SigningPayload` (optional): Pass through from `haiku_get_quote` if present
- `bridgeSigningPayload` (optional): Pass through from `haiku_get_quote` if present (cross-chain only)
- `approvals` (optional): Pass through from `haiku_get_quote` if present

**Example:**
```json
{
  "quoteId": "abc123...",
  "sourceChainId": 42161,
  "permit2SigningPayload": { /* from haiku_get_quote, if present */ },
  "approvals": [ /* from haiku_get_quote, if present */ ]
}
```

---

**Path B — External wallet** (no `WALLET_PRIVATE_KEY`, using a wallet MCP): You sign and broadcast. Set `broadcast: false` — haiku returns `{to, data, value}` for you to broadcast.

Pre-requisite: if the quote requires Permit2 or bridge signatures, call `haiku_prepare_signatures` first, sign via your wallet MCP, then pass the signatures here.

**Parameters:**
- `quoteId` (required): Quote ID from `haiku_get_quote`
- `sourceChainId` (required): Chain ID from the quote response
- `broadcast` (required): Set to `false` to return unsigned tx instead of broadcasting
- `permit2Signature` (optional): Signature from signing the Permit2 payload via your wallet MCP
- `userSignature` (optional): Signature from signing the bridge payload via your wallet MCP (cross-chain only)
- `approvals` (optional): Pass through from `haiku_get_quote` if present — handle these via your wallet MCP before calling haiku_execute

**Example:**
```json
{
  "quoteId": "abc123...",
  "sourceChainId": 42161,
  "broadcast": false,
  "permit2Signature": "0x...",
  "approvals": [ /* from haiku_get_quote, if present */ ]
}
```
Returns `{ to, data, value }` — broadcast this via your wallet MCP.

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

### Path A: Self-Contained Swap (WALLET_PRIVATE_KEY set)

Haiku handles all signing and broadcasting. Returns a tx hash.

```
1. haiku_get_quote → returns quoteId, sourceChainId, permit2SigningPayload?, bridgeSigningPayload?, approvals?
2. haiku_execute(quoteId, sourceChainId, permit2SigningPayload?, bridgeSigningPayload?, approvals?)
   → Haiku signs Permit2/bridge internally, broadcasts, returns tx hash
```

### Path B: External Wallet (wallet MCP handles signing + broadcasting)

Use when WALLET_PRIVATE_KEY is not set and a separate wallet MCP holds the keys.

**Simple swap (no Permit2 or bridge signatures needed, e.g. native ETH input):**
```
1. haiku_get_quote → returns quoteId, sourceChainId, approvals?
2. Handle approvals via wallet MCP if present
3. haiku_execute(quoteId, sourceChainId, broadcast: false)
   → returns { to, data, value }
4. Broadcast { to, data, value } via wallet MCP
```

**With Permit2 or bridge signatures (e.g. ERC-20 input or cross-chain swap):**
```
1. haiku_get_quote → returns quoteId, sourceChainId, permit2Datas?, destinationBridge?, approvals?
2. haiku_prepare_signatures(quoteId) → returns normalized EIP-712 payloads + instructions
3. Sign payloads via wallet MCP (e.g. coinbase_sign_typed_data) → get permit2Signature?, userSignature?
4. Handle approvals via wallet MCP if present
5. haiku_execute(quoteId, sourceChainId, permit2Signature?, userSignature?, approvals?, broadcast: false)
   → returns { to, data, value }
6. Broadcast { to, data, value } via wallet MCP (e.g. coinbase_send_transaction)
```

### Yield Discovery

```
1. haiku_discover_yields with category/chain/minTvl filters → find opportunities, note iid
2. haiku_get_quote with the chosen iid as a targetWeight
3. Execute via Path A or Path B above
```

### Portfolio Analysis & Optimization

```
1. haiku_analyze_portfolio with wallet address → review positions and opportunities
2. Optionally haiku_discover_yields for broader market context
3. haiku_get_quote to rebalance into higher-yielding positions
4. Execute via Path A or Path B above
```

## Transaction Signing

Two modes depending on your setup:

**Self-contained** (`WALLET_PRIVATE_KEY` set): `haiku_execute` signs everything internally and broadcasts. Returns a tx hash. No external signing needed.

**External wallet** (no `WALLET_PRIVATE_KEY`): The AI agent is responsible for signing and broadcasting. Use `haiku_execute` with `broadcast: false` to get an unsigned `{to, data, value}` transaction, then broadcast it via your wallet MCP. If Permit2 or bridge signatures are required, call `haiku_prepare_signatures` first to get normalized EIP-712 payloads, sign via your wallet MCP, and pass the signatures to `haiku_execute`.

The external wallet design allows agents to use any signing infrastructure (wallet MCPs, hardware wallets, custodial services, MPC, etc.).

## Cross-Chain Bridge Signatures

For cross-chain swaps, the quote may return `isComplexBridge: true`, indicating a bridge intent signature is required in addition to (or instead of) Permit2.

**Self-contained (Path A):** Pass `bridgeSigningPayload` from the quote to `haiku_execute` — it handles the bridge signature internally.

**External wallet (Path B):** Call `haiku_prepare_signatures` with the quoteId — it returns a normalized `bridgeIntent` EIP-712 payload. Sign it via your wallet MCP and pass the result as `userSignature` to `haiku_execute`.

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
