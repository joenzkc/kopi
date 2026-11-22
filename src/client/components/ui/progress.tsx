import type { ComponentProps, CSSProperties } from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';
import { cn } from '@client/lib/utils';

function Progress({
  value,
  max = 100,
  className,
  indicatorClassName,
  indicatorStyle,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string; indicatorStyle?: CSSProperties }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      max={max}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-accent', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('h-full rounded-full transition-[width]', indicatorClassName)}
        style={{ width: `${((value ?? 0) / max) * 100}%`, ...indicatorStyle }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
