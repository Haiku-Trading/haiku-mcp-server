// Haiku API Types

/**
 * Token identifier format: chainSlug:tokenAddress
 * e.g., "arb:0xaf88d065e77c8cC2239327C5EDb3A432268e5831" for USDC on Arbitrum
 */
export type TokenIID = string;

/**
 * Token information returned by /tokenList
 */
export interface Token {
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  priceUSD: string;
  logoURI?: string;
  iid: TokenIID;
  protocol?: string;           // "AAVE_V3", "MORPHO", "BALANCER_V2", "UNISWAP_V3"
  primaryColor?: string;
  tokenCategory: string;
  url?: string;

  // DeFi common fields
  underlying_iid?: string;     // Single underlying (collateral, debt, vault)
  underlying_iids?: string[];  // Multiple underlyings (LP tokens)

  // Collateral-specific (Aave)
  max_ltv?: number;            // Max loan-to-value ratio (e.g., 0.63)
  liquidation_threshold?: number;  // Liquidation threshold (e.g., 0.77)
  liquidation_penalty?: number;    // Liquidation penalty (e.g., 0.05)

  // Debt-specific (Aave)
  reserve_factor?: number;     // Reserve factor (e.g., 0.25)

  // Yield fields — all APY values are percentage numbers (e.g. 5.64 means 5.64% APY)
  apy?: number;                // APY as percentage number (collateral/debt)
  minApy?: number;             // Min APY as percentage number (vaults, LP)
  maxApy?: number;             // Max APY as percentage number (vaults, LP)

  // LP-specific
  weights?: number[];          // Pool weights (weighted LP)
  feeTier?: number;            // Fee tier (concentrated LP, e.g., 0.05)
  poolId?: string;             // Pool identifier

  // Metadata (nested)
  metadata?: {
    tvl?: string | number;
    volume24h?: number;
  };
}

/**
 * Response from GET /tokenList
 */
export interface TokenListResponse {
  tokenCategories: string[];
  tokenList: {
    tokens: Token[];
    collateralTokens: Token[];
    varDebtTokens: Token[];
    vaultTokens: Token[];
    weightedLiquidityTokens: Token[];
    concentratedLiquidityTokens: Token[];
  };
}

/**
 * Response from GET /tokenBalances
 */
export interface TokenBalancesResponse {
  wallet_positions: Record<TokenIID, string>;
  prices: Record<TokenIID, string>;
  categorised_wallet_positions: {
    token_positions: Record<TokenIID, string>;
    collateral_positions: Record<TokenIID, string>;
    debt_positions: Record<TokenIID, string>;
    vault_positions: Record<TokenIID, string>;
  };
}

/**
 * Intent object for quote request
 */
export interface QuoteIntent {
  inputPositions: Record<TokenIID, string>;
  targetWeights: Record<TokenIID, number>;
  slippage?: number;
  receiver?: string;
}

/**
 * Request body for POST /quote
 */
export interface QuoteRequest {
  intent: QuoteIntent;
}

/**
 * Standardized EIP-712 signing payload
 * Compatible with any wallet that supports signTypedData
 */
export interface SigningPayload {
  /** EIP-712 domain separator */
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
  };
  /** EIP-712 type definitions */
  types: Record<string, Array<{ name: string; type: string }>>;
  /** The primary type to sign */
  primaryType: string;
  /** The message/values to sign */
  message: Record<string, any>;
}

/**
 * EIP-712 typed data for Permit2 signing
 */
export interface Permit2Data {
  domain: {
    name: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType?: string;
  values?: Record<string, unknown>;
  message?: Record<string, unknown>;
}

/**
 * Destination bridge data for complex cross-chain routes
 */
export interface DestinationBridge {
  unsignedTypeV4Digest?: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType?: string;
    values?: Record<string, unknown>;
  };
  tokenIn?: { token: Record<string, unknown>; amount: string };
  tokenOut?: { token: Record<string, unknown>; amount: string };
  chainId?: number;
  executionBatchDetails?: Record<string, unknown>;
  protocol?: string;
  estimatedFee?: number;
}

/**
 * ERC-20 approval transaction
 */
export interface ApprovalTransaction {
  to: string;
  data: string;
  value: string;
}

/**
 * Gas estimation
 */
export interface GasEstimate {
  amount: string;
  amountUSD: string;
}

/**
 * Intent object returned by the API inside a quote response
 */
export interface IntentResponse {
  sourceChainId: number;
  permit2Datas?: any[];
  typedData?: any;
  [key: string]: any;
}

/**
 * Response from POST /quote
 */
export interface QuoteResponse {
  quoteId: string;
  funds: Array<{
    token: TokenIID;
    amount: string;
  }>;
  fees: Array<{
    token: TokenIID;
    amount: string;
  }>;
  balances: Array<{
    token: TokenIID;
    amount: string;
  }>;
  approvals: ApprovalTransaction[];
  permit2Datas?: Permit2Data;
  isComplexBridge: boolean;
  destinationBridge?: DestinationBridge;
  gas: GasEstimate;
}

/**
 * Request body for POST /solve
 */
export interface SolveRequest {
  quoteId: string;
  permit2Signature?: string;
  userSignature?: string;
}

/**
 * Unsigned EVM transaction returned by POST /solve
 */
export interface UnsignedTransaction {
  to: string;
  data: string;
  value: string;
}

/**
 * Request body for POST /buildIntentNaturalLanguage
 */
export interface NaturalLanguageRequest {
  text_prompt: string;
  wallet_positions: Record<TokenIID, string>;
  prices: Record<TokenIID, string>;
}

/**
 * Response from POST /buildIntentNaturalLanguage
 */
export interface NaturalLanguageResponse {
  intent: QuoteIntent;
}

/**
 * Haiku API configuration
 */
export interface HaikuConfig {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * API error response
 */
export interface HaikuApiError {
  error: string;
  message: string;
  statusCode: number;
}

// MCP Tool Response Types

/**
 * Enhanced quote response for MCP tool
 */
export interface QuoteToolResponse extends QuoteResponse {
  requiresPermit2Signature: boolean;
  requiresBridgeSignature: boolean;
  permit2SigningPayload?: SigningPayload;
  bridgeSigningPayload?: SigningPayload;
}
