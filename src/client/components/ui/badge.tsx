import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@client/lib/utils';

const badgeVariants = cva('rounded-full', {
  variants: {
    variant: {
      default: '',
      accent: 'bg-primary text-primary-foreground',
      destructive: 'bg-destructive text-background',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
