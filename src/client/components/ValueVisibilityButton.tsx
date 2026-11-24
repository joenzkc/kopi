import { Eye, EyeOff } from 'lucide-react';
import { useFinancialValues } from '../lib/valueVisibility';
import { Button } from './ui/button';

export function ValueVisibilityButton() {
  const { valuesHidden, setValuesHidden } = useFinancialValues();
  const label = valuesHidden ? 'Show financial values' : 'Hide financial values';
  const Icon = valuesHidden ? EyeOff : Eye;
  return (
    <Button type="button" aria-label={label} title={label} onClick={() => setValuesHidden(!valuesHidden)}
      className="press flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card">
      <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
    </Button>
  );
}
