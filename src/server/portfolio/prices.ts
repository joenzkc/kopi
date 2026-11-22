import { db, getSetting } from '../db';
import { computeEffectiveTrancheStatus, daysBetweenIso } from '../../shared/rsu';
import type {
  EnrichedHolding,
  EnrichedRsuGrant,
  EnrichedRsuTranche,
  HoldingRecord,
  PortfolioResponse,
  RsuSummary,
  RsuTrancheRecord,
  RsuYearBreakdown,
  UpcomingRsuVest,
} from '../../shared/types';

interface QuoteResult {
  price: number;
  change24hPct: number | null;
  currency: string;
  name?: string;
  fetchedAt: string;
  stale: boolean;
}

const QUOTE_TTL_MS = 30_000;
const REFRESH_FLOOR_MS = 5_000;
const FX_TTL_MS = 10 * 60 * 1000;

const inflightYahoo = new Map<string, Promise<QuoteResult | null>>();

function getCachedQuote(cacheKey: string): QuoteResult | null {
  const row = db
    .query<
      { price: number; change_24h_pct: number | null; currency: string; name: string | null; fetched_at: string },
      [string]
    >('SELECT price, change_24h_pct, currency, name, fetched_at FROM price_cache WHERE cache_key = ?')
    .get(cacheKey);
  if (!row) return null;
  return {
    price: row.price,
    change24hPct: row.change_24h_pct,
    currency: row.currency,
    name: row.name ?? undefined,
    fetchedAt: row.fetched_at,
    stale: false,
  };
}

function saveCachedQuote(cacheKey: string, q: Omit<QuoteResult, 'stale'>): void {
  db.query(
    `INSERT INTO price_cache (cache_key, price, change_24h_pct, currency, name, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       price = excluded.price,
       change_24h_pct = excluded.change_24h_pct,
       currency = excluded.currency,
       name = excluded.name,
       fetched_at = excluded.fetched_at`,
  ).run(cacheKey, q.price, q.change24hPct, q.currency, q.name ?? null, q.fetchedAt);
}

