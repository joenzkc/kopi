import React, { useState } from 'react';
import {
  Award,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Edit3,
  Link2,
  Plus,
  Trash2,
} from 'lucide-react';
import type { EnrichedRsuGrant, EnrichedRsuTranche, RsuEffectiveStatus, RsuSummary } from '@shared/types';
import { formatMoney, formatPct, formatPrice, formatSignedMoney } from '../lib/api';
import { Button } from '@client/components/ui/button';
import { Badge } from '@client/components/ui/badge';
import { Card } from '@client/components/ui/card';
import { Progress } from '@client/components/ui/progress';

interface RsuSectionProps {
  grants: EnrichedRsuGrant[];
  summary: RsuSummary;
  baseCurrency: string;
  accountMap: Map<string, string>;
  mode: 'compact' | 'full';
  onViewAllRsu?: () => void;
  onAddGrant: () => void;
  onEditGrant: (grant: EnrichedRsuGrant) => void;
  onDeleteGrant: (grant: EnrichedRsuGrant) => void;
  onAddTranche: (grant: EnrichedRsuGrant) => void;
  onEditTranche: (grant: EnrichedRsuGrant, tranche: EnrichedRsuTranche) => void;
  onQuickToggleSold: (grant: EnrichedRsuGrant, tranche: EnrichedRsuTranche) => void;
}

