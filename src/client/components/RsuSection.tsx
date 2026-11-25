import { useState, type ReactNode } from 'react';
import { ChevronDown, Link2, Pencil, Plus } from 'lucide-react';
import type { EnrichedRsuGrant, EnrichedRsuTranche, RsuEffectiveStatus, RsuSummary } from '@shared/types';
import { HIDDEN_VALUE, useFinancialValues } from '../lib/valueVisibility';
import { Button } from '@client/components/ui/button';
import { Card } from '@client/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@client/components/ui/collapsible';
import { SectionHeader, SymbolTile } from './portfolio/parts';
import { TYPE_META, dateParts, formatShortDate, formatVestCountdown, tileVars, visibleUnits } from './portfolio/format';

interface RsuSectionProps {
  grants: EnrichedRsuGrant[];
  summary: RsuSummary;
  baseCurrency: string;
  accountMap: Map<string, string>;
  /** Shown in the header's right slot when there are no grants yet (e.g. while filtered to RSUs). */
  onAddGrant: () => void;
  onEditGrant: (grant: EnrichedRsuGrant) => void;
  onAddTranche: (grant: EnrichedRsuGrant) => void;
  onEditTranche: (grant: EnrichedRsuGrant, tranche: EnrichedRsuTranche) => void;
}

const RSU_TILE = TYPE_META.rsu.tile;
const UPCOMING_PREVIEW = 3;

function statusLabel(status: RsuEffectiveStatus): { label: string; color: string } {
  switch (status) {
    case 'vested':
      return { label: 'Vested', color: 'var(--positive)' };
    case 'sold':
      return { label: 'Sold', color: 'var(--info)' };
    case 'forfeited':
      return { label: 'Forfeited', color: 'var(--negative)' };
    default:
      return { label: 'Upcoming', color: 'var(--text-muted)' };
  }
}

function SubLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <span className="text-label" style={{ color: 'var(--text-muted)' }}>
        {children}
      </span>
      {right}
    </div>
  );
}