async function fetchYahooQuote(ticker: string, forceRefresh: boolean): Promise<QuoteResult | null> {
  const cacheKey = `yahoo:${ticker.toUpperCase()}`;
  const cached = getCachedQuote(cacheKey);
  if (cached) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    const limit = forceRefresh ? REFRESH_FLOOR_MS : QUOTE_TTL_MS;
    if (age < limit) return cached;
  }

  const existing = inflightYahoo.get(cacheKey);
  if (existing) return existing;

  const task = (async (): Promise<QuoteResult | null> => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2d`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Kopi/1.0)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
      const json = (await res.json()) as {
        chart?: {
          result?: Array<{
            meta?: {
              regularMarketPrice?: number;
              chartPreviousClose?: number;
              previousClose?: number;
              currency?: string;
              shortName?: string;
              longName?: string;
            };
          }>;
        };
      };
      const meta = json.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (typeof price !== 'number' || !Number.isFinite(price)) {
        throw new Error('No market price in response');
      }
      const prev = meta?.chartPreviousClose ?? meta?.previousClose;
      const change24hPct =
        typeof prev === 'number' && prev > 0 ? ((price - prev) / prev) * 100 : null;
      const result: QuoteResult = {
        price,
        change24hPct,
        currency: (meta?.currency || 'USD').toUpperCase(),
        name: meta?.shortName || meta?.longName,
        fetchedAt: new Date().toISOString(),
        stale: false,
      };
      saveCachedQuote(cacheKey, result);
      return result;
    } catch {
      if (cached) return { ...cached, stale: true };
      return null;
    } finally {
      inflightYahoo.delete(cacheKey);
    }
  })();

  inflightYahoo.set(cacheKey, task);
  return task;
}

async function fetchCoinGeckoBatch(coinIds: string[], forceRefresh: boolean): Promise<Map<string, QuoteResult>> {
  const out = new Map<string, QuoteResult>();
  const toFetch: string[] = [];

  for (const rawId of coinIds) {
    const id = rawId.toLowerCase();
    const cacheKey = `cg:${id}`;
    const cached = getCachedQuote(cacheKey);
    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      const limit = forceRefresh ? REFRESH_FLOOR_MS : QUOTE_TTL_MS;
      if (age < limit) {
        out.set(id, cached);
        continue;
      }
    }
    toFetch.push(id);
  }

  if (toFetch.length === 0) return out;

  try {
    const unique = Array.from(new Set(toFetch));
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(unique.join(','))}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Kopi/1.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
    const now = new Date().toISOString();
    for (const id of unique) {
      const item = data[id];
      if (item && typeof item.usd === 'number') {
        const q: QuoteResult = {
          price: item.usd,
          change24hPct: typeof item.usd_24h_change === 'number' ? item.usd_24h_change : null,
          currency: 'USD',
          fetchedAt: now,
          stale: false,
        };
        saveCachedQuote(`cg:${id}`, q);
        out.set(id, q);
      } else {
        const cached = getCachedQuote(`cg:${id}`);
        if (cached) out.set(id, { ...cached, stale: true });
      }
    }
  } catch {
    for (const id of toFetch) {
      const cached = getCachedQuote(`cg:${id}`);
      if (cached) out.set(id, { ...cached, stale: true });
    }
  }

  return out;
}

export async function getFxRate(fromCurrency: string, toCurrency: string, forceRefresh = false): Promise<number> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  if (from === to) return 1;

  // Handle GBp (British pence used by some LSE quotes)
  if (fromCurrency === 'GBp') {
    const gbpRate = await getFxRate('GBP', to, forceRefresh);
    return gbpRate / 100;
  }

  const pair = `${from}_${to}`;
  const cached = db
    .query<{ rate: number; fetched_at: string }, [string]>('SELECT rate, fetched_at FROM fx_cache WHERE pair = ?')
    .get(pair);

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (age < (forceRefresh ? 60_000 : FX_TTL_MS)) {
      return cached.rate;
    }
  }

  try {
    const yahooPair = `${from}${to}=X`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooPair)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kopi/1.0)' },
      signal: AbortSignal.timeout(6_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number } }> } };
      const rate = json.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof rate === 'number' && rate > 0) {
        db.query(
          'INSERT INTO fx_cache (pair, rate, fetched_at) VALUES (?, ?, ?) ON CONFLICT(pair) DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at',
        ).run(pair, rate, new Date().toISOString());
        return rate;
      }
    }
  } catch {
    // Fallback below
  }

  // Fallback: open.er-api.com (no key required)
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`, {
      signal: AbortSignal.timeout(6_000),
    });
    if (res.ok) {
      const json = (await res.json()) as { rates?: Record<string, number> };
      const rate = json.rates?.[to];
      if (typeof rate === 'number' && rate > 0) {
        db.query(
          'INSERT INTO fx_cache (pair, rate, fetched_at) VALUES (?, ?, ?) ON CONFLICT(pair) DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at',
        ).run(pair, rate, new Date().toISOString());
        return rate;
      }
    }
  } catch {
    // Fallback to stale cache
  }

  if (cached) return cached.rate;
  return 1;
}

