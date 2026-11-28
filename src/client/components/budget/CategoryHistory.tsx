import type { BudgetHistoryPoint } from '@shared/types';
import { useFinancialValues } from '../../lib/valueVisibility';

const muted = { color: 'var(--text-muted)' };

function monthKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Colour for one month of history, shared by the panel chart and the Budget table's Last 3 mo column. */
export function historyBarColor(p: BudgetHistoryPoint): string {
  if (!p) return 'var(--bg-subtle)';
  // Ended overspent, as Actual counts it (carry-in included).
  if (p.balance < 0) return 'var(--negative)';
  // Something happened and it didn't end overspent: spending, a refund, or money set aside with nothing spent.
  if (p.spent !== 0 || p.budgeted !== 0) return 'var(--accent)';
  return 'var(--bg-subtle)';
}

function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-SG', { month: 'short' });
}

/** Bars of spending per month, with a tick at what was budgeted. Red only where the month ended overspent (negative
 *  balance, as Actual counts it): spending past the month's budget that earlier savings covered isn't overspending. */
export function CategoryHistory({ months, points, baseCurrency }: { months: string[]; points: BudgetHistoryPoint[]; baseCurrency: string }) {
  const { formatMoney } = useFinancialValues();
  const money = (cents: number) => formatMoney(cents / 100, baseCurrency);
  const scale = Math.max(1, ...points.map((p) => Math.max(p?.spent ?? 0, p?.budgeted ?? 0)));
  // Averages leave out the month in progress, which would drag them down.
  const thisMonth = monthKey();
  const done = points.filter((p, i): p is NonNullable<BudgetHistoryPoint> => p !== null && months[i] < thisMonth);
  const avg = (key: 'spent' | 'budgeted') => Math.round(done.reduce((s, p) => s + p[key], 0) / done.length);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="category-history-heading">
      <h3 id="category-history-heading" className="text-label" style={muted}>
        Last {months.length} months
      </h3>
      <div
        role="img"
        aria-label={months.map((m, i) => `${shortMonth(m)} ${points[i] ? `${money(points[i]!.spent)} spent of ${money(points[i]!.budgeted)}${points[i]!.balance < 0 ? ', overspent' : ''}` : 'no data'}`).join(', ')}
        className="flex h-24 items-end gap-2"
      >
        {months.map((m, i) => {
          const p = points[i];
          return (
            <div key={m} className="flex h-full flex-1 flex-col items-center gap-1">
              <div className="relative w-full flex-1">
                {p && (
                  <>
                    {/* A month with nothing spent still gets a stub, so money set aside shows as lime. */}
                    <span
                      className="absolute inset-x-0 bottom-0 rounded-md"
                      style={{
                        height: `${Math.max(0, (p.spent / scale) * 100)}%`,
                        minHeight: 4,
                        backgroundColor: historyBarColor(p),
                        opacity: m === thisMonth ? 0.55 : 1,
                      }}
                    />
                    {p.budgeted > 0 && (
                      <span className="absolute -inset-x-0.5 h-0.5 rounded-full" style={{ bottom: `${(p.budgeted / scale) * 100}%`, backgroundColor: 'var(--text-secondary)' }} />
                    )}
                  </>
                )}
              </div>
              <span className="text-caption" style={muted}>
                {shortMonth(m)}
              </span>
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <span className="text-caption tabular-nums" style={muted}>
          Average {money(avg('spent'))} spent · {money(avg('budgeted'))} budgeted
        </span>
      )}
    </section>
  );
}
