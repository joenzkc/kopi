import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Field } from './parts';

export interface SearchHit {
  symbol: string;
  name: string;
  asset_type: 'stock' | 'etf' | 'crypto';
  provider_id: string;
  exchange?: string;
  currency: string;
}

/** Debounced ticker / coin search against /api/portfolio/search. */
export function SymbolSearch({
  type,
  label,
  placeholder,
  help,
  onPick,
}: {
  type: 'stock' | 'etf' | 'crypto';
  label: string;
  placeholder: string;
  help?: string;
  onPick: (hit: SearchHit) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch<{ results: SearchHit[] }>(
          `/api/portfolio/search?q=${encodeURIComponent(q)}&type=${type}`,
        );
        if (!cancelled) setResults(res.results);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, type]);

  const showList = query.trim().length >= 2 && (searching || results.length > 0);

  return (
    <Field label={label} htmlFor="symbol-search" help={help}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
        <Input
          id="symbol-search"
          type="search"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9"
        />
      </div>
      {showList && (
        <div className="divider-list max-h-56 overflow-y-auto rounded-2xl" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          {searching && results.length === 0 && (
            <div className="px-3.5 py-3 text-caption" style={{ color: 'var(--text-muted)' }}>
              Searching…
            </div>
          )}
          {results.map((hit) => (
            <Button
              key={`${hit.asset_type}:${hit.provider_id}`}
              type="button"
              onClick={() => {
                onPick(hit);
                setQuery('');
                setResults([]);
              }}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)]"
            >
              <span className="flex min-w-0 flex-col">
                <span className="text-body font-semibold">{hit.symbol}</span>
                <span className="truncate text-caption" style={{ color: 'var(--text-muted)' }}>
                  {hit.name}
                </span>
              </span>
              <span className="shrink-0 text-caption" style={{ color: 'var(--text-muted)' }}>
                {hit.exchange || hit.currency}
              </span>
            </Button>
          ))}
        </div>
      )}
    </Field>
  );
}
