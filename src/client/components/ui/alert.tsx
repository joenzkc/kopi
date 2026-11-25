import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@client/lib/utils';

const alertVariants = cva('', {
  variants: {
    variant: {
      default: '',
      destructive: 'text-label text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Alert({
  as: Comp = 'div',
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants> & { as?: 'div' | 'p' }) {
  return <Comp data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export { Alert };
