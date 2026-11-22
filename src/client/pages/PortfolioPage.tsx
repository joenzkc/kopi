import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Award,
  Banknote,
  Edit3,
  Link2,
  PieChart,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import type {
  ActualAccount,
  AssetType,
  EnrichedHolding,
  EnrichedRsuGrant,
  EnrichedRsuTranche,
  PortfolioResponse,
} from '@shared/types';
import { apiFetch, formatMoney, formatPct, formatPrice, formatSignedMoney } from '../lib/api';
import { Sheet } from '../components/Sheet';
import { RsuGrantSheet } from '../components/RsuGrantSheet';
import { RsuTrancheSheet } from '../components/RsuTrancheSheet';
import { RsuSection } from '../components/RsuSection';

interface PortfolioPageProps {
  accounts: ActualAccount[];
  onToast: (msg: string, tone?: 'success' | 'error') => void;
  refreshTrigger: number;
}

interface SearchHit {
  symbol: string;
  name: string;
  asset_type: 'stock' | 'etf' | 'crypto';
  provider_id: string;
  exchange?: string;
  currency: string;
}

type PortfolioFilter = 'all' | 'stock' | 'etf' | 'crypto' | 'rsu' | 'cash';

export function PortfolioPage({ accounts, onToast, refreshTrigger }: PortfolioPageProps) {
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<PortfolioFilter>('all');

  // Holding / Liquidity sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<EnrichedHolding | null>(null);
  const [assetType, setAssetType] = useState<AssetType>('stock');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [providerId, setProviderId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [avgCost, setAvgCost] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [actualAccountId, setActualAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // RSU sheet states
  const [rsuSheetOpen, setRsuSheetOpen] = useState(false);
  const [editingRsu, setEditingRsu] = useState<EnrichedRsuGrant | null>(null);
  const [trancheSheet, setTrancheSheet] = useState<{
    open: boolean;
    grant: EnrichedRsuGrant | null;
    tranche: EnrichedRsuTranche | null;
  }>({ open: false, grant: null, tranche: null });

  const load = useCallback(
    async (forceRefresh = false) => {
      try {
        if (forceRefresh) setRefreshing(true);
        const res = await apiFetch<PortfolioResponse>(`/api/portfolio${forceRefresh ? '?refresh=1' : ''}`);
        setData(res);
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Failed to load portfolio', 'error');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onToast],
  );

  useEffect(() => {
    void load(refreshTrigger > 0);
  }, [load, refreshTrigger]);

  useEffect(() => {
    if (!sheetOpen || editing || assetType === 'cash' || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch<{ results: SearchHit[] }>(
          `/api/portfolio/search?q=${encodeURIComponent(searchQuery.trim())}&type=${assetType}`,
        );
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, assetType, sheetOpen, editing]);

  const cur = data?.baseCurrency || 'SGD';
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

  function openCreate(initialType: AssetType = 'stock') {
    setEditing(null);
    setAssetType(initialType);
    setSymbol(initialType === 'cash' ? cur : '');
    setName('');
    setProviderId(initialType === 'cash' ? `cash:${cur}` : '');
    setQuantity('');
    setAvgCost(initialType === 'cash' ? '1' : '');
    setCurrency(initialType === 'cash' ? cur : 'USD');
    setActualAccountId('');
    setNotes('');
    setSearchQuery('');
    setSearchResults([]);
    setSheetOpen(true);
  }

  function openEdit(h: EnrichedHolding) {
    setEditing(h);
    setAssetType(h.asset_type);
    setSymbol(h.symbol);
    setName(h.name);
    setProviderId(h.provider_id);
    setQuantity(String(h.quantity));
    setAvgCost(String(h.avg_cost));
    setCurrency(h.currency);
    setActualAccountId(h.actual_account_id || '');
    setNotes(h.notes || '');
    setSearchQuery('');
    setSearchResults([]);
    setSheetOpen(true);
  }

  function pickSearchHit(hit: SearchHit) {
    setAssetType(hit.asset_type);
    setSymbol(hit.symbol);
    setName(hit.name);
    setProviderId(hit.provider_id);
    setCurrency(hit.currency);
    setSearchQuery('');
    setSearchResults([]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const isCash = assetType === 'cash';
    const qtyNum = Number(quantity);
    const costNum = Number(avgCost || 0);
    if (!Number.isFinite(qtyNum) || (isCash ? qtyNum < 0 : qtyNum <= 0)) {
      onToast(isCash ? 'Enter a valid cash amount >= 0' : 'Enter a valid quantity > 0', 'error');
      return;
    }
    setSaving(true);
    try {
      const ccy = currency.trim().toUpperCase() || cur;
      const linkedAcctName = actualAccountId ? accountMap.get(actualAccountId) : undefined;
      const defaultCashName = linkedAcctName ? `${linkedAcctName} ${ccy} Liquidity` : `${ccy} Excess Liquidity`;

      const payload = isCash
        ? {
            symbol: ccy,
            name: name.trim() || defaultCashName,
            asset_type: 'cash' as const,
            provider_id: `cash:${ccy}`,
            quantity: qtyNum,
            avg_cost: 1,
            currency: ccy,
            actual_account_id: actualAccountId || null,
            notes: notes.trim() || null,
          }
        : {
            symbol: symbol.trim().toUpperCase(),
            name: name.trim() || symbol.trim().toUpperCase(),
            asset_type: assetType,
            provider_id: providerId.trim() || symbol.trim(),
            quantity: qtyNum,
            avg_cost: Number.isFinite(costNum) ? costNum : 0,
            currency: ccy,
            actual_account_id: actualAccountId || null,
            notes: notes.trim() || null,
          };

      if (editing) {
        await apiFetch(`/api/portfolio/holdings/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        onToast(`Updated ${isCash ? payload.name : payload.symbol}`);
      } else {
        await apiFetch('/api/portfolio/holdings', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        onToast(`Added ${isCash ? payload.name : payload.symbol}`);
      }
      setSheetOpen(false);
      await load(true);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(h: EnrichedHolding) {
    const label = h.asset_type === 'cash' ? h.name : `${h.symbol} (${h.name})`;
    if (!confirm(`Remove ${label} from your portfolio?`)) return;
    try {
      await apiFetch(`/api/portfolio/holdings/${h.id}`, { method: 'DELETE' });
      onToast(`Removed ${h.asset_type === 'cash' ? h.name : h.symbol}`);
      await load(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  // RSU handlers
  function openCreateRsu() {
    setEditingRsu(null);
    setRsuSheetOpen(true);
  }

  function openEditRsu(grant: EnrichedRsuGrant) {
    setEditingRsu(grant);
    setRsuSheetOpen(true);
  }

  async function handleDeleteRsu(grant: EnrichedRsuGrant) {
    const label = grant.grant_name ? `${grant.symbol} (${grant.grant_name})` : grant.symbol;
    if (!confirm(`Remove RSU grant ${label} and all its vesting tranches?`)) return;
    try {
      await apiFetch(`/api/portfolio/rsus/${grant.id}`, { method: 'DELETE' });
      onToast(`Removed ${label}`);
      await load(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  async function handleQuickToggleSold(grant: EnrichedRsuGrant, tranche: EnrichedRsuTranche) {
    const nextStatus = tranche.effectiveStatus === 'sold' ? 'vested' : 'sold';
    try {
      await apiFetch(`/api/portfolio/rsus/${grant.id}/tranches/${tranche.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      onToast(
        nextStatus === 'sold'
          ? `Marked ${tranche.units} ${grant.symbol} (${tranche.vest_date}) as sold`
          : `Marked ${tranche.units} ${grant.symbol} (${tranche.vest_date}) as vested`,
      );
      await load(false);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  }

  async function handleSyncActual() {
    setSyncing(true);
    try {
      const res = await apiFetch<{
        synced: Array<{ accountName: string; deltaCents: number }>;
        message?: string;
      }>('/api/portfolio/sync-actual', { method: 'POST' });
      if (res.synced.length === 0) {
        onToast(res.message || 'Link holdings, liquidity, or RSUs to an off-budget Actual account first', 'error');
      } else {
        const summary = res.synced
          .map(
            (s) =>
              `${s.accountName} (${s.deltaCents === 0 ? 'up to date' : formatSignedMoney(s.deltaCents / 100, cur)})`,
          )
          .join(', ');
        onToast(`Synced to Actual: ${summary}`);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  }

  const allHoldings = data?.holdings || [];
  const rsuGrants = data?.rsuGrants || [];
  const rsuSummary = data?.rsuSummary || {
    grantCount: 0,
    heldValueBase: 0,
    includedHeldValueBase: 0,
    unvestedGrossValueBase: 0,
    unvestedNetValueBase: 0,
    next12mGrossValueBase: 0,
    next12mNetValueBase: 0,
    nextVest: null,
    upcomingTranches: [],
    byYear: [],
  };

  const holdings =
    filter === 'rsu'
      ? []
      : allHoldings.filter((h) => filter === 'all' || h.asset_type === filter);

  const offBudgetAccounts = accounts.filter((a) => a.offbudget);

  const totalVal = data?.totals.marketValueBase || 0;
  const stockPct = totalVal > 0 ? ((data?.totals.byType.stock || 0) / totalVal) * 100 : 0;
  const etfPct = totalVal > 0 ? ((data?.totals.byType.etf || 0) / totalVal) * 100 : 0;
  const cryptoPct = totalVal > 0 ? ((data?.totals.byType.crypto || 0) / totalVal) * 100 : 0;
  const rsuPct = totalVal > 0 ? ((data?.totals.byType.rsu || 0) / totalVal) * 100 : 0;
  const cashPct = totalVal > 0 ? ((data?.totals.byType.cash || 0) / totalVal) * 100 : 0;

  const filterTabs: Array<{ id: PortfolioFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'stock', label: 'Stocks' },
    { id: 'etf', label: 'ETFs' },
    { id: 'crypto', label: 'Crypto' },
    { id: 'rsu', label: rsuGrants.length > 0 ? `RSUs (${rsuGrants.length})` : 'RSUs' },
    { id: 'cash', label: 'Liquidity' },
  ];

  const showHoldingsSection = filter !== 'rsu';
  const showRsuSection = filter === 'rsu' || (filter === 'all' && rsuGrants.length > 0);
  const isAllEmpty = filter === 'all' && allHoldings.length === 0 && rsuGrants.length === 0;

  return (
    <div className="space-y-5">
      {/* Portfolio Summary Card */}
      <section className="card rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              Total Investments ({cur})
            </div>
            <div className="mt-1 text-3xl font-semibold tracking-tight tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {loading && !data ? '—' : formatMoney(totalVal, cur)}
            </div>
            {data && (
              <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs tabular-nums">
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium"
                  style={{
                    backgroundColor: data.totals.unrealizedPnlBase >= 0 ? 'var(--positive-soft)' : 'var(--negative-soft)',
                    color: data.totals.unrealizedPnlBase >= 0 ? 'var(--positive)' : 'var(--negative)',
                  }}
                >
                  {data.totals.unrealizedPnlBase >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" />
                  )}
                  All-time {formatSignedMoney(data.totals.unrealizedPnlBase, cur)} (
                  {formatPct(data.totals.unrealizedPnlPct)})
                </span>
                <span
                  className="rounded-full px-2.5 py-0.5"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
                >
                  24h: {formatSignedMoney(data.totals.dayChangeBase, cur)} ({formatPct(data.totals.dayChangePct)})
                </span>
                {rsuSummary.unvestedNetValueBase > 0 && (
                  <button
                    type="button"
                    onClick={() => setFilter('rsu')}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium transition hover:opacity-85"
                    style={{ backgroundColor: 'rgba(139, 107, 177, 0.2)', color: '#C8B8FF' }}
                  >
                    <Award className="h-3 w-3" />
                    Unvested RSUs: {formatMoney(rsuSummary.unvestedNetValueBase, cur, true)}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => void load(true)}
              className="btn-secondary flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              disabled={syncing}
              onClick={handleSyncActual}
              className="btn-secondary flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-medium disabled:opacity-50"
              style={{ color: 'var(--accent-text)', borderColor: 'var(--accent-border)' }}
              title="Sync linked off-budget accounts in Actual (holdings, liquidity, and vested RSUs)"
            >
              <ArrowLeftRight className={`h-3.5 w-3.5 ${syncing ? 'animate-pulse' : ''}`} />
              Sync Actual
            </button>
          </div>
        </div>

        {/* Calm Editorial Allocation Bar */}
        {totalVal > 0 && (
          <div className="mt-5">
            <div className="flex h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              {stockPct > 0 && <div style={{ width: `${stockPct}%`, backgroundColor: '#3B5B7C' }} />}
              {etfPct > 0 && <div style={{ width: `${etfPct}%`, backgroundColor: '#0F5E56' }} />}
              {cryptoPct > 0 && <div style={{ width: `${cryptoPct}%`, backgroundColor: '#C28A38' }} />}
              {rsuPct > 0 && <div style={{ width: `${rsuPct}%`, backgroundColor: '#8B6BB1' }} />}
              {cashPct > 0 && <div style={{ width: `${cashPct}%`, backgroundColor: '#4A8FE7' }} />}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              {(stockPct > 0 || (etfPct === 0 && cryptoPct === 0 && rsuPct === 0 && cashPct === 0)) && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#3B5B7C' }} />
                  Stocks {stockPct.toFixed(0)}%
                </span>
              )}
              {etfPct > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#0F5E56' }} />
                  ETFs {etfPct.toFixed(0)}%
                </span>
              )}
              {cryptoPct > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#C28A38' }} />
                  Crypto {cryptoPct.toFixed(0)}%
                </span>
              )}
              {rsuPct > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#8B6BB1' }} />
                  RSUs {rsuPct.toFixed(0)}%
                </span>
              )}
              {cashPct > 0 && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#4A8FE7' }} />
                  Liquidity {cashPct.toFixed(0)}% ({formatMoney(data?.totals.byType.cash || 0, cur, true)})
                </span>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Filter Bar + Quick Add Buttons */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
          {filterTabs.map((t) => {
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition"
                style={{
                  backgroundColor: active ? 'var(--text-primary)' : 'var(--bg-surface)',
                  color: active ? 'var(--bg-surface)' : 'var(--text-secondary)',
                  border: `1px solid ${active ? 'var(--text-primary)' : 'var(--border-subtle)'}`,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:gap-1.5">
          <button
            type="button"
            onClick={() => openCreate('cash')}
            className="btn-secondary flex items-center justify-center gap-1 rounded-xl px-2.5 py-2 text-xs font-medium sm:shrink-0 sm:px-3"
            style={
              filter === 'cash'
                ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 700 }
                : undefined
            }
          >
            <Banknote className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Liquidity</span>
          </button>
          <button
            type="button"
            onClick={openCreateRsu}
            className="btn-secondary flex items-center justify-center gap-1 rounded-xl px-2.5 py-2 text-xs font-medium sm:shrink-0 sm:px-3"
            style={
              filter === 'rsu'
                ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)', fontWeight: 700 }
                : undefined
            }
          >
            <Award className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">RSU</span>
          </button>
          <button
            type="button"
            onClick={() => openCreate(filter === 'etf' || filter === 'crypto' ? filter : 'stock')}
            className="btn-primary flex items-center justify-center gap-1 rounded-xl px-2.5 py-2 text-xs font-medium sm:shrink-0 sm:px-3"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Holding</span>
          </button>
        </div>
      </div>

      {/* Holdings & Excess Liquidity List */}
      {showHoldingsSection && (
        <>
          {holdings.length === 0 ? (
            // On 'all' tab, only show empty state if there are also no RSUs
            isAllEmpty || filter !== 'all' ? (
              <div className="card rounded-2xl p-8 text-center">
                {filter === 'cash' ? (
                  <>
                    <Banknote className="mx-auto h-8 w-8" style={{ color: '#4A8FE7' }} />
                    <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      No excess liquidity tracked yet
                    </p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Track uninvested {cur} or foreign cash sitting inside your brokerage accounts and sync it with Actual.
                    </p>
                    <button
                      type="button"
                      onClick={() => openCreate('cash')}
                      className="btn-primary mt-4 rounded-xl px-4 py-2 text-xs font-medium"
                    >
                      Add excess liquidity
                    </button>
                  </>
                ) : (
                  <>
                    <PieChart className="mx-auto h-8 w-8" style={{ color: 'var(--text-muted)' }} />
                    <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {filter === 'all' ? 'No holdings tracked yet' : `No ${filter === 'etf' ? 'ETFs' : `${filter}s`} tracked yet`}
                    </p>
                    <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Add stocks (e.g. ACME, ACME.L, ACME.SI), crypto, excess liquidity ({cur}), or RSU grants to track live values in {cur}.
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => openCreate(filter === 'etf' || filter === 'crypto' ? filter : 'stock')}
                        className="btn-primary rounded-xl px-4 py-2 text-xs font-medium"
                      >
                        Add holding
                      </button>
                      {filter === 'all' && (
                        <>
                          <button
                            type="button"
                            onClick={() => openCreate('cash')}
                            className="btn-secondary rounded-xl px-4 py-2 text-xs font-medium"
                          >
                            Add excess liquidity
                          </button>
                          <button
                            type="button"
                            onClick={openCreateRsu}
                            className="btn-secondary rounded-xl px-4 py-2 text-xs font-medium"
                          >
                            Add RSU grant
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : null
          ) : (
            <div className="card divider-list overflow-hidden rounded-2xl">
              {holdings.map((h) => {
                const isCash = h.asset_type === 'cash';
                const up24 = (h.change24hPct ?? 0) >= 0;
                const upPnl = (h.unrealizedPnlBase ?? 0) >= 0;
                const typeDot =
                  h.asset_type === 'cash'
                    ? '#4A8FE7'
                    : h.asset_type === 'crypto'
                      ? '#C28A38'
                      : h.asset_type === 'etf'
                        ? '#0F5E56'
                        : '#3B5B7C';

                return (
                  <div key={h.id} className="p-4 transition">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-semibold"
                          style={{
                            backgroundColor: 'var(--bg-subtle)',
                            color: 'var(--text-primary)',
                            borderLeft: `3px solid ${typeDot}`,
                          }}
                        >
                          {h.symbol.slice(0, 5)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                              {isCash ? h.name : h.symbol}
                            </span>
                            {isCash && (
                              <span
                                className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ backgroundColor: 'var(--info-soft)', color: 'var(--info)' }}
                              >
                                Liquidity
                              </span>
                            )}
                            {h.actual_account_id && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                                title={`Linked to ${accountMap.get(h.actual_account_id) || 'Actual account'}`}
                              >
                                <Link2 className="h-2.5 w-2.5" />
                                {accountMap.get(h.actual_account_id) || 'Linked'}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                            {isCash
                              ? h.currency !== cur
                                ? `${formatMoney(h.quantity, h.currency)} · FX ${h.fxRateToBase.toFixed(4)}`
                                : `Cash balance (${h.currency})`
                              : h.name}
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-right tabular-nums">
                        <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {h.marketValueBase !== null ? formatMoney(h.marketValueBase, cur) : 'Quote N/A'}
                        </div>
                        {isCash ? (
                          <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                            {h.currency}
                          </div>
                        ) : (
                          <div
                            className="text-xs font-medium"
                            style={{ color: up24 ? 'var(--positive)' : 'var(--negative)' }}
                          >
                            {h.price !== null ? formatPrice(h.price, h.priceCurrency) : '—'} · {formatPct(h.change24hPct)}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      className="mt-3 flex items-center justify-between pt-2.5 text-xs tabular-nums"
                      style={{ borderTop: '1px solid var(--border-subtle)' }}
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ color: 'var(--text-muted)' }}>
                        {isCash ? (
                          <>
                            <span>
                              Balance:{' '}
                              <strong className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                {formatMoney(h.quantity, h.currency)}
                              </strong>
                            </span>
                            {h.notes && <span>{h.notes}</span>}
                          </>
                        ) : (
                          <>
                            <span>
                              Qty:{' '}
                              <strong className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                {h.quantity}
                              </strong>
                            </span>
                            {h.avg_cost > 0 && (
                              <span>
                                Avg:{' '}
                                <strong className="font-medium" style={{ color: 'var(--text-primary)' }}>
                                  {formatPrice(h.avg_cost, h.currency)}
                                </strong>
                              </span>
                            )}
                            {h.unrealizedPnlBase !== null && h.avg_cost > 0 && (
                              <span style={{ color: upPnl ? 'var(--positive)' : 'var(--negative)' }}>
                                P&amp;L {formatSignedMoney(h.unrealizedPnlBase, cur)} ({formatPct(h.unrealizedPnlPct)})
                              </span>
                            )}
                            {h.stale && <span style={{ color: 'var(--warning)' }}>cached</span>}
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(h)}
                          className="rounded-lg p-1.5 transition hover:opacity-80"
                          style={{ color: 'var(--text-muted)' }}
                          aria-label={isCash ? 'Edit liquidity' : 'Edit holding'}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(h)}
                          className="rounded-lg p-1.5 transition hover:opacity-80"
                          style={{ color: 'var(--negative)' }}
                          aria-label={isCash ? 'Delete liquidity' : 'Delete holding'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* RSUs & Vesting Section */}
      {showRsuSection && (
        <RsuSection
          grants={rsuGrants}
          summary={rsuSummary}
          baseCurrency={cur}
          accountMap={accountMap}
          mode={filter === 'rsu' ? 'full' : 'compact'}
          onViewAllRsu={() => setFilter('rsu')}
          onAddGrant={openCreateRsu}
          onEditGrant={openEditRsu}
          onDeleteGrant={(g) => void handleDeleteRsu(g)}
          onAddTranche={(grant) => setTrancheSheet({ open: true, grant, tranche: null })}
          onEditTranche={(grant, tranche) => setTrancheSheet({ open: true, grant, tranche })}
          onQuickToggleSold={(grant, tranche) => void handleQuickToggleSold(grant, tranche)}
        />
      )}

      {/* Add / Edit Holding or Excess Liquidity Sheet */}
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={
          editing
            ? `Edit ${editing.asset_type === 'cash' ? editing.name : editing.symbol}`
            : assetType === 'cash'
              ? 'Add Excess Liquidity'
              : 'Add Holding'
        }
        subtitle={
          assetType === 'cash'
            ? `Track uninvested ${cur} or foreign cash inside your brokerage accounts`
            : 'Yahoo Finance for US/SGX/LSE equities · CoinGecko for crypto'
        }
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                { id: 'stock', label: 'Stock' },
                { id: 'etf', label: 'ETF' },
                { id: 'crypto', label: 'Crypto' },
                { id: 'cash', label: 'Liquidity' },
              ] as const
            ).map((t) => {
              const active = assetType === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setAssetType(t.id);
                    if (t.id === 'crypto') setCurrency('USD');
                    if (t.id === 'cash') {
                      setCurrency(cur);
                      setSymbol(cur);
                      setProviderId(`cash:${cur}`);
                      setAvgCost('1');
                    }
                  }}
                  className="rounded-xl py-2 text-xs font-medium transition"
                  style={{
                    backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                    color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
                    border: `1px solid ${active ? 'var(--accent-border)' : 'transparent'}`,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {assetType === 'cash' ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 min-w-0">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Cash Balance / Excess Liquidity
                  </label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0.00"
                    className="input-field"
                  />
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      setSymbol(e.target.value);
                      setProviderId(`cash:${e.target.value}`);
                    }}
                    className="input-field"
                  >
                    {['SGD', 'USD', 'EUR', 'GBP', 'HKD', 'JPY', 'AUD'].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Link to Actual Off-Budget Account (optional)
                </label>
                <select
                  value={actualAccountId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setActualAccountId(nextId);
                    if (!name.trim() && nextId) {
                      const acctName = accountMap.get(nextId);
                      if (acctName) setName(`${acctName} ${currency} Liquidity`);
                    }
                  }}
                  className="input-field"
                >
                  <option value="">Not linked (track here only)</option>
                  {(offBudgetAccounts.length > 0 ? offBudgetAccounts : accounts).map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} {acc.offbudget ? '(Off-budget)' : '(On-budget)'}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  Linking includes this excess liquidity when syncing the brokerage account balance to Actual.
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Label
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`e.g. Brokerage ${currency} cash`}
                  className="input-field"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Notes (optional)
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Uninvested brokerage cash / dividends"
                  className="input-field"
                />
              </div>
            </>
          ) : (
            <>
              {!editing && (
                <div className="relative">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Search{' '}
                    {assetType === 'crypto'
                      ? 'CoinGecko coin'
                      : 'Yahoo Finance ticker (e.g. ACME, ACME.L, ACME.SI)'}
                  </label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-2.5 h-4 w-4"
                      style={{ color: 'var(--text-muted)' }}
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={
                        assetType === 'crypto' ? 'Search bitcoin, ethereum...' : 'Search by ticker or company name...'
                      }
                      className="input-field pl-9"
                    />
                  </div>
                  {(searching || searchResults.length > 0) && (
                    <div
                      className="mt-1.5 max-h-44 overflow-y-auto rounded-xl shadow-lg"
                      style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                    >
                      {searching && (
                        <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                          Searching...
                        </div>
                      )}
                      {searchResults.map((hit) => (
                        <button
                          key={`${hit.asset_type}:${hit.provider_id}`}
                          type="button"
                          onClick={() => pickSearchHit(hit)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition hover:opacity-80"
                          style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        >
                          <div className="min-w-0">
                            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                              {hit.symbol}
                            </span>
                            <span className="ml-2 truncate" style={{ color: 'var(--text-muted)' }}>
                              {hit.name}
                            </span>
                          </div>
                          <span className="ml-2 shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {hit.exchange || hit.currency}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Symbol
                  </label>
                  <input
                    required
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    placeholder="ACME / BTC"
                    className="input-field"
                  />
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    {assetType === 'crypto' ? 'CoinGecko ID' : 'Yahoo Ticker'}
                  </label>
                  <input
                    required
                    value={providerId}
                    onChange={(e) => setProviderId(e.target.value)}
                    placeholder={assetType === 'crypto' ? 'bitcoin' : 'ACME'}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Name
                </label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Corp."
                  className="input-field"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Quantity
                  </label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="0"
                    className="input-field"
                  />
                </div>
                <div className="min-w-0">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Avg Cost
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={avgCost}
                    onChange={(e) => setAvgCost(e.target.value)}
                    placeholder="0.00"
                    className="input-field"
                  />
                </div>
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                    Cost CCY
                  </label>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input-field">
                    {['USD', 'SGD', 'EUR', 'GBP', 'HKD', 'JPY', 'AUD'].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Link to Actual Off-Budget Account (optional)
                </label>
                <select value={actualAccountId} onChange={(e) => setActualAccountId(e.target.value)} className="input-field">
                  <option value="">Not linked (track here only)</option>
                  {(offBudgetAccounts.length > 0 ? offBudgetAccounts : accounts).map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} {acc.offbudget ? '(Off-budget)' : '(On-budget)'}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={saving}
            className="btn-primary w-full rounded-xl py-3 text-sm font-medium disabled:opacity-50"
          >
            {saving
              ? 'Saving...'
              : editing
                ? 'Save Changes'
                : assetType === 'cash'
                  ? 'Add Excess Liquidity'
                  : 'Add Holding'}
          </button>
        </form>
      </Sheet>

      {/* Add / Edit RSU Grant Sheet */}
      <RsuGrantSheet
        open={rsuSheetOpen}
        onClose={() => setRsuSheetOpen(false)}
        editing={editingRsu}
        accounts={accounts}
        onSaved={(msg) => {
          onToast(msg);
          void load(true);
        }}
        onError={(msg) => onToast(msg, 'error')}
      />

      {/* Add / Edit Single RSU Tranche Sheet */}
      <RsuTrancheSheet
        open={trancheSheet.open}
        onClose={() => setTrancheSheet((prev) => ({ ...prev, open: false }))}
        grant={trancheSheet.grant}
        tranche={trancheSheet.tranche}
        onSaved={(msg) => {
          onToast(msg);
          void load(false);
        }}
        onError={(msg) => onToast(msg, 'error')}
      />
    </div>
  );
}
