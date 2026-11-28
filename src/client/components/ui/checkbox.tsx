import type { ComponentProps } from 'react';
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Check } from 'lucide-react';
import { cn } from '@client/lib/utils';

type CheckboxProps = Omit<ComponentProps<typeof CheckboxPrimitive.Root>, 'className'> & { className?: string };

/**
 * A 22px rounded box inside a 44px touch target (Base UI, so it is a real checkbox to assistive tech).
 * Unchecked: outlined in the strong border colour. Checked: accent fill with a tick in the accent's text colour.
 */
function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn('group/checkbox flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl', className)}
      {...props}
    >
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border-2 border-[var(--border-strong)] transition-colors duration-150 group-data-[checked]/checkbox:border-[var(--accent)] group-data-[checked]/checkbox:bg-[var(--accent)]">
        <CheckboxPrimitive.Indicator
          className="flex transition-[opacity,scale] duration-150 data-[ending-style]:scale-50 data-[ending-style]:opacity-0 data-[starting-style]:scale-50 data-[starting-style]:opacity-0 motion-reduce:transition-none"
          style={{ color: 'var(--accent-fg)' }}
        >
          <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3.5} />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