interface RsuGrantDbRow {
  id: string;
  symbol: string;
  name: string;
  provider_id: string;
  grant_name: string;
  grant_date: string;
  grant_price: number;
  currency: string;
  tax_withhold_pct: number;
  include_in_total: number;
  actual_account_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function getEnrichedPortfolio(forceRefresh = false): Promise<PortfolioResponse> {
  const baseCurrency = (getSetting('base_currency') || 'SGD').toUpperCase();
  const holdings = db
    .query<HoldingRecord, []>('SELECT * FROM holdings ORDER BY asset_type ASC, symbol ASC')
    .all();

  const grantRows = db
    .query<RsuGrantDbRow, []>('SELECT * FROM rsu_grants ORDER BY grant_date DESC, symbol ASC')
    .all();
  const trancheRows = db
    .query<RsuTrancheRecord, []>('SELECT * FROM rsu_tranches ORDER BY vest_date ASC, id ASC')
    .all();

  const tranchesByGrant = new Map<string, RsuTrancheRecord[]>();
  for (const t of trancheRows) {
    const list = tranchesByGrant.get(t.grant_id) || [];
    list.push(t);
    tranchesByGrant.set(t.grant_id, list);
  }

  const cryptoHoldings = holdings.filter((h) => h.asset_type === 'crypto');
  const equityHoldings = holdings.filter((h) => h.asset_type === 'stock' || h.asset_type === 'etf');

  const uniqueYahooTickers = Array.from(
    new Set([
      ...equityHoldings.map((h) => h.provider_id.toUpperCase()),
      ...grantRows.map((g) => g.provider_id.toUpperCase()),
    ]),
  );

  const [cryptoQuotes, yahooResults] = await Promise.all([
    fetchCoinGeckoBatch(
      cryptoHoldings.map((h) => h.provider_id),
      forceRefresh,
    ),
    Promise.all(uniqueYahooTickers.map((ticker) => fetchYahooQuote(ticker, forceRefresh))),
  ]);

  const yahooQuotes = new Map<string, QuoteResult | null>();
  uniqueYahooTickers.forEach((ticker, i) => yahooQuotes.set(ticker, yahooResults[i] ?? null));

  // Collect all currencies needing FX conversion to baseCurrency
  const currencies = new Set<string>();
  for (const h of holdings) {
    currencies.add(h.currency);
    if (h.asset_type === 'cash') continue;
    const q =
      h.asset_type === 'crypto'
        ? cryptoQuotes.get(h.provider_id.toLowerCase())
        : yahooQuotes.get(h.provider_id.toUpperCase());
    if (q?.currency) currencies.add(q.currency);
  }
  for (const g of grantRows) {
    currencies.add(g.currency);
    const q = yahooQuotes.get(g.provider_id.toUpperCase());
    if (q?.currency) currencies.add(q.currency);
  }

  const fxRates: Record<string, number> = { [baseCurrency]: 1 };
  await Promise.all(
    Array.from(currencies).map(async (cur) => {
      if (cur !== baseCurrency) {
        fxRates[cur] = await getFxRate(cur, baseCurrency, forceRefresh);
      }
    }),
  );

  let totalMarketBase = 0;
  let totalCostBase = 0;
  let investedCostBase = 0;
  let totalDayChangeBase = 0;
  const byType = { stock: 0, etf: 0, crypto: 0, rsu: 0, cash: 0 };

  const enriched: EnrichedHolding[] = holdings.map((h) => {
    if (h.asset_type === 'cash') {
      const priceFx = fxRates[h.currency] ?? 1;
      const marketValueNative = h.quantity;
      const marketValueBase = marketValueNative * priceFx;
      totalMarketBase += marketValueBase;
      totalCostBase += marketValueBase;
      byType.cash += marketValueBase;

      return {
        ...h,
        price: 1,
        priceCurrency: h.currency,
        change24hPct: null,
        fxRateToBase: priceFx,
        marketValueNative,
        marketValueBase,
        costBasisBase: marketValueBase,
        unrealizedPnlBase: null,
        unrealizedPnlPct: null,
        dayChangeBase: 0,
        fetchedAt: null,
        stale: false,
      };
    }

    const q =
      h.asset_type === 'crypto'
        ? cryptoQuotes.get(h.provider_id.toLowerCase()) ?? null
        : yahooQuotes.get(h.provider_id.toUpperCase()) ?? null;

    const priceCurrency = q?.currency || h.currency;
    const priceFx = fxRates[priceCurrency] ?? 1;
    const costFx = fxRates[h.currency] ?? 1;

    const costBasisBase = h.quantity * h.avg_cost * costFx;
    totalCostBase += costBasisBase;
    investedCostBase += costBasisBase;

    const marketValueNative = q ? h.quantity * q.price : null;
    const marketValueBase = marketValueNative !== null ? marketValueNative * priceFx : null;
    const unrealizedPnlBase = marketValueBase !== null ? marketValueBase - costBasisBase : null;
    const unrealizedPnlPct =
      unrealizedPnlBase !== null && costBasisBase > 0 ? (unrealizedPnlBase / costBasisBase) * 100 : null;

    let dayChangeBase: number | null = null;
    if (marketValueBase !== null && q?.change24hPct !== null && q?.change24hPct !== undefined) {
      const prevValue = marketValueBase / (1 + q.change24hPct / 100);
      dayChangeBase = marketValueBase - prevValue;
      totalDayChangeBase += dayChangeBase;
    }

    if (marketValueBase !== null) {
      totalMarketBase += marketValueBase;
      byType[h.asset_type] += marketValueBase;
    }

    return {
      ...h,
      price: q?.price ?? null,
      priceCurrency,
      change24hPct: q?.change24hPct ?? null,
      fxRateToBase: priceFx,
      marketValueNative,
      marketValueBase,
      costBasisBase,
      unrealizedPnlBase,
      unrealizedPnlPct,
      dayChangeBase,
      fetchedAt: q?.fetchedAt ?? null,
      stale: q?.stale ?? false,
    };
  });

  // Sort by largest market value in base currency first
  enriched.sort((a, b) => (b.marketValueBase ?? 0) - (a.marketValueBase ?? 0));

  // Enrich RSU grants & tranches
  const today = new Date().toISOString().slice(0, 10);
  const upcomingTranches: UpcomingRsuVest[] = [];
  const yearBuckets = new Map<string, RsuYearBreakdown>();

  let rsuHeldValueBaseTotal = 0;
  let rsuIncludedHeldValueBase = 0;
  let rsuUnvestedGrossBaseTotal = 0;
  let rsuUnvestedNetBaseTotal = 0;
  let rsuNext12mGrossBase = 0;
  let rsuNext12mNetBase = 0;

  const enrichedGrants: EnrichedRsuGrant[] = grantRows.map((g) => {
    const includeInTotal = Boolean(g.include_in_total);
    const q = yahooQuotes.get(g.provider_id.toUpperCase()) ?? null;
    const priceCurrency = q?.currency || g.currency;
    const priceFx = fxRates[priceCurrency] ?? 1;
    const costFx = fxRates[g.currency] ?? 1;
    const rawTranches = tranchesByGrant.get(g.id) || [];

    let totalUnits = 0;
    let vestedUnits = 0;
    let heldUnits = 0;
    let soldUnits = 0;
    let unvestedUnits = 0;
    let unvestedNetUnits = 0;
    let forfeitedUnits = 0;
    let heldCostBasisBase = 0;

    const enrichedTranches: EnrichedRsuTranche[] = rawTranches.map((t) => {
      const effectiveStatus = computeEffectiveTrancheStatus(t.status, t.vest_date, today);
      const daysUntilVest = daysBetweenIso(today, t.vest_date);

      let netUnits = 0;
      if (effectiveStatus === 'forfeited') {
        netUnits = 0;
      } else if (effectiveStatus === 'unvested') {
        netUnits = t.units * (1 - g.tax_withhold_pct / 100);
      } else {
        // Vested or sold: use explicit withheld_units if set or explicitly confirmed;
        // for auto-vested 'scheduled' tranches with 0 explicit withheld_units, estimate via grant tax_withhold_pct.
        if (t.withheld_units > 0 || t.status === 'vested' || t.status === 'sold') {
          netUnits = Math.max(0, t.units - t.withheld_units);
        } else {
          netUnits = t.units * (1 - g.tax_withhold_pct / 100);
        }
      }

      const unitCost = t.vested_price ?? g.grant_price ?? 0;
      const costBasisBase = effectiveStatus === 'vested' ? netUnits * unitCost * costFx : 0;

      const grossValueNative = q ? t.units * q.price : null;
      const grossValueBase = grossValueNative !== null ? grossValueNative * priceFx : null;
      const netValueNative = q ? netUnits * q.price : null;
      const netValueBase = netValueNative !== null ? netValueNative * priceFx : null;
      const unrealizedPnlBase =
        effectiveStatus === 'vested' && netValueBase !== null ? netValueBase - costBasisBase : null;

      totalUnits += t.units;
      if (effectiveStatus === 'vested') {
        vestedUnits += t.units;
        heldUnits += netUnits;
        heldCostBasisBase += costBasisBase;
      } else if (effectiveStatus === 'sold') {
        vestedUnits += t.units;
        soldUnits += t.units;
      } else if (effectiveStatus === 'unvested') {
        unvestedUnits += t.units;
        unvestedNetUnits += netUnits;
        upcomingTranches.push({
          grantId: g.id,
          trancheId: t.id,
          symbol: g.symbol,
          name: g.name,
          grantName: g.grant_name || `${g.symbol} RSU`,
          vestDate: t.vest_date,
          units: t.units,
          netUnits,
          grossValueBase,
          netValueBase,
          daysUntilVest,
        });
        if (daysUntilVest >= 0 && daysUntilVest <= 365) {
          rsuNext12mGrossBase += grossValueBase ?? 0;
          rsuNext12mNetBase += netValueBase ?? 0;
        }
      } else if (effectiveStatus === 'forfeited') {
        forfeitedUnits += t.units;
      }

      // Yearly vesting breakdown (all non-forfeited tranches)
      if (effectiveStatus !== 'forfeited') {
        const year = t.vest_date.slice(0, 4);
        const bucket = yearBuckets.get(year) || {
          year,
          units: 0,
          grossValueBase: 0,
          netValueBase: 0,
          vestedValueBase: 0,
          unvestedValueBase: 0,
        };
        bucket.units += t.units;
        bucket.grossValueBase += grossValueBase ?? 0;
        bucket.netValueBase += netValueBase ?? 0;
        if (effectiveStatus === 'unvested') {
          bucket.unvestedValueBase += netValueBase ?? 0;
        } else {
          bucket.vestedValueBase += netValueBase ?? 0;
        }
        yearBuckets.set(year, bucket);
      }

      return {
        ...t,
        effectiveStatus,
        netUnits,
        daysUntilVest,
        grossValueNative,
        grossValueBase,
        netValueNative,
        netValueBase,
        costBasisBase,
        unrealizedPnlBase,
      };
    });

    const activeUnits = Math.max(0, totalUnits - forfeitedUnits);
    const vestedPct = activeUnits > 0 ? (vestedUnits / activeUnits) * 100 : 0;

    const heldValueNative = q ? heldUnits * q.price : null;
    const heldValueBase = heldValueNative !== null ? heldValueNative * priceFx : null;
    const unvestedGrossValueBase = q ? unvestedUnits * q.price * priceFx : null;
    const unvestedNetValueBase = q ? unvestedNetUnits * q.price * priceFx : null;

    const grantUnrealizedPnlBase = heldValueBase !== null ? heldValueBase - heldCostBasisBase : null;
    const grantUnrealizedPnlPct =
      grantUnrealizedPnlBase !== null && heldCostBasisBase > 0
        ? (grantUnrealizedPnlBase / heldCostBasisBase) * 100
        : null;

    let dayChangeBase: number | null = null;
    if (heldValueBase !== null && q?.change24hPct !== null && q?.change24hPct !== undefined) {
      const prevValue = heldValueBase / (1 + q.change24hPct / 100);
      dayChangeBase = heldValueBase - prevValue;
    }

    rsuHeldValueBaseTotal += heldValueBase ?? 0;
    rsuUnvestedGrossBaseTotal += unvestedGrossValueBase ?? 0;
    rsuUnvestedNetBaseTotal += unvestedNetValueBase ?? 0;

    if (includeInTotal && heldValueBase !== null && heldUnits > 0) {
      rsuIncludedHeldValueBase += heldValueBase;
      byType.rsu += heldValueBase;
      totalMarketBase += heldValueBase;
      totalCostBase += heldCostBasisBase;
      investedCostBase += heldCostBasisBase;
      if (dayChangeBase !== null) {
        totalDayChangeBase += dayChangeBase;
      }
    }

    const nextUnvested = enrichedTranches.find((t) => t.effectiveStatus === 'unvested') ?? null;

    return {
      ...g,
      include_in_total: includeInTotal,
      price: q?.price ?? null,
      priceCurrency,
      change24hPct: q?.change24hPct ?? null,
      fxRateToBase: priceFx,
      fetchedAt: q?.fetchedAt ?? null,
      stale: q?.stale ?? false,
      totalUnits,
      vestedUnits,
      heldUnits,
      soldUnits,
      unvestedUnits,
      unvestedNetUnits,
      forfeitedUnits,
      vestedPct,
      heldValueNative,
      heldValueBase,
      costBasisBase: heldCostBasisBase,
      unrealizedPnlBase: grantUnrealizedPnlBase,
      unrealizedPnlPct: grantUnrealizedPnlPct,
      unvestedGrossValueBase,
      unvestedNetValueBase,
      dayChangeBase,
      nextVest: nextUnvested
        ? {
            trancheId: nextUnvested.id,
            vestDate: nextUnvested.vest_date,
            units: nextUnvested.units,
            netUnits: nextUnvested.netUnits,
            netValueBase: nextUnvested.netValueBase,
            daysUntilVest: nextUnvested.daysUntilVest,
          }
        : null,
      tranches: enrichedTranches,
    };
  });

  upcomingTranches.sort((a, b) => a.vestDate.localeCompare(b.vestDate));
  const byYear = Array.from(yearBuckets.values()).sort((a, b) => a.year.localeCompare(b.year));

  const rsuSummary: RsuSummary = {
    grantCount: enrichedGrants.length,
    heldValueBase: rsuHeldValueBaseTotal,
    includedHeldValueBase: rsuIncludedHeldValueBase,
    unvestedGrossValueBase: rsuUnvestedGrossBaseTotal,
    unvestedNetValueBase: rsuUnvestedNetBaseTotal,
    next12mGrossValueBase: rsuNext12mGrossBase,
    next12mNetValueBase: rsuNext12mNetBase,
    nextVest: upcomingTranches[0] ?? null,
    upcomingTranches,
    byYear,
  };

  const unrealizedPnlBase = totalMarketBase - totalCostBase;
  const unrealizedPnlPct = investedCostBase > 0 ? (unrealizedPnlBase / investedCostBase) * 100 : 0;
  const prevTotal = totalMarketBase - totalDayChangeBase;
  const dayChangePct = prevTotal > 0 ? (totalDayChangeBase / prevTotal) * 100 : 0;

  return {
    baseCurrency,
    holdings: enriched,
    rsuGrants: enrichedGrants,
    rsuSummary,
    totals: {
      marketValueBase: totalMarketBase,
      costBasisBase: totalCostBase,
      unrealizedPnlBase,
      unrealizedPnlPct,
      dayChangeBase: totalDayChangeBase,
      dayChangePct,
      byType,
    },
    fxRates,
    refreshedAt: new Date().toISOString(),
  };
}

export interface AssetSearchHit {
  symbol: string;
  name: string;
  asset_type: 'stock' | 'etf' | 'crypto';
  provider_id: string;
  exchange?: string;
  currency: string;
}

export async function searchAssets(query: string, type: 'stock' | 'etf' | 'crypto' | 'all'): Promise<AssetSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const results: AssetSearchHit[] = [];

