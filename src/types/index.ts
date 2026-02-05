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
  protocol?: string;
  primaryColor?: string;
  tokenCategory: string;
  url?: string;
}

/**
 * Response from GET /tokenList
 */
export interface TokenListResponse {
  tokenCategories: string[];
  tokens: Token[];
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
 * EIP-712 typed data for Permit2 signing
 */
export interface Permit2Data {
  domain: {
    name: string;
    chainId: number;
    verifyingContract: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
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
  destinationBridge?: Permit2Data;
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
}

/**
 * High-level swap response when Permit2 is required
 */
export interface SwapResponseWithPermit2 {
  success: false;
  requiresPermit2Signature: true;
  quoteId: string;
  permit2Datas: Permit2Data;
  quote: QuoteResponse;
  message: string;
}

/**
 * High-level swap response when no Permit2 needed
 */
export interface SwapResponseWithTransaction {
  success: true;
  requiresPermit2Signature: false;
  quoteId: string;
  quote: QuoteResponse;
  transaction: UnsignedTransaction;
}

export type SwapToolResponse = SwapResponseWithPermit2 | SwapResponseWithTransaction;
