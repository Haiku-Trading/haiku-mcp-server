import type {
  HaikuConfig,
  TokenListResponse,
  TokenBalancesResponse,
  QuoteIntent,
  QuoteResponse,
  SolveRequest,
  UnsignedTransaction,
  NaturalLanguageRequest,
  NaturalLanguageResponse,
} from "../types/index.js";

const DEFAULT_BASE_URL = "https://api.haiku.trade/v1";
const HAIKU_SOURCE_HEADER_VALUE = "haiku-mcp-server/0.0.3";

/**
 * HTTP client for the Haiku API
 */
export class HaikuClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(config: HaikuConfig = {}) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  /**
   * Make a request to the Haiku API
   * If an API key is configured, it will be included for higher rate limits
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Haiku-Source": HAIKU_SOURCE_HEADER_VALUE,
    };

    // Include API key if available (provides higher rate limits)
    if (this.apiKey) {
      headers["api-key"] = this.apiKey;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage: string;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.message || errorJson.error || errorText;
      } catch {
        errorMessage = errorText;
      }
      throw new Error(
        `Haiku API error (${response.status}): ${errorMessage}`
      );
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get list of supported tokens
   * @param chainId - Optional chain ID to filter tokens
   */
  async getTokenList(chainId?: number): Promise<TokenListResponse> {
    const params = chainId ? `?chainId=${chainId}` : "";
    return this.request<TokenListResponse>(`/tokenList${params}`);
  }

  /**
   * Get token balances for a wallet address
   * @param address - Wallet address or ENS name
   */
  async getTokenBalances(address: string): Promise<TokenBalancesResponse> {
    return this.request<TokenBalancesResponse>(
      `/tokenBalances?address=${encodeURIComponent(address)}`
    );
  }

  /**
   * Get a quote for a trading strategy
   * @param intent - The trading intent with input positions and target weights
   */
  async getQuote(intent: QuoteIntent): Promise<QuoteResponse> {
    return this.request<QuoteResponse>("/quote", {
      method: "POST",
      body: JSON.stringify({ intent }),
    });
  }

  /**
   * Convert a quote into an unsigned EVM transaction
   * @param params - Quote ID and optional signatures
   */
  async solve(params: SolveRequest): Promise<UnsignedTransaction> {
    return this.request<UnsignedTransaction>("/solve", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  /**
   * Convert natural language to a structured trading intent
   * @param params - Text prompt and wallet context
   */
  async buildNaturalLanguageIntent(
    params: NaturalLanguageRequest
  ): Promise<NaturalLanguageResponse> {
    return this.request<NaturalLanguageResponse>("/buildIntentNaturalLanguage", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }
}

/**
 * Create a Haiku client from environment variables
 */
export function createHaikuClientFromEnv(): HaikuClient {
  return new HaikuClient({
    apiKey: process.env.HAIKU_API_KEY,
    baseUrl: process.env.HAIKU_BASE_URL,
  });
}