export function RsuSection({ grants, summary, baseCurrency: cur, accountMap, onAddGrant, onEditGrant, onAddTranche, onEditTranche }: RsuSectionProps) {
  const { valuesHidden, formatMoney } = useFinancialValues();
  const units = valuesHidden ? () => HIDDEN_VALUE : visibleUnits;
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  if (grants.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <SectionHeader title="RSUs" />
        <div className="flex flex-col items-center gap-3 rounded-3xl p-6 text-center" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <p className="text-body">No RSU grants yet</p>
          <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
            Add a grant and its vesting schedule to see vested shares, upcoming vests and their value in {cur}.
          </p>
          <Button type="button" variant="default" onClick={onAddGrant} className="h-11 rounded-full px-5 text-label">
            Add RSU grant
          </Button>
        </div>
      </section>
    );
  }

  const in12m = summary.upcomingTranches.filter((t) => t.daysUntilVest <= 365).length;
  const next = summary.nextVest;
  const nextCd = next ? formatVestCountdown(next.daysUntilVest) : null;
  const stats: Array<{ label: string; value: ReactNode; sub: ReactNode; accent?: boolean }> = [
    {
      label: 'Vested & held',
      value: formatMoney(summary.heldValueBase, cur, true),
      sub:
        summary.includedHeldValueBase === summary.heldValueBase
          ? 'Counted in total'
          : summary.includedHeldValueBase === 0
            ? 'Not counted in total'
            : `${formatMoney(summary.includedHeldValueBase, cur, true)} counted`,
    },
    {
      label: 'Unvested',
      value: formatMoney(summary.unvestedNetValueBase, cur, true),
      sub:
        summary.unvestedGrossValueBase > summary.unvestedNetValueBase + 1
          ? `${formatMoney(summary.unvestedGrossValueBase, cur, true)} before tax`
          : 'At today’s price',
    },
    {
      label: 'Next 12 months',
      value: formatMoney(summary.next12mNetValueBase, cur, true),
      sub: `${in12m} vest${in12m === 1 ? '' : 's'}`,
    },
    next && nextCd
      ? {
          label: 'Next vest',
          value: nextCd.label,
          accent: nextCd.soon,
          sub: `${units(next.units)} ${next.symbol} · ${formatShortDate(next.vestDate, false)}`,
        }
      : { label: 'Next vest', value: 'None', sub: 'Fully vested' },
  ];

  const upcoming = showAllUpcoming ? summary.upcomingTranches : summary.upcomingTranches.slice(0, UPCOMING_PREVIEW);
  const maxYear = Math.max(1, ...summary.byYear.map((y) => y.netValueBase));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionHeader
          title="RSUs"
          right={
            <span className="text-body font-semibold tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {formatMoney(summary.heldValueBase, cur)}
            </span>
          }
        />
        <div className="grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <Card key={s.label} variant="flat" className="flex min-w-0 flex-col gap-1 rounded-2xl p-3.5">
              <span className="truncate text-caption" style={{ color: 'var(--text-muted)' }}>
                {s.label}
              </span>
              <span className="truncate text-stat tabular-nums" style={s.accent ? { color: 'var(--accent-text)' } : undefined}>
                {s.value}
              </span>
              <span className="truncate text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {s.sub}
              </span>
            </Card>
          ))}
        </div>
      </div>

      {/* Grants */}
      <div className="flex flex-col gap-2">
        <SubLabel>Grants</SubLabel>
        <div className="flex flex-col rounded-3xl px-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
          {grants.map((g, i) => (
            <GrantRow
              key={g.id}
              grant={g}
              first={i === 0}
              open={Boolean(openIds[g.id])}
              onOpenChange={(o) => setOpenIds((prev) => ({ ...prev, [g.id]: o }))}
              baseCurrency={cur}
              accountMap={accountMap}
              onEditGrant={onEditGrant}
              onAddTranche={onAddTranche}
              onEditTranche={onEditTranche}
            />
          ))}
        </div>
      </div>

      {/* Upcoming vests */}
      {summary.upcomingTranches.length > 0 && (
        <div className="flex flex-col gap-2">
          <SubLabel
            right={
              <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {summary.upcomingTranches.length} scheduled
              </span>
            }
          >
            Upcoming vests
          </SubLabel>
          <div className="flex flex-col rounded-3xl px-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            {upcoming.map((item, i) => {
              const cd = formatVestCountdown(item.daysUntilVest);
              const { month, day } = dateParts(item.vestDate);
              const grant = grants.find((g) => g.id === item.grantId);
              const tranche = grant?.tranches.find((t) => t.id === item.trancheId);
              return (
                <Button
                  key={item.trancheId}
                  type="button"
                  disabled={!grant || !tranche}
                  onClick={() => grant && tranche && onEditTranche(grant, tranche)}
                  className="press flex w-full items-center gap-3 py-3 text-left"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-[42px] w-[42px] shrink-0 flex-col items-center justify-center rounded-[14px] tabular-nums"
                    style={{ backgroundColor: 'var(--bg-subtle)' }}
                  >
                    <span className="text-caption" style={{ color: 'var(--text-muted)', lineHeight: 1 }}>
                      {month}
                    </span>
                    <span className="text-body font-bold" style={{ lineHeight: 1.1 }}>
                      {day}
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body">
                      {item.symbol} · {item.grantName || item.name}
                    </span>
                    <span className="truncate text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {units(item.units)} sh
                      {item.netUnits < item.units - 0.001 && ` · ${units(item.netUnits)} after tax`}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="text-body font-semibold tabular-nums">
                      {item.netValueBase !== null ? formatMoney(item.netValueBase, cur) : '—'}
                    </span>
                    <span className="text-caption" style={{ color: cd.soon ? 'var(--accent-text)' : 'var(--text-muted)' }}>
                      {cd.label}
                    </span>
                  </span>
                </Button>
              );
            })}
            {summary.upcomingTranches.length > UPCOMING_PREVIEW && (
              <Button
                type="button"
                onClick={() => setShowAllUpcoming((v) => !v)}
                className="min-h-11 w-full text-label"
                style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--accent-text)' }}
              >
                {showAllUpcoming ? 'Show fewer' : `Show all ${summary.upcomingTranches.length}`}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Vesting by year */}
      {!valuesHidden && summary.byYear.length > 0 && (
        <div className="flex flex-col gap-2">
          <SubLabel
            right={
              <span className="flex items-center gap-3 text-caption" style={{ color: 'var(--text-muted)' }}>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tileVars(RSU_TILE).backgroundColor }} />
                  Vested
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tileVars(RSU_TILE).backgroundColor, opacity: 0.4 }} />
                  Upcoming
                </span>
              </span>
            }
          >
            Vesting by year
          </SubLabel>
          <div className="flex flex-col gap-3 rounded-3xl p-4" style={{ backgroundColor: 'var(--bg-surface)' }}>
            {summary.byYear.map((yr) => (
              <div key={yr.year} className="grid grid-cols-[2.75rem_1fr_auto] items-center gap-3">
                <span className="text-label tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {yr.year}
                </span>
                <div
                  className="flex h-2 overflow-hidden rounded-full"
                  role="img"
                  aria-label={`${yr.year}: ${formatMoney(yr.vestedValueBase, cur)} vested, ${formatMoney(yr.unvestedValueBase, cur)} upcoming`}
                  style={{ backgroundColor: 'var(--bg-subtle)' }}
                >
                  <div style={{ width: `${(yr.vestedValueBase / maxYear) * 100}%`, backgroundColor: tileVars(RSU_TILE).backgroundColor }} />
                  <div style={{ width: `${(yr.unvestedValueBase / maxYear) * 100}%`, backgroundColor: tileVars(RSU_TILE).backgroundColor, opacity: 0.4 }} />
                </div>
                <span className="text-caption tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {formatMoney(yr.netValueBase, cur, true)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function GrantRow({
  grant: g,
  first,
  open,
  onOpenChange,
  baseCurrency: cur,
  accountMap,
  onEditGrant,
  onAddTranche,
  onEditTranche,
}: {
  grant: EnrichedRsuGrant;
  first: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseCurrency: string;
  accountMap: Map<string, string>;
  onEditGrant: (grant: EnrichedRsuGrant) => void;
  onAddTranche: (grant: EnrichedRsuGrant) => void;
  onEditTranche: (grant: EnrichedRsuGrant, tranche: EnrichedRsuTranche) => void;
}) {
  const { valuesHidden, formatMoney, formatPrice } = useFinancialValues();
  const units = valuesHidden ? () => HIDDEN_VALUE : visibleUnits;
  const linkedName = g.actual_account_id ? accountMap.get(g.actual_account_id) || 'Linked' : null;
  const vestedPct = Math.min(100, Math.max(0, g.vestedPct));

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} style={{ borderTop: first ? 'none' : '1px solid var(--border-subtle)' }}>
      <CollapsibleTrigger asChild>
        <Button type="button" className="press flex w-full items-center gap-3 py-3 text-left" aria-label={`${g.symbol} ${g.grant_name || 'grant'}, show vesting`}>
          <SymbolTile symbol={g.symbol} tile={RSU_TILE} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body">{g.grant_name || g.name}</span>
            <span className="flex min-w-0 items-center gap-1 text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
              <span className="truncate">
                {valuesHidden ? HIDDEN_VALUE : `${vestedPct.toFixed(0)}%`} vested
                {!g.include_in_total && ' · not in total'}
              </span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end">
            <span className="text-body font-semibold tabular-nums">{g.heldValueBase !== null ? formatMoney(g.heldValueBase, cur) : 'No quote'}</span>
            <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {g.unvestedUnits > 0 && g.unvestedNetValueBase !== null ? `+${formatMoney(g.unvestedNetValueBase, cur, true)} unvested` : 'Fully vested'}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-4 w-4 shrink-0 transition-transform duration-200"
            style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transitionTimingFunction: 'var(--ease-out)' }}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pb-4">
        {!valuesHidden && (
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--bg-subtle)' }}>
              <div className="h-full rounded-full" style={{ width: `${vestedPct}%`, backgroundColor: tileVars(RSU_TILE).backgroundColor }} />
            </div>
            <span className="text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {units(g.heldUnits)} held
              {g.soldUnits > 0 && ` · ${units(g.soldUnits)} sold`}
              {g.unvestedUnits > 0 && ` · ${units(g.unvestedUnits)} unvested`}
              {g.tax_withhold_pct > 0 && ` · ${g.tax_withhold_pct}% tax est.`} · granted {formatShortDate(g.grant_date)}
              {linkedName && (
                <>
                  {' · '}
                  <Link2 className="inline h-3 w-3 align-[-2px]" aria-label="Linked to" /> {linkedName}
                </>
              )}
            </span>
          </div>
        )}
        <div className="divider-list overflow-hidden rounded-2xl" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          {g.tranches.map((t) => {
            const st = statusLabel(t.effectiveStatus);
            const cd = formatVestCountdown(t.daysUntilVest);
            return (
              <Button
                key={t.id}
                type="button"
                onClick={() => onEditTranche(g, t)}
                aria-label={`Edit ${formatShortDate(t.vest_date)} vest`}
                className="press flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body tabular-nums">{formatShortDate(t.vest_date)}</span>
                  <span className="truncate text-caption tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {units(t.units)} sh
                    {t.netUnits < t.units - 0.001 && ` · ${units(t.netUnits)} net`}
                    {t.vested_price !== null && ` · FMV ${formatPrice(t.vested_price, g.currency)}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-body font-semibold tabular-nums">{t.netValueBase !== null ? formatMoney(t.netValueBase, cur) : '—'}</span>
                  <span className="text-caption" style={{ color: st.color }}>
                    {t.effectiveStatus === 'unvested' ? cd.label : st.label}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" onClick={() => onEditGrant(g)} className="flex h-11 items-center justify-center gap-1.5 rounded-2xl text-label">
            <Pencil className="h-4 w-4" />
            Edit grant
          </Button>
          <Button type="button" variant="secondary" onClick={() => onAddTranche(g)} className="flex h-11 items-center justify-center gap-1.5 rounded-2xl text-label">
            <Plus className="h-4 w-4" />
            Add vest
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