function formatUnits(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? n.toLocaleString('en-US') : Number(n.toFixed(3)).toLocaleString('en-US');
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-SG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatVestCountdown(days: number): { label: string; highlight: boolean } {
  if (days < 0) return { label: `${Math.abs(days)}d ago`, highlight: false };
  if (days === 0) return { label: 'Today', highlight: true };
  if (days === 1) return { label: 'Tomorrow', highlight: true };
  if (days <= 30) return { label: `In ${days}d`, highlight: true };
  if (days < 365) return { label: `In ${Math.round(days / 30)}mo`, highlight: false };
  return { label: `In ${(days / 365).toFixed(1)}yr`, highlight: false };
}

function statusPillStyle(status: RsuEffectiveStatus): { bg: string; color: string; label: string } {
  switch (status) {
    case 'vested':
      return { bg: 'var(--positive-soft)', color: 'var(--positive)', label: 'Vested' };
    case 'sold':
      return { bg: 'var(--info-soft)', color: 'var(--info)', label: 'Sold' };
    case 'forfeited':
      return { bg: 'var(--negative-soft)', color: 'var(--negative)', label: 'Forfeited' };
    case 'unvested':
    default:
      return { bg: 'var(--bg-subtle)', color: 'var(--text-secondary)', label: 'Upcoming' };
  }
}

export function RsuSection({
  grants,
  summary,
  baseCurrency,
  accountMap,
  mode,
  onViewAllRsu,
  onAddGrant,
  onEditGrant,
  onDeleteGrant,
  onAddTranche,
  onEditTranche,
  onQuickToggleSold,
}: RsuSectionProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>(() =>
    grants.length === 1 ? { [grants[0].id]: true } : {},
  );
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (grants.length === 0) {
    if (mode === 'compact') return null;
    return (
      <Card className="rounded-2xl p-8 text-center">
        <Award className="mx-auto h-8 w-8" style={{ color: '#8B6BB1' }} />
        <p className="mt-3 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          No RSU grants tracked yet
        </p>
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          Add your equity grants and vesting schedules to track vested shares, upcoming vests, and projected annual equity value in {baseCurrency}.
        </p>
        <Button
          type="button"
          onClick={onAddGrant}
          variant="default" className="mt-4 rounded-xl px-4 py-2 text-xs font-medium"
        >
          Add your first RSU grant
        </Button>
      </Card>
    );
  }

  const maxYearVal = Math.max(1, ...summary.byYear.map((y) => y.netValueBase));
  const visibleUpcoming = showAllUpcoming ? summary.upcomingTranches : summary.upcomingTranches.slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Compact section header on All tab */}
      {mode === 'compact' && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 whitespace-nowrap text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              RSUs &amp; Vesting
            </h2>
            {summary.unvestedNetValueBase > 0 && (
              <Badge
                className="truncate whitespace-nowrap px-2 py-0.5 text-[11px] font-medium tabular-nums"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
              >
                {formatMoney(summary.unvestedNetValueBase, baseCurrency, true)} unvested
              </Badge>
            )}
          </div>
          {onViewAllRsu && (
            <Button
              type="button"
              onClick={onViewAllRsu}
              className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-semibold transition hover:opacity-80"
              style={{ color: 'var(--accent-text)' }}
            >
              Schedule
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      )}

      {/* Full mode: KPI Strip */}
      {mode === 'full' && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Card className="min-w-0 overflow-hidden rounded-2xl p-3.5">
            <div className="truncate text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              Vested &amp; Held
            </div>
            <div className="mt-1 truncate text-lg font-bold tracking-tight tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {formatMoney(summary.heldValueBase, baseCurrency, true)}
            </div>
            <div className="mt-0.5 truncate text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {summary.includedHeldValueBase !== summary.heldValueBase
                ? `${formatMoney(summary.includedHeldValueBase, baseCurrency, true)} in total`
                : 'Counted in total'}
            </div>
          </Card>

          <Card className="min-w-0 overflow-hidden rounded-2xl p-3.5">
            <div className="truncate text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              Unvested Value
            </div>
            <div className="mt-1 truncate text-lg font-bold tracking-tight tabular-nums" style={{ color: '#B9A6FF' }}>
              {formatMoney(summary.unvestedNetValueBase, baseCurrency, true)}
            </div>
            <div className="mt-0.5 truncate text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {summary.unvestedGrossValueBase > summary.unvestedNetValueBase + 1
                ? `Gross ${formatMoney(summary.unvestedGrossValueBase, baseCurrency, true)}`
                : 'Est. at live price'}
            </div>
          </Card>

          <Card className="min-w-0 overflow-hidden rounded-2xl p-3.5">
            <div className="truncate text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              Next 12 Months
            </div>
            <div className="mt-1 truncate text-lg font-bold tracking-tight tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {formatMoney(summary.next12mNetValueBase, baseCurrency, true)}
            </div>
            <div className="mt-0.5 truncate text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {summary.upcomingTranches.filter((t) => t.daysUntilVest <= 365).length} upcoming vest
              {summary.upcomingTranches.filter((t) => t.daysUntilVest <= 365).length === 1 ? '' : 's'}
            </div>
          </Card>

          <Card className="min-w-0 overflow-hidden rounded-2xl p-3.5">
            <div className="truncate text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              Next Vest
            </div>
            {summary.nextVest ? (
              <>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="truncate text-lg font-bold tracking-tight tabular-nums" style={{ color: 'var(--accent-text)' }}>
                    {formatVestCountdown(summary.nextVest.daysUntilVest).label}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {formatUnits(summary.nextVest.units)} {summary.nextVest.symbol} · {formatShortDate(summary.nextVest.vestDate)}
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 truncate text-lg font-bold" style={{ color: 'var(--positive)' }}>
                  Fully vested
                </div>
                <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  No upcoming vests
                </div>
              </>
            )}
          </Card>
        </div>
      )}

      {/* Full mode: Vesting by Year */}
      {mode === 'full' && summary.byYear.length > 0 && (
        <Card as="section" className="rounded-2xl p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Vesting by Year ({baseCurrency})
            </h3>
            <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#8B6BB1' }} />
                Vested
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'rgba(139, 107, 177, 0.35)' }} />
                Upcoming
              </span>
            </div>
          </div>
          <div className="space-y-2.5">
            {summary.byYear.map((yr) => {
              const vestedW = maxYearVal > 0 ? (yr.vestedValueBase / maxYearVal) * 100 : 0;
              const unvestedW = maxYearVal > 0 ? (yr.unvestedValueBase / maxYearVal) * 100 : 0;
              return (
                <div key={yr.year} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                    <span className="min-w-0 truncate font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {yr.year}{' '}
                      <span className="font-normal" style={{ color: 'var(--text-muted)' }}>
                        · {formatUnits(yr.units)} sh
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatMoney(yr.netValueBase, baseCurrency)}
                    </span>
                  </div>
                  <div
                    className="flex h-2 w-full overflow-hidden rounded-full"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    {vestedW > 0 && <div style={{ width: `${vestedW}%`, backgroundColor: '#8B6BB1' }} />}
                    {unvestedW > 0 && (
                      <div style={{ width: `${unvestedW}%`, backgroundColor: 'rgba(139, 107, 177, 0.38)' }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Full mode: Upcoming Vesting Timeline */}
      {mode === 'full' && summary.upcomingTranches.length > 0 && (
        <Card as="section" className="overflow-hidden rounded-2xl">
          <div
            className="flex items-center justify-between gap-2 px-4 py-3"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              <CalendarClock className="h-3.5 w-3.5 shrink-0" style={{ color: '#8B6BB1' }} />
              <span className="truncate">Upcoming Vesting</span>
            </div>
            <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {summary.upcomingTranches.length} scheduled
            </span>
          </div>
          <div className="divider-list">
            {visibleUpcoming.map((item) => {
              const cd = formatVestCountdown(item.daysUntilVest);
              return (
                <div key={item.trancheId} className="flex items-center justify-between gap-2.5 px-4 py-3 text-xs">
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold"
                      style={{
                        backgroundColor: 'var(--bg-subtle)',
                        color: 'var(--text-primary)',
                        borderLeft: '3px solid #8B6BB1',
                      }}
                    >
                      {item.symbol.slice(0, 5)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                          {formatShortDate(item.vestDate)}
                        </span>
                        <Badge
                          className="px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{
                            backgroundColor: cd.highlight ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                            color: cd.highlight ? 'var(--accent-text)' : 'var(--text-muted)',
                          }}
                        >
                          {cd.label}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {item.grantName} · {formatUnits(item.units)} sh
                        {item.netUnits < item.units - 0.001 && ` (${formatUnits(item.netUnits)} net)`}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {item.netValueBase !== null ? formatMoney(item.netValueBase, baseCurrency) : '—'}
                    </div>
                    {item.grossValueBase !== null &&
                      item.netValueBase !== null &&
                      item.grossValueBase > item.netValueBase + 1 && (
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                          Gross {formatMoney(item.grossValueBase, baseCurrency, true)}
                        </div>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
          {summary.upcomingTranches.length > 5 && (
            <Button
              type="button"
              onClick={() => setShowAllUpcoming((v) => !v)}
              className="w-full py-2.5 text-center text-xs font-semibold transition hover:opacity-80"
              style={{
                borderTop: '1px solid var(--border-subtle)',
                color: 'var(--accent-text)',
                backgroundColor: 'var(--bg-surface)',
              }}
            >
              {showAllUpcoming ? 'Show fewer' : `Show all ${summary.upcomingTranches.length} upcoming vests`}
            </Button>
          )}
        </Card>
      )}

      {/* RSU Grants Cards */}
      <Card className="divider-list overflow-hidden rounded-2xl">
        {grants.map((g) => {
          const isExpanded = Boolean(expandedIds[g.id]);
          const up24 = (g.change24hPct ?? 0) >= 0;
          const upPnl = (g.unrealizedPnlBase ?? 0) >= 0;

          return (
            <div key={g.id} className="p-4">
              {/* Top row: symbol + grant name + live values */}
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-semibold"
                    style={{
                      backgroundColor: 'var(--bg-subtle)',
                      color: 'var(--text-primary)',
                      borderLeft: '3px solid #8B6BB1',
                    }}
                  >
                    {g.symbol.slice(0, 5)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {g.symbol}
                      </span>
                      <Badge
                        className="px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ backgroundColor: 'rgba(139, 107, 177, 0.2)', color: '#C8B8FF' }}
                      >
                        RSU
                      </Badge>
                      {g.actual_account_id && (
                        <Badge
                          className="inline-flex max-w-full items-center gap-0.5 truncate px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-text)' }}
                        >
                          <Link2 className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">{accountMap.get(g.actual_account_id) || 'Linked'}</span>
                        </Badge>
                      )}
                      {!g.include_in_total && (
                        <Badge
                          className="px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-muted)' }}
                        >
                          Schedule only
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                      {g.grant_name ? `${g.grant_name} · ${g.name}` : g.name}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 text-right tabular-nums">
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {g.heldValueBase !== null ? formatMoney(g.heldValueBase, baseCurrency) : 'Quote N/A'}
                  </div>
                  <div className="text-xs font-medium" style={{ color: up24 ? 'var(--positive)' : 'var(--negative)' }}>
                    {g.price !== null ? formatPrice(g.price, g.priceCurrency) : '—'} · {formatPct(g.change24hPct)}
                  </div>
                </div>
              </div>

              {/* Vesting Progress Bar */}
              <div className="mt-3">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
                  <span style={{ color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{g.vestedPct.toFixed(0)}% vested</strong> ·{' '}
                    {formatUnits(g.heldUnits)} held
                    {g.soldUnits > 0 && ` · ${formatUnits(g.soldUnits)} sold`}
                    {g.unvestedUnits > 0 && ` · ${formatUnits(g.unvestedUnits)} unvested`}
                  </span>
                  {g.unvestedNetValueBase !== null && g.unvestedUnits > 0 && (
                    <span className="shrink-0" style={{ color: '#C8B8FF' }}>
                      {formatMoney(g.unvestedNetValueBase, baseCurrency, true)} unvested
                    </span>
                  )}
                </div>
                <Progress
                  aria-label={`Vesting progress for ${g.grant_name || g.symbol}`}
                  value={Math.min(100, Math.max(0, g.vestedPct))}
                  className="bg-secondary"
                  indicatorClassName="transition-all"
                  indicatorStyle={{ backgroundColor: '#8B6BB1' }}
                />
              </div>

              {/* Footer metadata + actions */}
              <div
                className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2.5 text-xs tabular-nums"
                style={{ borderTop: '1px solid var(--border-subtle)' }}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" style={{ color: 'var(--text-muted)' }}>
                  <span>
                    Granted <strong className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatShortDate(g.grant_date)}</strong>
                  </span>
                  {g.nextVest && (
                    <span>
                      Next:{' '}
                      <strong className="font-medium" style={{ color: 'var(--accent-text)' }}>
                        {formatUnits(g.nextVest.units)} on {formatShortDate(g.nextVest.vestDate)}
                      </strong>
                    </span>
                  )}
                  {g.unrealizedPnlBase !== null && g.costBasisBase > 0 && (
                    <span style={{ color: upPnl ? 'var(--positive)' : 'var(--negative)' }}>
                      P&amp;L {formatSignedMoney(g.unrealizedPnlBase, baseCurrency)} ({formatPct(g.unrealizedPnlPct)})
                    </span>
                  )}
                  {g.tax_withhold_pct > 0 && <span>Tax est. {g.tax_withhold_pct}%</span>}
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    onClick={() => toggleExpand(g.id)}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition hover:opacity-80"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
                  >
                    {g.tranches.length} vest{g.tranches.length === 1 ? '' : 's'}
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => onEditGrant(g)}
                    className="rounded-lg p-1.5 transition hover:opacity-80"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Edit RSU grant"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    onClick={() => onDeleteGrant(g)}
                    className="rounded-lg p-1.5 transition hover:opacity-80"
                    style={{ color: 'var(--negative)' }}
                    aria-label="Delete RSU grant"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Expanded Tranche Schedule */}
              {isExpanded && (
                <div
                  className="mt-3 overflow-hidden rounded-xl"
                  style={{ backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                    {g.tranches.map((t) => {
                      const st = statusPillStyle(t.effectiveStatus);
                      const cd = formatVestCountdown(t.daysUntilVest);
                      return (
                        <div
                          key={t.id}
                          className="flex flex-col gap-1.5 px-3 py-2.5 text-xs"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          {/* Row 1: Date + status + countdown | Value */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                                {formatShortDate(t.vest_date)}
                              </span>
                              <Badge
                                className="px-1.5 py-0.5 text-[10px] font-semibold"
                                style={{ backgroundColor: st.bg, color: st.color }}
                              >
                                {st.label}
                              </Badge>
                              {t.effectiveStatus === 'unvested' && (
                                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                                  {cd.label}
                                </span>
                              )}
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                              {t.netValueBase !== null ? formatMoney(t.netValueBase, baseCurrency) : '—'}
                            </span>
                          </div>

                          {/* Row 2: Shares/FMV/notes | Quick actions */}
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1 truncate text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                              {formatUnits(t.units)} sh
                              {t.netUnits < t.units - 0.001 && ` · ${formatUnits(t.netUnits)} net`}
                              {t.vested_price !== null && ` · FMV ${formatPrice(t.vested_price, g.currency)}`}
                              {t.notes && ` · ${t.notes}`}
                            </div>

                            <div className="flex shrink-0 items-center gap-1.5">
                              {(t.effectiveStatus === 'vested' || t.effectiveStatus === 'sold') && (
                                <Button
                                  type="button"
                                  onClick={() => onQuickToggleSold(g, t)}
                                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition hover:opacity-80"
                                  style={{
                                    backgroundColor: t.effectiveStatus === 'sold' ? 'var(--info-soft)' : 'var(--bg-surface)',
                                    color: t.effectiveStatus === 'sold' ? 'var(--info)' : 'var(--text-secondary)',
                                  }}
                                  title={t.effectiveStatus === 'sold' ? 'Mark back as vested & held' : 'Mark tranche as sold'}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  {t.effectiveStatus === 'sold' ? 'Sold' : 'Mark sold'}
                                </Button>
                              )}

                              <Button
                                type="button"
                                onClick={() => onEditTranche(g, t)}
                                className="rounded-lg p-1 transition hover:opacity-80"
                                style={{ color: 'var(--text-muted)' }}
                                aria-label="Edit tranche"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    className="flex items-center justify-between px-3 py-2"
                    style={{ borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--bg-surface)' }}
                  >
                    <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      Total: {formatUnits(g.totalUnits)} shares
                    </span>
                    <Button
                      type="button"
                      onClick={() => onAddTranche(g)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold transition hover:opacity-80"
                      style={{ color: 'var(--accent-text)' }}
                    >
                      <Plus className="h-3 w-3" />
                      Add tranche
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
