import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { formatMoney, formatPct, formatPrice, formatSignedMoney } from './api';
import { formatWhole } from './recent';

const storageKey = 'kopi_hide_financial_values';
export const HIDDEN_VALUE = '••••';
const mask = () => HIDDEN_VALUE;
const visibleFormats = { formatMoney, formatPct, formatPrice, formatSignedMoney, formatWhole };
const hiddenFormats: typeof visibleFormats = {
  formatMoney: mask, formatPct: mask, formatPrice: mask, formatSignedMoney: mask, formatWhole: mask,
};

const VisibilityContext = createContext({ valuesHidden: false, setValuesHidden: (_hidden: boolean) => {} });

function readPreference() {
  try {
    return localStorage.getItem(storageKey) === 'true';
  } catch {
    return false;
  }
}

export function ValueVisibilityProvider({ children }: { children: ReactNode }) {
  const [valuesHidden, setHidden] = useState(readPreference);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setHidden(readPreference());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function setValuesHidden(hidden: boolean) {
    setHidden(hidden);
    try {
      localStorage.setItem(storageKey, String(hidden));
    } catch {
      // Keep the preference for this session when storage is unavailable.
    }
  }

  return <VisibilityContext.Provider value={{ valuesHidden, setValuesHidden }}>{children}</VisibilityContext.Provider>;
}

export function useFinancialValues() {
  const visibility = useContext(VisibilityContext);
  return { ...visibility, ...(visibility.valuesHidden ? hiddenFormats : visibleFormats) };
}
