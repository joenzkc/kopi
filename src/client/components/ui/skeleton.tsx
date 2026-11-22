import type { ComponentProps } from 'react';
import { cn } from '@client/lib/utils';

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('animate-pulse bg-card', className)} {...props} />;
}

export { Skeleton };
