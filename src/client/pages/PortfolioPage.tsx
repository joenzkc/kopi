import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActualAccount,
  AssetType,
  EnrichedHolding,
  EnrichedRsuGrant,
  EnrichedRsuTranche,
  PortfolioResponse,
  RsuSummary,
} from '@shared/types';
import { apiFetch } from '../lib/api';
import { useFinancialValues } from '../lib/valueVisibility';
import { RsuGrantSheet } from '../components/RsuGrantSheet';
import { RsuTrancheSheet } from '../components/RsuTrancheSheet';
import { RsuSection } from '../components/RsuSection';
import { HoldingSheet } from '../components/portfolio/HoldingSheet';
import { AddMenu, ChangeModeToggle, HoldingGroups } from '../components/portfolio/HoldingsSection';
import { AllocationCard, PortfolioHero, type AllocationSlice } from '../components/portfolio/PortfolioSummary';
import { TYPE_META, type ChangeMode, type PortfolioFilter } from '../components/portfolio/format';
import { Button } from '@client/components/ui/button';
import { Skeleton } from '@client/components/ui/skeleton';
import { X } from 'lucide-react';

interface PortfolioPageProps {
  accounts: ActualAccount[];
  onToast: (msg: string, tone?: 'success' | 'error', privateMessage?: string) => void;
  refreshTrigger: number;
}

const EMPTY_RSU_SUMMARY: RsuSummary = {
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

const MODE_KEY = 'kopi_invest_change_mode';

function readMode(): ChangeMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'all' ? 'all' : 'today';
  } catch {
    return 'today';
  }
}

