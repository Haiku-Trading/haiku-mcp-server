import { z } from "zod";
import type { HaikuClient } from "../api/haiku-client.js";
import type { Token } from "../types/index.js";
import { getEffectiveApy, getTvl } from "./yields.js";

export const analyzePortfolioSchema = z.object({
  walletAddress: z
    .string()
    .describe("Wallet address (0x...) to analyze"),
});

export type AnalyzePortfolioParams = z.infer<typeof analyzePortfolioSchema>;

interface YieldOpportunity {
  iid: string;
  protocol?: string;
  apy: number;
  tvl?: number;
  max_ltv?: number;
}

interface PortfolioPosition {
  iid: string;
  symbol: string;
  category: string;
  balance: string;
  valueUSD: string;
  currentApy?: number;
  yieldOpportunities?: YieldOpportunity[];
}

interface TokenAtRisk {
  iid: string;
  symbol: string;
  liquidation_threshold: number;
}

interface CollateralHealth {
  collateralValueUSD: string;
  debtValueUSD: string;
  healthFactor: number;
  tokensAtRisk: TokenAtRisk[];
}

/**
 * Handle haiku_analyze_portfolio tool call
 */
export async function handleAnalyzePortfolio(
  client: HaikuClient,
  params: AnalyzePortfolioParams
) {
  const [balancesResponse, tokenListResponse] = await Promise.all([
    client.getTokenBalances(params.walletAddress),
    client.getTokenList(),
  ]);

  const { wallet_positions, prices, categorised_wallet_positions } =
    balancesResponse;
  const { tokenList } = tokenListResponse;

  // Build iid → Token lookup map across all categories
  const tokenMap = new Map<string, Token & { _category: string }>();
  for (const t of tokenList.tokens ?? []) tokenMap.set(t.iid, { ...t, _category: "token" });
  for (const t of tokenList.collateralTokens ?? []) tokenMap.set(t.iid, { ...t, _category: "lending" });
  for (const t of tokenList.varDebtTokens ?? []) tokenMap.set(t.iid, { ...t, _category: "debt" });
  for (const t of tokenList.vaultTokens ?? []) tokenMap.set(t.iid, { ...t, _category: "vault" });
  for (const t of tokenList.weightedLiquidityTokens ?? []) tokenMap.set(t.iid, { ...t, _category: "lp" });
  for (const t of tokenList.concentratedLiquidityTokens ?? []) tokenMap.set(t.iid, { ...t, _category: "lp" });

  // Build underlying_iid → [yield tokens] map for opportunity matching
  // A plain token can have lending/vault equivalents based on underlying_iid
  const yieldByUnderlying = new Map<string, Array<Token & { _yieldCat: string }>>();
  const addYield = (tokens: Token[], cat: string) => {
    for (const t of tokens) {
      if (t.underlying_iid) {
        const list = yieldByUnderlying.get(t.underlying_iid) ?? [];
        list.push({ ...t, _yieldCat: cat });
        yieldByUnderlying.set(t.underlying_iid, list);
      }
    }
  };
  addYield(tokenList.collateralTokens ?? [], "lending");
  addYield(tokenList.vaultTokens ?? [], "vault");

  // Build portfolio positions
  let totalValueUSD = 0;
  const positions: PortfolioPosition[] = [];

  const {
    token_positions,
    collateral_positions,
    debt_positions,
    vault_positions,
  } = categorised_wallet_positions;

  const processPosition = (
    iid: string,
    balance: string,
    overrideCategory?: string
  ) => {
    const balanceNum = parseFloat(balance);
    if (isNaN(balanceNum) || balanceNum <= 0) return;

    const price = prices[iid];
    if (!price) return;

    const valueUSD = balanceNum * parseFloat(price);
    totalValueUSD += valueUSD;

    const token = tokenMap.get(iid);
    const category = overrideCategory ?? token?._category ?? "token";
    const symbol = token?.symbol ?? iid.split(":")[1]?.slice(0, 8) ?? iid;

    const position: PortfolioPosition = {
      iid,
      symbol,
      category,
      balance,
      valueUSD: valueUSD.toFixed(2),
    };

    // For yield-bearing positions, show current APY
    if (token && (category === "lending" || category === "vault" || category === "lp")) {
      const apy = getEffectiveApy(token);
      if (apy > 0) position.currentApy = apy;
    }

    // For plain tokens, find yield opportunities on the same chain
    if (category === "token" && token) {
      const opportunities = yieldByUnderlying.get(iid) ?? [];
      const chainOpportunities = opportunities
        .filter((o) => o.chainId === token.chainId)
        .map((o): YieldOpportunity => ({
          iid: o.iid,
          ...(o.protocol && { protocol: o.protocol }),
          apy: getEffectiveApy(o),
          ...(getTvl(o) > 0 && { tvl: getTvl(o) }),
          ...(o.max_ltv !== undefined && { max_ltv: o.max_ltv }),
        }))
        .filter((o) => o.apy > 0)
        .sort((a, b) => b.apy - a.apy)
        .slice(0, 5);

      if (chainOpportunities.length > 0) {
        position.yieldOpportunities = chainOpportunities;
      }
    }

    positions.push(position);
  };

  for (const [iid, bal] of Object.entries(token_positions ?? {})) {
    processPosition(iid, bal, "token");
  }
  for (const [iid, bal] of Object.entries(collateral_positions ?? {})) {
    processPosition(iid, bal, "lending");
  }
  for (const [iid, bal] of Object.entries(debt_positions ?? {})) {
    processPosition(iid, bal, "debt");
  }
  for (const [iid, bal] of Object.entries(vault_positions ?? {})) {
    processPosition(iid, bal, "vault");
  }

  // Sort positions by USD value descending
  positions.sort((a, b) => parseFloat(b.valueUSD) - parseFloat(a.valueUSD));

  // Compute collateral health factor if there are both collateral and debt positions
  let collateralHealth: CollateralHealth | undefined;
  const collateralEntries = Object.entries(collateral_positions ?? {});
  const debtEntries = Object.entries(debt_positions ?? {});

  if (collateralEntries.length > 0 && debtEntries.length > 0) {
    let weightedCollateral = 0;
    let totalDebt = 0;
    const tokensAtRisk: TokenAtRisk[] = [];

    for (const [iid, bal] of collateralEntries) {
      const balNum = parseFloat(bal);
      const price = prices[iid];
      if (!price || isNaN(balNum) || balNum <= 0) continue;

      const token = tokenMap.get(iid);
      const threshold = token?.liquidation_threshold ?? 0.8;
      const valueUSD = balNum * parseFloat(price);
      weightedCollateral += valueUSD * threshold;

      if (token && token.liquidation_threshold !== undefined) {
        tokensAtRisk.push({
          iid,
          symbol: token.symbol,
          liquidation_threshold: token.liquidation_threshold,
        });
      }
    }

    for (const [iid, bal] of debtEntries) {
      const balNum = parseFloat(bal);
      const price = prices[iid];
      if (!price || isNaN(balNum) || balNum <= 0) continue;
      totalDebt += balNum * parseFloat(price);
    }

    if (totalDebt > 0) {
      const totalCollateralUSD = collateralEntries.reduce((sum, [iid, bal]) => {
        const price = prices[iid];
        return sum + (price ? parseFloat(bal) * parseFloat(price) : 0);
      }, 0);

      collateralHealth = {
        collateralValueUSD: totalCollateralUSD.toFixed(2),
        debtValueUSD: totalDebt.toFixed(2),
        healthFactor: parseFloat((weightedCollateral / totalDebt).toFixed(4)),
        tokensAtRisk,
      };
    }
  }

  // Build plain-English summary
  const positionCount = positions.length;
  const yieldPositions = positions.filter((p) => p.currentApy !== undefined);
  const opportunityPositions = positions.filter(
    (p) => (p.yieldOpportunities?.length ?? 0) > 0
  );

  let summary = `Wallet holds ${positionCount} position(s) worth $${totalValueUSD.toFixed(2)} USD total.`;

  if (yieldPositions.length > 0) {
    const avgApy =
      yieldPositions.reduce((s, p) => s + (p.currentApy ?? 0), 0) /
      yieldPositions.length;
    summary += ` ${yieldPositions.length} yield-bearing position(s) with avg ${avgApy.toFixed(1)}% APY.`;
  }

  if (opportunityPositions.length > 0) {
    summary += ` ${opportunityPositions.length} plain token(s) have yield opportunities available.`;
    const bestOp = opportunityPositions
      .flatMap((p) => p.yieldOpportunities ?? [])
      .sort((a, b) => b.apy - a.apy)[0];
    if (bestOp) {
      const t = tokenMap.get(bestOp.iid);
      summary += ` Best opportunity: ${t?.symbol ?? bestOp.iid} at ${bestOp.apy.toFixed(2)}% APY — use its iid as targetWeight in haiku_get_quote.`;
    }
  }

  if (collateralHealth) {
    const hf = collateralHealth.healthFactor;
    const hfLabel = hf < 1.1 ? " ⚠️ CRITICAL" : hf < 1.5 ? " ⚠️ LOW" : "";
    summary += ` Collateral health factor: ${hf.toFixed(2)}${hfLabel}.`;
  }

  return {
    walletAddress: params.walletAddress,
    totalValueUSD: totalValueUSD.toFixed(2),
    positions,
    ...(collateralHealth && { collateralHealth }),
    summary,
  };
}