  if (type === 'crypto' || type === 'all') {
    try {
      const res = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Kopi/1.0' },
        signal: AbortSignal.timeout(6_000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          coins?: Array<{ id: string; symbol: string; name: string }>;
        };
        for (const c of (json.coins || []).slice(0, 6)) {
          results.push({
            symbol: c.symbol.toUpperCase(),
            name: c.name,
            asset_type: 'crypto',
            provider_id: c.id,
            exchange: 'CoinGecko',
            currency: 'USD',
          });
        }
      }
    } catch {
      // Ignore search failure
    }
  }

  if (type !== 'crypto') {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Kopi/1.0)' },
          signal: AbortSignal.timeout(6_000),
        },
      );
      if (res.ok) {
        const json = (await res.json()) as {
          quotes?: Array<{
            symbol?: string;
            shortname?: string;
            longname?: string;
            quoteType?: string;
            exchDisp?: string;
          }>;
        };
        for (const item of json.quotes || []) {
          if (!item.symbol) continue;
          if (item.quoteType !== 'EQUITY' && item.quoteType !== 'ETF') continue;
          const inferredCurrency = item.symbol.endsWith('.SI')
            ? 'SGD'
            : item.symbol.endsWith('.L')
              ? 'USD'
              : item.symbol.endsWith('.HK')
                ? 'HKD'
                : 'USD';
          results.push({
            symbol: item.symbol.toUpperCase(),
            name: item.shortname || item.longname || item.symbol,
            asset_type: item.quoteType === 'ETF' ? 'etf' : 'stock',
            provider_id: item.symbol.toUpperCase(),
            exchange: item.exchDisp,
            currency: inferredCurrency,
          });
        }
      }
    } catch {
      // Ignore search failure
    }
  }

  return results;
}