export function PortfolioPage({ accounts, onToast, refreshTrigger }: PortfolioPageProps) {
  const { formatSignedMoney } = useFinancialValues();
  const [data, setData] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState<PortfolioFilter>('all');
  const [mode, setModeState] = useState<ChangeMode>(readMode);
  const rsuRef = useRef<HTMLDivElement>(null);

  const [holdingSheet, setHoldingSheet] = useState<{ open: boolean; editing: EnrichedHolding | null; type: AssetType }>({
    open: false,
    editing: null,
    type: 'stock',
  });
  const [grantSheet, setGrantSheet] = useState<{ open: boolean; editing: EnrichedRsuGrant | null }>({ open: false, editing: null });
  const [trancheSheet, setTrancheSheet] = useState<{
    open: boolean;
    grant: EnrichedRsuGrant | null;
    tranche: EnrichedRsuTranche | null;
  }>({ open: false, grant: null, tranche: null });

  const load = useCallback(
    async (forceRefresh = false) => {
      try {
        const res = await apiFetch<PortfolioResponse>(`/api/portfolio${forceRefresh ? '?refresh=1' : ''}`);
        setData(res);
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Failed to load portfolio', 'error');
      } finally {
        setLoading(false);
      }
    },
    [onToast],
  );

  useEffect(() => {
    void load(refreshTrigger > 0);
  }, [load, refreshTrigger]);

  const setMode = (m: ChangeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // per-device preference only
    }
  };

  const cur = data?.baseCurrency || 'SGD';
  const accountMap = new Map(accounts.map((a) => [a.id, a.name]));

  const openHolding = (editing: EnrichedHolding | null, type: AssetType = 'stock') => setHoldingSheet({ open: true, editing, type });
  const openGrant = (editing: EnrichedRsuGrant | null) => setGrantSheet({ open: true, editing });
  const saved = (refreshPrices: boolean) => (msg: string) => {
    onToast(msg);
    void load(refreshPrices);
  };
  const failed = (msg: string) => onToast(msg, 'error');

  async function handleSyncActual() {
    setSyncing(true);
    try {
      const res = await apiFetch<{ synced: Array<{ accountName: string; deltaCents: number }>; message?: string }>(
        '/api/portfolio/sync-actual',
        { method: 'POST' },
      );
      if (res.synced.length === 0) {
        onToast(res.message || 'Link holdings, cash, or RSUs to an off-budget Actual account first', 'error');
      } else {
        const summary = res.synced
          .map((s) => `${s.accountName} (${s.deltaCents === 0 ? 'up to date' : formatSignedMoney(s.deltaCents / 100, cur)})`)
          .join(', ');
        onToast(`Synced to Actual: ${summary}`, 'success', 'Synced to Actual');
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  }

  function showRsus() {
    setFilter('all');
    requestAnimationFrame(() => {
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      rsuRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  }

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-28 rounded-3xl" />
        <Skeleton className="h-24 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
      </div>
    );
  }

  const holdings = data?.holdings || [];
  const grants = data?.rsuGrants || [];
  const rsuSummary = data?.rsuSummary || EMPTY_RSU_SUMMARY;
  const byType = data?.totals.byType || { stock: 0, etf: 0, crypto: 0, rsu: 0, cash: 0 };
  const slices: AllocationSlice[] = (Object.keys(TYPE_META) as Array<keyof typeof TYPE_META>).map((key) => ({ key, value: byType[key] || 0 }));
  const isEmpty = holdings.length === 0 && grants.length === 0;
  const showRsuSection = (filter === 'all' && grants.length > 0) || filter === 'rsu';
  const visibleHoldings = filter === 'rsu' ? [] : holdings;

  const addMenu = (
    <AddMenu
      onAddHolding={() => openHolding(null, filter === 'etf' || filter === 'crypto' ? filter : 'stock')}
      onAddCash={() => openHolding(null, 'cash')}
      onAddRsu={() => openGrant(null)}
      onSync={() => void handleSyncActual()}
      syncing={syncing}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2 md:items-start">
        <PortfolioHero totals={data?.totals ?? null} baseCurrency={cur} unvestedRsuValue={rsuSummary.unvestedNetValueBase} onShowRsus={showRsus} />
        <AllocationCard slices={slices} baseCurrency={cur} filter={filter} onFilter={setFilter} />
      </div>

      {/* Toolbar: change mode on the left, the page's single Add menu on the right */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {filter !== 'rsu' && holdings.length > 0 && <ChangeModeToggle value={mode} onChange={setMode} />}
          {filter !== 'all' && (
            <Button
              type="button"
              onClick={() => setFilter('all')}
              className="press flex h-9 min-w-0 items-center gap-1 rounded-full pl-3.5 pr-2.5 text-label"
              style={{ backgroundColor: 'var(--bg-surface)' }}
              aria-label={`Showing ${TYPE_META[filter].label} only. Show all`}
            >
              <span className="truncate">{TYPE_META[filter].label}</span>
              <X className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
            </Button>
          )}
        </div>
        {addMenu}
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl px-6 py-8 text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <p className="text-heading">Nothing tracked yet</p>
          <p className="text-body" style={{ color: 'var(--text-muted)' }}>
            Add stocks, ETFs and crypto (e.g. D05.SI, VWRA.L, BTC), cash sitting in a brokerage, or RSU grants. Everything is valued live in {cur}.
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="default" onClick={() => openHolding(null, 'stock')} className="h-11 rounded-full px-5 text-label">
              Add holding
            </Button>
            <Button type="button" variant="secondary" onClick={() => openHolding(null, 'cash')} className="h-11 rounded-full px-5 text-label">
              Add cash
            </Button>
            <Button type="button" variant="secondary" onClick={() => openGrant(null)} className="h-11 rounded-full px-5 text-label">
              Add RSU grant
            </Button>
          </div>
        </div>
      ) : (
        filter !== 'all' &&
        filter !== 'rsu' &&
        !holdings.some((h) => h.asset_type === filter) && (
          <p className="rounded-3xl p-6 text-center text-body" style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
            No {TYPE_META[filter].label.toLowerCase()} yet.
          </p>
        )
      )}

      <HoldingGroups
        holdings={visibleHoldings}
        byType={byType}
        filter={filter}
        mode={mode}
        baseCurrency={cur}
        accountMap={accountMap}
        onOpen={(h) => openHolding(h, h.asset_type)}
      />

      {showRsuSection && (
        <div ref={rsuRef} className="scroll-mt-24">
          <RsuSection
            grants={grants}
            summary={rsuSummary}
            baseCurrency={cur}
            accountMap={accountMap}
            onAddGrant={() => openGrant(null)}
            onEditGrant={(g) => openGrant(g)}
            onAddTranche={(grant) => setTrancheSheet({ open: true, grant, tranche: null })}
            onEditTranche={(grant, tranche) => setTrancheSheet({ open: true, grant, tranche })}
          />
        </div>
      )}

      <HoldingSheet
        open={holdingSheet.open}
        onClose={() => setHoldingSheet((p) => ({ ...p, open: false }))}
        editing={holdingSheet.editing}
        initialType={holdingSheet.type}
        baseCurrency={cur}
        accounts={accounts}
        onSaved={saved(true)}
        onError={failed}
      />

      <RsuGrantSheet
        open={grantSheet.open}
        onClose={() => setGrantSheet((p) => ({ ...p, open: false }))}
        editing={grantSheet.editing}
        accounts={accounts}
        onSaved={saved(true)}
        onError={failed}
      />

      <RsuTrancheSheet
        open={trancheSheet.open}
        onClose={() => setTrancheSheet((p) => ({ ...p, open: false }))}
        grant={trancheSheet.grant}
        tranche={trancheSheet.tranche}
        baseCurrency={cur}
        onSaved={saved(false)}
        onError={failed}
      />
    </div>
  );
}
